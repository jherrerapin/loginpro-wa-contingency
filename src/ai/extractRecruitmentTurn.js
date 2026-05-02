import axios from 'axios';
import { RECRUITMENT_EXTRACTION_SCHEMA } from './recruitmentExtractionSchema.js';
import {
  buildOpenAIPrivacyMetadata,
  maskTextForOpenAI,
  mergeLocalSensitiveFields,
  removeMaskedPlaceholdersFromFields
} from '../services/openaiPrivacy.js';
import { logOpenAIUsage } from '../services/openaiUsageLogger.js';

const RESPONSES_URL = 'https://api.openai.com/v1/responses';
const MODEL = process.env.OPENAI_EXTRACTION_MODEL || process.env.OPENAI_MODEL || 'gpt-5.5-2026-04-23';

function fallbackResult() {
  return {
    turnType: 'OTHER',
    fields: {
      fullName: null,
      age: null,
      documentType: null,
      documentNumber: null,
      gender: null,
      locality: null,
      neighborhood: null,
      transportMode: null,
      medicalRestrictions: null,
      experienceInfo: null
    },
    fieldEvidence: {
      fullName: { snippet: null, confidence: 0, source: 'fallback' },
      age: { snippet: null, confidence: 0, source: 'fallback' },
      documentType: { snippet: null, confidence: 0, source: 'fallback' },
      documentNumber: { snippet: null, confidence: 0, source: 'fallback' },
      gender: { snippet: null, confidence: 0, source: 'fallback' },
      locality: { snippet: null, confidence: 0, source: 'fallback' },
      neighborhood: { snippet: null, confidence: 0, source: 'fallback' },
      transportMode: { snippet: null, confidence: 0, source: 'fallback' },
      medicalRestrictions: { snippet: null, confidence: 0, source: 'fallback' },
      experienceInfo: { snippet: null, confidence: 0, source: 'fallback' }
    },
    conflicts: [],
    attachment: { mentioned: false, kindHint: null },
    replyIntent: 'continue_flow'
  };
}

function parseStructuredOutput(data = {}) {
  const output = data?.output || [];
  for (const item of output) {
    const content = item?.content || [];
    for (const part of content) {
      const parsed = part?.parsed;
      if (parsed && typeof parsed === 'object') return parsed;
      const text = part?.text;
      if (typeof text === 'string') {
        try { return JSON.parse(text); } catch {}
      }
    }
  }
  return null;
}

function maskRecentConversation(recentConversation = []) {
  return recentConversation.slice(-12).map((item) => {
    if (typeof item === 'string') return maskTextForOpenAI(item).sanitizedText;
    if (!item || typeof item !== 'object') return item;
    return {
      ...item,
      body: item.body ? maskTextForOpenAI(item.body).sanitizedText : item.body,
      text: item.text ? maskTextForOpenAI(item.text).sanitizedText : item.text
    };
  });
}

function maskCandidateKnownData(candidateKnownData = null) {
  if (!candidateKnownData || typeof candidateKnownData !== 'object') return candidateKnownData;
  return {
    ...candidateKnownData,
    fullName: candidateKnownData.fullName ? '[NOMBRE_CANDIDATO]' : candidateKnownData.fullName,
    documentNumber: candidateKnownData.documentNumber ? '[DOCUMENTO]' : candidateKnownData.documentNumber,
    phone: candidateKnownData.phone ? '[TELEFONO]' : candidateKnownData.phone
  };
}

function buildContextPayload(maskedText = '', context = {}) {
  return {
    candidateMessage: String(maskedText || '').slice(0, 3000),
    conversationContext: {
      currentStep: context.currentStep || null,
      pendingFields: Array.isArray(context.pendingFields) ? context.pendingFields : [],
      lastBotQuestion: context.lastBotQuestion || null,
      recentConversation: Array.isArray(context.recentConversation) ? maskRecentConversation(context.recentConversation) : [],
      vacancy: context.vacancy || null,
      candidateKnownData: maskCandidateKnownData(context.candidateKnownData || null)
    }
  };
}

function resolvePrisma(context = {}) {
  return context.prisma || context.db || null;
}

export async function extractRecruitmentTurn({ text = '', context = {} } = {}) {
  if (!process.env.OPENAI_API_KEY) return { used: false, status: 'disabled', extraction: fallbackResult() };

  const privacy = maskTextForOpenAI(text);
  const payload = {
    model: MODEL,
    input: [
      {
        role: 'system',
        content: [
          {
            type: 'input_text',
            text: `Eres el módulo de comprensión conversacional de un reclutador por WhatsApp.
Tu tarea no es responder al candidato; tu tarea es entender el turno completo y devolver datos estructurados bajo el schema.

Privacidad:
El mensaje puede contener etiquetas como [DOCUMENTO], [TELEFONO], [EMAIL], [NUMERO_LARGO] o [NOMBRE_CANDIDATO].
No reconstruyas ni inventes datos personales enmascarados.
Si un dato personal está enmascarado, deja el campo en null; el backend agregará campos locales detectados antes del enmascaramiento.

Principios de interpretación:
- Usa el mensaje actual junto con el contexto de conversación, especialmente la última pregunta del bot, el paso actual y los campos pendientes.
- Interpreta respuestas implícitas cuando el candidato responde a una pregunta anterior, aunque no repita el nombre técnico del campo.
- Distingue entre intención conversacional, datos del candidato, correcciones, dudas y adjuntos.
- No persistas como dato un fragmento que solo cumple función conversacional dentro del turno.
- No infieras datos sensibles o excluyentes sin evidencia verificable en el mensaje o en el contexto.
- Si el turno es ambiguo, deja el campo en null y registra el conflicto en vez de inventar.
- Cada campo que no sea null debe traer evidencia: snippet tomado del candidato, source y confidence.
- Devuelve solo JSON válido bajo el schema estricto.`
          }
        ]
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: JSON.stringify(buildContextPayload(privacy.sanitizedText, context))
          }
        ]
      }
    ],
    text: {
      format: {
        type: 'json_schema',
        name: RECRUITMENT_EXTRACTION_SCHEMA.name,
        strict: RECRUITMENT_EXTRACTION_SCHEMA.strict,
        schema: RECRUITMENT_EXTRACTION_SCHEMA.schema
      }
    }
  };

  try {
    const response = await axios.post(RESPONSES_URL, payload, {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });

    await logOpenAIUsage(resolvePrisma(context), {
      responseData: response.data,
      modelRequested: MODEL,
      usageType: 'responses_extractor',
      candidate: context.candidate || context.candidateKnownData || null,
      messageId: context.messageId || null,
      privacy: buildOpenAIPrivacyMetadata(privacy)
    });

    const parsed = parseStructuredOutput(response.data) || fallbackResult();
    const base = fallbackResult();
    const modelFields = removeMaskedPlaceholdersFromFields(parsed?.fields || {});
    const mergedFields = mergeLocalSensitiveFields(modelFields, privacy.localFields);

    return {
      used: true,
      status: 'ok',
      extraction: {
        ...base,
        ...parsed,
        fields: { ...base.fields, ...mergedFields },
        fieldEvidence: { ...base.fieldEvidence, ...(parsed?.fieldEvidence || {}) },
      },
      model: MODEL,
      privacyRedactions: privacy.redactionSummary
    };
  } catch (error) {
    return { used: true, status: 'error', extraction: fallbackResult(), model: MODEL, error };
  }
}
