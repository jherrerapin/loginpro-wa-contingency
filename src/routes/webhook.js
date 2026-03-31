// Importa Express para crear el enrutador del webhook.
import express from 'express';

// Importa enums generados por Prisma para mantener consistencia tipada con la base de datos.
import { CandidateStatus, ConversationStep, MessageDirection, MessageType } from '@prisma/client';

// Importa utilidades para extraer mensajes del payload y responder por WhatsApp.
import { extractMessages, sendTextMessage } from '../services/whatsapp.js';

// Importa servicios para consultar y descargar archivos enviados por WhatsApp.
import { fetchMediaMetadata, downloadMedia } from '../services/media.js';

// Define el texto informativo de la vacante que ya usa la operación actual.
const INFO_TEXT = `Vacante activa. Debes enviar tus datos y tu hoja de vida. Si continúas, el equipo de reclutamiento revisará tu perfil.`;

// Define el mensaje inicial solicitado para el nuevo flujo.
const INITIAL_GREETING_TEXT = `Hola, Dios te bendiga. Te comparto la información de la vacante:\n${INFO_TEXT}\n\nSi estás interesado, responde a este mensaje y te pediré tus datos para continuar.`;

// Define el formato único solicitado para capturar datos en una sola línea.
const SINGLE_LINE_DATA_TEXT =
  'Por favor envía tus datos en una sola línea con este formato:\nNombre completo | Cédula | Edad | Ciudad/Barrio | Experiencia breve';

// Define la instrucción de envío de hoja de vida.
const ASK_CV_TEXT = 'Perfecto. Ahora envíame tu hoja de vida en PDF o Word en este mismo chat.';

// Define el mensaje fijo para candidatos que ya completaron el flujo.
const ALREADY_COMPLETED_TEXT =
  'Tu información ya fue recibida correctamente. Por favor espera a que el equipo de reclutamiento se comunique contigo.';

// Normaliza cualquier texto entrante para evitar problemas con espacios al inicio o al final.
function normalizeText(text = '') {
  // Retorna el texto recortado.
  return text.trim();
}

// Evalúa si el candidato expresó interés claro para continuar.
function isAffirmativeInterest(text) {
  // Normaliza el texto en minúscula para facilitar la comparación.
  const normalized = normalizeText(text).toLowerCase();

  // Lista de frases permitidas para interpretar intención positiva.
  const affirmativePatterns = [
    'si',
    'sí',
    'estoy interesado',
    'me interesa',
    'quiero aplicar',
    'quiero postularme'
  ];

  // Retorna verdadero si el texto coincide exactamente o contiene una frase positiva clara.
  return affirmativePatterns.some((pattern) => normalized === pattern || normalized.includes(pattern));
}

// Evalúa si la respuesta del candidato indica que no desea continuar.
function isNegativeInterest(text) {
  // Normaliza el texto en minúscula para facilitar la comparación.
  const normalized = normalizeText(text).toLowerCase();

  // Lista breve de expresiones negativas frecuentes.
  const negativePatterns = ['no', 'no gracias', 'no me interesa', 'negativo'];

  // Retorna verdadero cuando detecta una intención negativa clara.
  return negativePatterns.some((pattern) => normalized === pattern || normalized.includes(pattern));
}

