/**
 * reminder.js — Sprint 4 (extendido)
 *
 * Dispatcher de recordatorios por inactividad (existente) +
 * Dispatcher de recordatorios de entrevista 1h antes (nuevo).
 *
 * Arquitectura:
 *   - Un único setInterval cada 60s que corre ambos dispatchers en paralelo.
 *   - Cada dispatcher es idempotente: usa updateMany con condiciones precisas
 *     para que en multi-pod solo uno procese cada registro.
 *   - Los recordatorios de entrevista usan findInterviewsDueForReminder() de interviewFlow.js.
 */

import { sendTextMessage } from './whatsapp.js';
import { ConversationStep, ReminderState } from '@prisma/client';
import {
  findInterviewsDueForReminder,
  markReminderSent,
  buildReminderMessage
} from './interviewFlow.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const REMINDER_DELAY_MS = 4 * 60 * 60 * 1000; // 4 horas de inactividad
const REMINDER_WINDOW_H = 24;                   // ventana de sesión de 24h WhatsApp

const INACTIVITY_MSG =
  'Hola, estamos pendientes de tu postulación. Si deseas continuar, cuéntame '
  + 'qué datos te faltan por completar o envía tu hoja de vida si ya tienes los datos registrados.';

// ---------------------------------------------------------------------------
// Dispatcher de inactividad (existente, sin cambios)
// ---------------------------------------------------------------------------

export async function scheduleReminderForCandidate(prisma, candidateId) {
  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: { currentStep: true, reminderState: true, botPaused: true, status: true }
  });

  const skipSteps = [ConversationStep.DONE, ConversationStep.MENU, ConversationStep.SCHEDULING_INTERVIEW];
  if (!candidate || skipSteps.includes(candidate.currentStep)) return;
  if (candidate.botPaused) return;
  if (candidate.status === 'RECHAZADO') return;

  const scheduledFor = new Date(Date.now() + REMINDER_DELAY_MS);
  await prisma.candidate.update({
    where: { id: candidateId },
    data: {
      reminderScheduledFor: scheduledFor,
      reminderState: ReminderState.SCHEDULED,
      lastReminderAt: null
    }
  });
}

export async function cancelReminderOnInbound(prisma, candidateId) {
  await prisma.candidate.updateMany({
    where: { id: candidateId, reminderState: ReminderState.SCHEDULED },
    data: { reminderState: ReminderState.CANCELLED, reminderScheduledFor: null }
  });
}

async function dispatchInactivityReminders(prisma) {
  const now = new Date();
  const candidates = await prisma.candidate.findMany({
    where: {
      reminderState: ReminderState.SCHEDULED,
      reminderScheduledFor: { lte: now },
      botPaused: false,
      currentStep: {
        notIn: [ConversationStep.DONE, ConversationStep.MENU, ConversationStep.SCHEDULING_INTERVIEW]
      }
    },
    select: { id: true, phone: true, lastInboundAt: true }
  });

  for (const candidate of candidates) {
    // Respetar ventana de 24h de WhatsApp
    const lastContact = candidate.lastInboundAt;
    if (!lastContact) continue;
    const hoursSince = (now.getTime() - new Date(lastContact).getTime()) / (1000 * 60 * 60);
    if (hoursSince >= REMINDER_WINDOW_H) {
      await prisma.candidate.update({
        where: { id: candidate.id },
        data: { reminderState: ReminderState.SKIPPED, reminderScheduledFor: null }
      });
      continue;
    }

    // Adquirir el recordatorio de forma idempotente
    const acquired = await prisma.candidate.updateMany({
      where: { id: candidate.id, reminderState: ReminderState.SCHEDULED },
      data: { reminderState: ReminderState.SENT, lastReminderAt: now, reminderScheduledFor: null }
    });
    if (acquired.count !== 1) continue;

    try {
      await sendTextMessage(candidate.phone, INACTIVITY_MSG);
      console.log('[REMINDER_SENT]', JSON.stringify({ phone: candidate.phone, type: 'inactivity' }));
    } catch (error) {
      console.error('[REMINDER_ERROR]', JSON.stringify({ phone: candidate.phone, error: error?.message }));
      // Revertir a SCHEDULED para reintentar en el siguiente ciclo
      await prisma.candidate.updateMany({
        where: { id: candidate.id, reminderState: ReminderState.SENT },
        data: { reminderState: ReminderState.SCHEDULED, reminderScheduledFor: new Date(Date.now() + 5 * 60 * 1000) }
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Dispatcher de recordatorios de entrevista (nuevo)
// ---------------------------------------------------------------------------

async function dispatchInterviewReminders(prisma) {
  const interviews = await findInterviewsDueForReminder(prisma);
  if (!interviews.length) return;

  for (const interview of interviews) {
    const { candidate, slot } = interview;
    if (!candidate?.phone) continue;

    const address = slot?.vacancy?.operationAddress || null;
    const msg = buildReminderMessage(candidate.fullName, slot.scheduledAt, address);

    // Marcar como enviado ANTES de mandar (idempotencia: si falla el envío, no re-envía)
    const acquired = await prisma.interview.updateMany({
      where: { id: interview.id, reminderSentAt: null },
      data: { reminderSentAt: new Date() }
    });
    if (acquired.count !== 1) continue; // otro pod ya lo procesó

    try {
      await sendTextMessage(candidate.phone, msg);
      console.log('[INTERVIEW_REMINDER_SENT]', JSON.stringify({
        phone: candidate.phone,
        interviewId: interview.id,
        scheduledAt: slot.scheduledAt
      }));
    } catch (error) {
      console.error('[INTERVIEW_REMINDER_ERROR]', JSON.stringify({
        phone: candidate.phone,
        interviewId: interview.id,
        error: error?.message
      }));
      // Revertir para reintentar
      await prisma.interview.updateMany({
        where: { id: interview.id },
        data: { reminderSentAt: null }
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Init del dispatcher unificado
// ---------------------------------------------------------------------------

/**
 * Inicia el polling unificado de recordatorios.
 * Corre inactividad + entrevistas cada 60 segundos.
 * Diseñado para ser llamado una sola vez al arranque del servidor.
 */
export function startReminderDispatcher(prisma) {
  const tick = async () => {
    try {
      await Promise.all([
        dispatchInactivityReminders(prisma),
        dispatchInterviewReminders(prisma)
      ]);
    } catch (error) {
      console.error('[REMINDER_DISPATCHER_ERROR]', JSON.stringify({ error: error?.message }));
    }
  };

  setInterval(tick, 60 * 1000);
  console.log('[REMINDER_DISPATCHER_STARTED]', JSON.stringify({ intervalMs: 60000, dispatchers: ['inactivity', 'interview'] }));
}
