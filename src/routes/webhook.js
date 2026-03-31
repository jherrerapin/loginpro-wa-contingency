// Importa Express para crear el enrutador del webhook.
import express from 'express';

// Importa enums generados por Prisma para mantener consistencia tipada con la base de datos.
import { CandidateStatus, ConversationStep, MessageDirection, MessageType } from '@prisma/client';

// Importa utilidades para extraer mensajes del payload y responder por WhatsApp.
import { extractMessages, sendTextMessage } from '../services/whatsapp.js';

// Importa servicios para consultar y descargar archivos enviados por WhatsApp.
import { fetchMediaMetadata, downloadMedia } from '../services/media.js';

// Define el texto fijo del menú principal.
const MENU_TEXT = `Hola, soy el asistente de reclutamiento de Loginpro.\n\nResponde con una opción:\n1. Ver información\n2. Postularme\n3. Hablar con reclutador`;

// Define el texto informativo para candidatos que solo quieren conocer la vacante.
const INFO_TEXT = `Vacante activa. Debes enviar tus datos y tu hoja de vida. Si continúas, el equipo de reclutamiento revisará tu perfil.`;

// Define el texto para casos donde el usuario pide atención humana.
const HUMAN_TEXT = `Tu mensaje fue marcado para revisión del reclutador. Si el perfil avanza, te contactaremos por este medio.`;

// Normaliza cualquier texto entrante para evitar problemas con espacios al inicio o al final.
function normalizeText(text = '') {
  // Retorna el texto recortado.
  return text.trim();
}

// Define la siguiente pregunta en función del paso actual del flujo.
function nextQuestion(step) {
  // Evalúa el paso actual del candidato.
  switch (step) {
    // Si el paso es solicitar nombre completo, retorna esa pregunta.
    case ConversationStep.ASK_FULL_NAME:
      return 'Escribe tu nombre completo.';
    // Si el paso es solicitar documento, retorna esa pregunta.
    case ConversationStep.ASK_DOCUMENT:
      return 'Escribe tu número de documento.';
    // Si el paso es solicitar edad, retorna esa pregunta.
    case ConversationStep.ASK_AGE:
      return 'Escribe tu edad en números.';
    // Si el paso es solicitar ciudad, retorna esa pregunta.
    case ConversationStep.ASK_CITY:
      return 'Escribe tu ciudad.';
    // Si el paso es solicitar barrio o localidad, retorna esa pregunta.
    case ConversationStep.ASK_ZONE:
      return 'Escribe tu barrio o localidad.';
    // Si el paso es solicitar experiencia, retorna esa pregunta.
    case ConversationStep.ASK_EXPERIENCE:
      return 'Resume tu experiencia en máximo 3 líneas.';
    // Si el paso es solicitar disponibilidad, retorna esa pregunta.
    case ConversationStep.ASK_AVAILABILITY:
      return 'Indica tu disponibilidad de horario.';
    // Si el paso es solicitar la hoja de vida, retorna esa pregunta.
    case ConversationStep.ASK_CV:
      return 'Ahora envíame tu hoja de vida en PDF o Word en este mismo chat.';
    // Para cualquier otro caso, retorna el menú principal.
    default:
      return MENU_TEXT;
  }
}

// Guarda un mensaje entrante y controla duplicados por identificador de WhatsApp.
async function saveInboundMessage(prisma, candidateId, message, body, type) {
  // Inicia un bloque controlado para manejar duplicados sin romper el flujo.
  try {
    // Inserta el mensaje entrante en la tabla de mensajes.
    await prisma.message.create({
      // Define los datos a persistir.
      data: {
        // Relaciona el mensaje con el candidato.
        candidateId,
        // Guarda el id del mensaje de WhatsApp para idempotencia.
        waMessageId: message.id,
        // Marca la dirección del mensaje como entrante.
        direction: MessageDirection.INBOUND,
        // Guarda el tipo del mensaje.
        messageType: type,
        // Guarda un cuerpo textual útil para auditoría rápida.
        body,
        // Guarda el payload completo.
        rawPayload: message
      }
    });

    // Retorna verdadero cuando el mensaje fue guardado correctamente.
    return true;
  } catch (error) {
    // Convierte el error a texto para identificar una restricción única.
    if (String(error?.message || '').includes('Unique constraint')) {
      // Retorna falso si el mensaje ya existía y no debe reprocesarse.
      return false;
    }

    // Relanza cualquier otro error para no ocultar fallas reales.
    throw error;
  }
}

