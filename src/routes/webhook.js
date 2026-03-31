import express from 'express';
import { CandidateStatus, ConversationStep, MessageDirection, MessageType } from '@prisma/client';
import { extractMessages, sendTextMessage } from '../services/whatsapp.js';
import { fetchMediaMetadata, downloadMedia } from '../services/media.js';
import { uploadBufferToR2 } from '../services/storage.js';

const MENU_TEXT = `Hola, soy el asistente de reclutamiento de Loginpro.\n\nResponde con una opción:\n1. Ver información\n2. Postularme\n3. Hablar con reclutador`;
const INFO_TEXT = `Vacante activa. Debes enviar tus datos y tu hoja de vida. Si continúas, el equipo de reclutamiento revisará tu perfil.`;
const HUMAN_TEXT = `Tu mensaje fue marcado para revisión del reclutador. Si el perfil avanza, te contactaremos por este medio.`;

function normalizeText(text = '') {
  return text.trim();
}

function nextQuestion(step) {
  switch (step) {
    case ConversationStep.ASK_FULL_NAME:
      return 'Escribe tu nombre completo.';
    case ConversationStep.ASK_DOCUMENT:
      return 'Escribe tu número de documento.';
    case ConversationStep.ASK_AGE:
      return 'Escribe tu edad en números.';
    case ConversationStep.ASK_CITY:
      return 'Escribe tu ciudad.';
    case ConversationStep.ASK_ZONE:
      return 'Escribe tu barrio o localidad.';
    case ConversationStep.ASK_EXPERIENCE:
      return 'Resume tu experiencia en máximo 3 líneas.';
    case ConversationStep.ASK_AVAILABILITY:
      return 'Indica tu disponibilidad de horario.';
    case ConversationStep.ASK_CV:
      return 'Ahora envíame tu hoja de vida en PDF o Word en este mismo chat.';
    default:
      return MENU_TEXT;
  }
}

async function saveInboundMessage(prisma, candidateId, message, body, type) {
  try {
    await prisma.message.create({
      data: {
        candidateId,
        waMessageId: message.id,
        direction: MessageDirection.INBOUND,
        messageType: type,
        body,
        rawPayload: message
      }
    });
    return true;
  } catch (error) {
    if (String(error?.message || '').includes('Unique constraint')) return false;
    throw error;
  }
}

async function saveOutboundMessage(prisma, candidateId, body) {
  await prisma.message.create({
    data: {
      candidateId,
      direction: MessageDirection.OUTBOUND,
      messageType: MessageType.TEXT,
      body,
      rawPayload: { body }
    }
  });
}

async function reply(prisma, candidateId, to, body) {
  await sendTextMessage(to, body);
  await saveOutboundMessage(prisma, candidateId, body);
}

