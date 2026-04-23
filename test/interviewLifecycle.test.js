import test from 'node:test';
import assert from 'node:assert/strict';
import { createBooking } from '../src/services/interviewScheduler.js';
import {
  detectInterviewIntent,
  isWithinInterviewConfirmationWindow,
  shouldMarkNoResponse,
} from '../src/services/interviewLifecycle.js';

const baseBooking = {
  id: 'book-1',
  status: 'SCHEDULED',
  scheduledAt: new Date('2026-04-24T18:00:00.000Z'),
  reminderSentAt: null,
  reminderWindowClosed: false
};

test('aceptar horario crea booking SCHEDULED y no CONFIRMED', async () => {
  const calls = [];
  const prisma = {
    interviewBooking: {
      findFirst: async () => null,
      create: async ({ data }) => {
        calls.push(data);
        return { id: 'book-created', status: data.status || 'SCHEDULED', ...data };
      }
    }
  };

  const booking = await createBooking(prisma, 'cand-1', 'vac-1', 'slot-1', new Date('2026-04-24T18:00:00.000Z'));
  assert.equal(calls.length, 1);
  assert.equal(booking.status, 'SCHEDULED');
});

test('"confirmo" demasiado temprano no cambia a confirm_attendance', () => {
  const now = new Date('2026-04-23T05:00:00.000Z');
  const intent = detectInterviewIntent({ text: 'confirmo, si voy', booking: baseBooking, now });
  assert.equal(isWithinInterviewConfirmationWindow(baseBooking, now), false);
  assert.equal(intent, 'none');
});

test('"confirmo" dentro de ventana válida sí detecta confirm_attendance', () => {
  const now = new Date('2026-04-24T13:00:00.000Z');
  const intent = detectInterviewIntent({ text: 'sí voy, confirmo asistencia', booking: baseBooking, now });
  assert.equal(isWithinInterviewConfirmationWindow(baseBooking, now), true);
  assert.equal(intent, 'confirm_attendance');
});

test('detecta intención de cancelación y reagendamiento', () => {
  const now = new Date('2026-04-24T13:00:00.000Z');
  assert.equal(detectInterviewIntent({ text: 'quiero cancelar la entrevista', booking: baseBooking, now }), 'cancel_interview');
  assert.equal(detectInterviewIntent({ text: 'necesito reagendar, dame otro horario', booking: baseBooking, now }), 'reschedule_interview');
});

test('marca NO_RESPONSE cuando falta <=10 min desde reminder sin respuesta', () => {
  const booking = {
    ...baseBooking,
    reminderSentAt: new Date('2026-04-24T16:55:00.000Z')
  };

  assert.equal(
    shouldMarkNoResponse(booking, {
      now: new Date('2026-04-24T17:51:00.000Z'),
      hasReminderReply: false
    }),
    true
  );
});