// Guarda un mensaje saliente del bot.
async function saveOutboundMessage(prisma, candidateId, body) {
  // Inserta un nuevo mensaje saliente.
  await prisma.message.create({
    // Define los datos del mensaje.
    data: {
      // Relaciona el mensaje con el candidato.
      candidateId,
      // Marca la dirección del mensaje como saliente.
      direction: MessageDirection.OUTBOUND,
      // Marca el tipo del mensaje como texto.
      messageType: MessageType.TEXT,
      // Guarda el cuerpo del mensaje.
      body,
      // Guarda un payload mínimo para auditoría.
      rawPayload: { body }
    }
  });
}

// Envía una respuesta por WhatsApp y luego la persiste en la base de datos.
async function reply(prisma, candidateId, to, body) {
  // Envía el texto al número del candidato usando Cloud API.
  await sendTextMessage(to, body);

  // Guarda la traza del mensaje saliente.
  await saveOutboundMessage(prisma, candidateId, body);
}

// Procesa un mensaje de texto en función del estado actual del candidato.
async function processText(prisma, candidate, from, text) {
  // Normaliza el texto entrante.
  const cleanText = normalizeText(text);

  // Evalúa si el candidato aún está en el menú principal.
  if (candidate.currentStep === ConversationStep.MENU) {
    // Si el usuario eligió ver información, envía la información básica.
    if (cleanText === '1') {
      // Responde con texto informativo y recordatorio para postularse.
      await reply(prisma, candidate.id, from, INFO_TEXT + '\n\nSi quieres postularte, responde 2.');
      // Termina la ejecución del flujo de este mensaje.
      return;
    }

    // Si el usuario eligió postularse, avanza al paso de nombre completo.
    if (cleanText === '2') {
      // Actualiza el paso actual del candidato.
      await prisma.candidate.update({
        // Busca el candidato por id.
        where: { id: candidate.id },
        // Define el nuevo paso.
        data: { currentStep: ConversationStep.ASK_FULL_NAME }
      });

      // Envía la siguiente pregunta.
      await reply(prisma, candidate.id, from, nextQuestion(ConversationStep.ASK_FULL_NAME));

      // Termina la ejecución del flujo de este mensaje.
      return;
    }

    // Si el usuario eligió hablar con reclutador, envía mensaje de atención humana.
    if (cleanText === '3') {
      // Responde con el texto de escalamiento humano.
      await reply(prisma, candidate.id, from, HUMAN_TEXT);

      // Termina la ejecución del flujo de este mensaje.
      return;
    }

    // Si el texto no coincide con una opción válida, repite el menú.
    await reply(prisma, candidate.id, from, MENU_TEXT);

    // Termina la ejecución del flujo de este mensaje.
    return;
  }

  // Si el paso actual es capturar el nombre completo.
  if (candidate.currentStep === ConversationStep.ASK_FULL_NAME) {
    // Guarda el nombre y avanza al documento.
    await prisma.candidate.update({
      // Ubica el candidato.
      where: { id: candidate.id },
      // Guarda el nombre y actualiza el paso.
      data: { fullName: cleanText, currentStep: ConversationStep.ASK_DOCUMENT }
    });

    // Envía la pregunta del documento.
    await reply(prisma, candidate.id, from, nextQuestion(ConversationStep.ASK_DOCUMENT));

    // Termina la ejecución.
    return;
  }

  // Si el paso actual es capturar el documento.
  if (candidate.currentStep === ConversationStep.ASK_DOCUMENT) {
    // Guarda el documento y avanza a la edad.
    await prisma.candidate.update({
      // Ubica el candidato.
      where: { id: candidate.id },
      // Guarda documento y nuevo paso.
      data: { documentNumber: cleanText, currentStep: ConversationStep.ASK_AGE }
    });

    // Envía la pregunta de edad.
    await reply(prisma, candidate.id, from, nextQuestion(ConversationStep.ASK_AGE));

    // Termina la ejecución.
    return;
  }

  // Si el paso actual es capturar la edad.
  if (candidate.currentStep === ConversationStep.ASK_AGE) {
    // Convierte el texto en número.
    const age = Number(cleanText);

    // Valida que la edad sea entera y esté dentro del rango aceptado.
    if (!Number.isInteger(age) || age < 18 || age > 99) {
      // Responde con un mensaje de validación.
      await reply(prisma, candidate.id, from, 'Edad inválida. Escribe tu edad en números.');

      // Termina la ejecución.
      return;
    }

    // Guarda la edad y avanza a ciudad.
    await prisma.candidate.update({
      // Ubica el candidato.
      where: { id: candidate.id },
      // Guarda la edad y nuevo paso.
      data: { age, currentStep: ConversationStep.ASK_CITY }
    });

    // Envía la siguiente pregunta.
    await reply(prisma, candidate.id, from, nextQuestion(ConversationStep.ASK_CITY));

    // Termina la ejecución.
    return;
  }

  // Si el paso actual es capturar ciudad.
  if (candidate.currentStep === ConversationStep.ASK_CITY) {
    // Guarda la ciudad y avanza a zona.
    await prisma.candidate.update({
      // Ubica el candidato.
      where: { id: candidate.id },
      // Guarda ciudad y nuevo paso.
      data: { city: cleanText, currentStep: ConversationStep.ASK_ZONE }
    });

    // Envía la pregunta de zona.
    await reply(prisma, candidate.id, from, nextQuestion(ConversationStep.ASK_ZONE));

    // Termina la ejecución.
    return;
  }

  // Si el paso actual es capturar barrio o localidad.
  if (candidate.currentStep === ConversationStep.ASK_ZONE) {
    // Guarda la zona y avanza a experiencia.
    await prisma.candidate.update({
      // Ubica el candidato.
      where: { id: candidate.id },
      // Guarda zona y nuevo paso.
      data: { zone: cleanText, currentStep: ConversationStep.ASK_EXPERIENCE }
    });

    // Envía la pregunta de experiencia.
    await reply(prisma, candidate.id, from, nextQuestion(ConversationStep.ASK_EXPERIENCE));

    // Termina la ejecución.
    return;
  }

  // Si el paso actual es capturar experiencia.
  if (candidate.currentStep === ConversationStep.ASK_EXPERIENCE) {
    // Guarda experiencia y avanza a disponibilidad.
    await prisma.candidate.update({
      // Ubica el candidato.
      where: { id: candidate.id },
      // Guarda experiencia y nuevo paso.
      data: { experienceSummary: cleanText, currentStep: ConversationStep.ASK_AVAILABILITY }
    });

    // Envía la pregunta de disponibilidad.
    await reply(prisma, candidate.id, from, nextQuestion(ConversationStep.ASK_AVAILABILITY));

    // Termina la ejecución.
    return;
  }

  // Si el paso actual es capturar disponibilidad.
  if (candidate.currentStep === ConversationStep.ASK_AVAILABILITY) {
    // Guarda disponibilidad, cambia estado operativo y solicita CV.
    await prisma.candidate.update({
      // Ubica el candidato.
      where: { id: candidate.id },
      // Guarda disponibilidad, estado y nuevo paso.
      data: {
        availability: cleanText,
        status: CandidateStatus.PENDIENTE_CV,
        currentStep: ConversationStep.ASK_CV
      }
    });

    // Envía la solicitud de hoja de vida.
    await reply(prisma, candidate.id, from, nextQuestion(ConversationStep.ASK_CV));

    // Termina la ejecución.
    return;
  }

  // Si el candidato ya está en espera del CV y vuelve a escribir texto.
  if (candidate.currentStep === ConversationStep.ASK_CV) {
    // Repite la instrucción de envío de hoja de vida.
    await reply(prisma, candidate.id, from, 'Solo falta tu hoja de vida. Envíala en PDF o Word en este chat.');

    // Termina la ejecución.
    return;
  }

  // Para cualquier estado no previsto, vuelve al menú principal.
  await reply(prisma, candidate.id, from, MENU_TEXT);
}