async function processText(prisma, candidate, from, text) {
  const cleanText = normalizeText(text);

  if (candidate.currentStep === ConversationStep.MENU) {
    if (cleanText === '1') {
      await reply(prisma, candidate.id, from, INFO_TEXT + '\n\nSi quieres postularte, responde 2.');
      return;
    }
    if (cleanText === '2') {
      await prisma.candidate.update({
        where: { id: candidate.id },
        data: { currentStep: ConversationStep.ASK_FULL_NAME }
      });
      await reply(prisma, candidate.id, from, nextQuestion(ConversationStep.ASK_FULL_NAME));
      return;
    }
    if (cleanText === '3') {
      await reply(prisma, candidate.id, from, HUMAN_TEXT);
      return;
    }

    await reply(prisma, candidate.id, from, MENU_TEXT);
    return;
  }

  if (candidate.currentStep === ConversationStep.ASK_FULL_NAME) {
    await prisma.candidate.update({
      where: { id: candidate.id },
      data: { fullName: cleanText, currentStep: ConversationStep.ASK_DOCUMENT }
    });
    await reply(prisma, candidate.id, from, nextQuestion(ConversationStep.ASK_DOCUMENT));
    return;
  }

  if (candidate.currentStep === ConversationStep.ASK_DOCUMENT) {
    await prisma.candidate.update({
      where: { id: candidate.id },
      data: { documentNumber: cleanText, currentStep: ConversationStep.ASK_AGE }
    });
    await reply(prisma, candidate.id, from, nextQuestion(ConversationStep.ASK_AGE));
    return;
  }

  if (candidate.currentStep === ConversationStep.ASK_AGE) {
    const age = Number(cleanText);
    if (!Number.isInteger(age) || age < 18 || age > 99) {
      await reply(prisma, candidate.id, from, 'Edad inválida. Escribe tu edad en números.');
      return;
    }
    await prisma.candidate.update({
      where: { id: candidate.id },
      data: { age, currentStep: ConversationStep.ASK_CITY }
    });
    await reply(prisma, candidate.id, from, nextQuestion(ConversationStep.ASK_CITY));
    return;
  }

  if (candidate.currentStep === ConversationStep.ASK_CITY) {
    await prisma.candidate.update({
      where: { id: candidate.id },
      data: { city: cleanText, currentStep: ConversationStep.ASK_ZONE }
    });
    await reply(prisma, candidate.id, from, nextQuestion(ConversationStep.ASK_ZONE));
    return;
  }

  if (candidate.currentStep === ConversationStep.ASK_ZONE) {
    await prisma.candidate.update({
      where: { id: candidate.id },
      data: { zone: cleanText, currentStep: ConversationStep.ASK_EXPERIENCE }
    });
    await reply(prisma, candidate.id, from, nextQuestion(ConversationStep.ASK_EXPERIENCE));
    return;
  }

  if (candidate.currentStep === ConversationStep.ASK_EXPERIENCE) {
    await prisma.candidate.update({
      where: { id: candidate.id },
      data: { experienceSummary: cleanText, currentStep: ConversationStep.ASK_AVAILABILITY }
    });
    await reply(prisma, candidate.id, from, nextQuestion(ConversationStep.ASK_AVAILABILITY));
    return;
  }

  if (candidate.currentStep === ConversationStep.ASK_AVAILABILITY) {
    await prisma.candidate.update({
      where: { id: candidate.id },
      data: {
        availability: cleanText,
        status: CandidateStatus.PENDIENTE_CV,
        currentStep: ConversationStep.ASK_CV
      }
    });
    await reply(prisma, candidate.id, from, nextQuestion(ConversationStep.ASK_CV));
    return;
  }

  if (candidate.currentStep === ConversationStep.ASK_CV) {
    await reply(prisma, candidate.id, from, 'Solo falta tu hoja de vida. Envíala en PDF o Word en este chat.');
    return;
  }

  await reply(prisma, candidate.id, from, MENU_TEXT);
}

async function processDocument(prisma, candidate, from, documentMessage) {
  const mimeType = documentMessage.document?.mime_type || '';
  const fileName = documentMessage.document?.filename || 'cv';
  const mediaId = documentMessage.document?.id;
  const allowed = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ];

  if (!mediaId || !allowed.includes(mimeType)) {
    await reply(prisma, candidate.id, from, 'Archivo inválido. Envía tu hoja de vida en PDF o Word.');
    return;
  }

  const media = await fetchMediaMetadata(mediaId);
  const buffer = await downloadMedia(media.url);
  const key = `cvs/${candidate.phone}/${Date.now()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  await uploadBufferToR2(key, buffer, mimeType);

  await prisma.candidate.update({
    where: { id: candidate.id },
    data: {
      cvOriginalName: fileName,
      cvStorageKey: key,
      cvMimeType: mimeType,
      currentStep: ConversationStep.DONE,
      status: CandidateStatus.POSTULACION_COMPLETA
    }
  });

  await reply(prisma, candidate.id, from, 'Tu postulación fue recibida correctamente. El equipo de reclutamiento revisará tu información y te contactará si continúas en el proceso.');
}

export function webhookRouter(prisma) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }

    return res.sendStatus(403);
  });

  router.post('/', async (req, res, next) => {
    try {
      const messages = extractMessages(req.body);
      if (!messages.length) return res.sendStatus(200);

      for (const message of messages) {
        const from = message.from;
        if (!from) continue;

        const candidate = await prisma.candidate.upsert({
          where: { phone: from },
          update: {},
          create: { phone: from }
        });

        if (message.type === 'text') {
          const wasNew = await saveInboundMessage(prisma, candidate.id, message, message.text?.body || '', MessageType.TEXT);
          if (!wasNew) continue;
          const freshCandidate = await prisma.candidate.findUnique({ where: { id: candidate.id } });
          await processText(prisma, freshCandidate, from, message.text?.body || '');
          continue;
        }

        if (message.type === 'document') {
          const wasNew = await saveInboundMessage(prisma, candidate.id, message, message.document?.filename || '', MessageType.DOCUMENT);
          if (!wasNew) continue;
          const freshCandidate = await prisma.candidate.findUnique({ where: { id: candidate.id } });
          await processDocument(prisma, freshCandidate, from, message);
          continue;
        }

        const wasNew = await saveInboundMessage(prisma, candidate.id, message, '', MessageType.UNKNOWN);
        if (!wasNew) continue;
        await reply(prisma, candidate.id, from, 'Por ahora solo puedo procesar texto y hoja de vida en PDF o Word.');
      }

      res.sendStatus(200);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