// Parsea la línea de datos enviada por el candidato usando el separador "|".
function parseSingleLineData(text) {
  // Separa columnas por pipe y limpia espacios.
  const columns = text.split('|').map((value) => value.trim());

  // Valida cantidad exacta de columnas.
  if (columns.length !== 5) {
    return { valid: false };
  }

  // Desestructura los campos esperados.
  const [fullName, documentNumber, ageText, cityAndZone, experienceSummary] = columns;

  // Valida que todos los campos tengan contenido.
  if (!fullName || !documentNumber || !ageText || !cityAndZone || !experienceSummary) {
    return { valid: false };
  }

  // Convierte y valida edad en rango razonable del flujo.
  const age = Number(ageText);
  if (!Number.isInteger(age) || age < 18 || age > 99) {
    return { valid: false };
  }

  // Retorna estructura lista para guardar en base de datos.
  return {
    valid: true,
    data: {
      fullName,
      documentNumber,
      age,
      city: cityAndZone,
      zone: cityAndZone,
      experienceSummary
    }
  };
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
    // Primer contacto: comparte saludo + vacante y deja al candidato en espera de confirmación de interés.
    await prisma.candidate.update({
      where: { id: candidate.id },
      data: { currentStep: ConversationStep.ASK_FULL_NAME }
    });

    // Envía el saludo inicial solicitado en un único mensaje.
    await reply(prisma, candidate.id, from, INITIAL_GREETING_TEXT);

    // Termina la ejecución del flujo de este mensaje.
    return;
  }

  // Reglas para candidatos que ya completaron el flujo: nunca reiniciar.
  if (candidate.currentStep === ConversationStep.DONE) {
    // Retorna siempre el mensaje fijo para evitar reinicios.
    await reply(prisma, candidate.id, from, ALREADY_COMPLETED_TEXT);

    // Termina la ejecución.
    return;
  }

  // Paso semántico: espera de confirmación de interés.
  if (candidate.currentStep === ConversationStep.ASK_FULL_NAME) {
    // Si confirma interés, avanza a captura de datos en una sola línea.
    if (isAffirmativeInterest(cleanText)) {
      await prisma.candidate.update({
        where: { id: candidate.id },
        data: { currentStep: ConversationStep.ASK_DOCUMENT }
      });

      await reply(prisma, candidate.id, from, SINGLE_LINE_DATA_TEXT);
      return;
    }

    // Si responde de forma negativa, no avanza al registro.
    if (isNegativeInterest(cleanText)) {
      await reply(prisma, candidate.id, from, 'Entendido. Te dejamos la información de la vacante por aquí:\n' + INFO_TEXT);
      return;
    }

    // Si la intención no es clara, mantiene el paso y recuerda cómo continuar.
    await reply(prisma, candidate.id, from, 'Si estás interesado en continuar, responde: "sí" o "me interesa".');
    return;
  }

  // Paso semántico: espera de datos en una sola línea.
  if (candidate.currentStep === ConversationStep.ASK_DOCUMENT) {
    // Intenta parsear la línea con el formato requerido.
    const parsed = parseSingleLineData(cleanText);

    // Si el formato es inválido, solicita nuevamente la línea exacta.
    if (!parsed.valid) {
      await reply(prisma, candidate.id, from, SINGLE_LINE_DATA_TEXT);
      return;
    }

    // Guarda todos los datos de una sola vez y pasa a espera de hoja de vida.
    await prisma.candidate.update({
      where: { id: candidate.id },
      data: {
        ...parsed.data,
        status: CandidateStatus.PENDIENTE_CV,
        currentStep: ConversationStep.ASK_CV
      }
    });

    // Solicita la hoja de vida con el texto definido.
    await reply(prisma, candidate.id, from, ASK_CV_TEXT);

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

  // Para cualquier estado legado no previsto, no reinicia y reconduce al formato consolidado.
  await reply(prisma, candidate.id, from, SINGLE_LINE_DATA_TEXT);
}

// Procesa un documento recibido por WhatsApp y lo guarda dentro de PostgreSQL.
async function processDocument(prisma, candidate, from, documentMessage) {
  // Si el candidato ya finalizó, no reprocesa documentos ni reinicia el flujo.
  if (candidate.currentStep === ConversationStep.DONE) {
    await reply(prisma, candidate.id, from, ALREADY_COMPLETED_TEXT);
    return;
  }

  // Si todavía no está en el paso de CV, recuerda el orden correcto del proceso.
  if (candidate.currentStep !== ConversationStep.ASK_CV) {
    await reply(prisma, candidate.id, from, 'Antes de enviar tu hoja de vida debes completar el paso de datos.');
    await reply(prisma, candidate.id, from, SINGLE_LINE_DATA_TEXT);
    return;
  }

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

        // Reglas para flujo finalizado: nunca reiniciar ante tipos no soportados.
        if (candidate.currentStep === ConversationStep.DONE) {
          await reply(prisma, candidate.id, from, ALREADY_COMPLETED_TEXT);
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