// Procesa un documento recibido por WhatsApp y lo guarda dentro de PostgreSQL.
async function processDocument(prisma, candidate, from, documentMessage) {
  // Obtiene el tipo MIME del documento recibido.
  const mimeType = documentMessage.document?.mime_type || '';

  // Obtiene el nombre del archivo o usa un nombre genérico.
  const fileName = documentMessage.document?.filename || 'cv';

  // Obtiene el media id entregado por WhatsApp para descargar el archivo.
  const mediaId = documentMessage.document?.id;

  // Define los tipos de archivo permitidos para la contingencia.
  const allowed = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ];

  // Valida que exista el media id y que el archivo sea de un tipo permitido.
  if (!mediaId || !allowed.includes(mimeType)) {
    // Responde con mensaje de archivo inválido.
    await reply(prisma, candidate.id, from, 'Archivo inválido. Envía tu hoja de vida en PDF o Word.');

    // Termina la ejecución.
    return;
  }

  // Consulta la metadata del medio en Meta para obtener la URL temporal de descarga.
  const media = await fetchMediaMetadata(mediaId);

  // Descarga el binario completo del archivo.
  const buffer = await downloadMedia(media.url);

  // Guarda el archivo binario y actualiza el estado del candidato como postulación completa.
  await prisma.candidate.update({
    // Ubica el candidato.
    where: { id: candidate.id },
    // Actualiza metadatos y contenido del CV.
    data: {
      cvOriginalName: fileName,
      cvMimeType: mimeType,
      cvData: buffer,
      currentStep: ConversationStep.DONE,
      status: CandidateStatus.POSTULACION_COMPLETA
    }
  });

  // Envía confirmación final al candidato.
  await reply(
    prisma,
    candidate.id,
    from,
    'Tu postulación fue recibida correctamente. El equipo de reclutamiento revisará tu información y te contactará si continúas en el proceso.'
  );
}

// Expone el router principal del webhook.
export function webhookRouter(prisma) {
  // Crea una nueva instancia de router de Express.
  const router = express.Router();

  // Define el endpoint GET que usa Meta para verificar el webhook.
  router.get('/', (req, res) => {
    // Lee el modo de verificación enviado por Meta.
    const mode = req.query['hub.mode'];

    // Lee el token de verificación enviado por Meta.
    const token = req.query['hub.verify_token'];

    // Lee el challenge que Meta espera recibir de vuelta.
    const challenge = req.query['hub.challenge'];

    // Valida que el modo sea subscribe y que el token coincida con la variable de entorno.
    if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
      // Responde con el challenge para que Meta apruebe el webhook.
      return res.status(200).send(challenge);
    }

    // Si no coincide la validación, responde prohibido.
    return res.sendStatus(403);
  });

  // Define el endpoint POST que recibe mensajes reales desde Meta.
  router.post('/', async (req, res, next) => {
    // Inicia bloque controlado para capturar errores y delegarlos al middleware global.
    try {
      // Extrae la lista de mensajes del payload del webhook.
      const messages = extractMessages(req.body);

      // Si no hay mensajes, responde 200 para que Meta no reintente innecesariamente.
      if (!messages.length) {
        return res.sendStatus(200);
      }

      // Recorre cada mensaje recibido en el webhook.
      for (const message of messages) {
        // Obtiene el número de origen del mensaje.
        const from = message.from;

        // Si no existe origen, ignora el mensaje.
        if (!from) {
          continue;
        }

        // Busca o crea el candidato asociado a ese teléfono.
        const candidate = await prisma.candidate.upsert({
          // Usa el teléfono como llave única.
          where: { phone: from },
          // No actualiza nada en este punto si ya existe.
          update: {},
          // Crea un candidato vacío si no existe.
          create: { phone: from }
        });

        // Si el mensaje es de texto, ejecuta el flujo de texto.
        if (message.type === 'text') {
          // Guarda el mensaje entrante y controla duplicados.
          const wasNew = await saveInboundMessage(
            prisma,
            candidate.id,
            message,
            message.text?.body || '',
            MessageType.TEXT
          );

          // Si el mensaje ya estaba guardado, omite su reprocesamiento.
          if (!wasNew) {
            continue;
          }

          // Consulta el estado actualizado del candidato antes de procesar el texto.
          const freshCandidate = await prisma.candidate.findUnique({
            where: { id: candidate.id }
          });

          // Procesa el texto según el paso conversacional.
          await processText(prisma, freshCandidate, from, message.text?.body || '');

          // Continúa con el siguiente mensaje del lote.
          continue;
        }

        // Si el mensaje es un documento, ejecuta el flujo de archivo.
        if (message.type === 'document') {
          // Guarda el mensaje entrante y controla duplicados.
          const wasNew = await saveInboundMessage(
            prisma,
            candidate.id,
            message,
            message.document?.filename || '',
            MessageType.DOCUMENT
          );

          // Si ya estaba guardado, no lo procesa otra vez.
          if (!wasNew) {
            continue;
          }

          // Consulta el candidato actualizado.
          const freshCandidate = await prisma.candidate.findUnique({
            where: { id: candidate.id }
          });

          // Procesa el documento recibido.
          await processDocument(prisma, freshCandidate, from, message);

          // Continúa con el siguiente mensaje del lote.
          continue;
        }

        // Guarda mensajes no soportados para auditoría.
        const wasNew = await saveInboundMessage(prisma, candidate.id, message, '', MessageType.UNKNOWN);

        // Si el mensaje ya estaba registrado, omite reprocesamiento.
        if (!wasNew) {
          continue;
        }

        // Responde indicando que solo se soporta texto y documentos.
        await reply(prisma, candidate.id, from, 'Por ahora solo puedo procesar texto y hoja de vida en PDF o Word.');
      }

      // Responde 200 al finalizar para confirmar recepción a Meta.
      res.sendStatus(200);
    } catch (error) {
      // Envía el error al middleware global de Express.
      next(error);
    }
  });

  // Retorna el router listo para ser montado en el servidor.
  return router;
}