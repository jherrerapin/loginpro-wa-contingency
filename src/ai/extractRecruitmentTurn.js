import axios from 'axios';
import { RECRUITMENT_EXTRACTION_SCHEMA } from './recruitmentExtractionSchema.js';

const RESPONSES_URL = 'https://api.openai.com/v1/responses';
const MODEL = 'gpt-5.4-mini-2026-03-17';

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

export async function extractRecruitmentTurn({ text = '', context = {} } = {}) {
  if (!process.env.OPENAI_API_KEY) return { used: false, status: 'disabled', extraction: fallbackResult() };

  const payload = {
    model: MODEL,
    input: [
      {
        role: 'system',
        content: [
          {
            type: 'input_text',
            text: `Extrae entidades de reclutamiento y evidencia verificable. Responde SOLO JSON valido bajo schema estricto.
Reglas criticas:
- Nunca guardes saludos/frases comunes como fullName (ej: "hola", "buenas", "mucho gusto").
- Nunca inferir age desde direcciones como "calle 80", "carrera 7", "apto 302".
- En gender, prioriza evidencia explicita ("soy mujer", "candidata", "soy hombre"). No fuerces inferencia debil.
- Cada campo debe traer evidencia con snippet, source y confidence coherente.
- Si hay ambiguedad real, deja field en null y agrega conflicts con alternatives.
- No converses ni agregues texto fuera del JSON.`
          }
        ]
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: JSON.stringify({ text: String(text || '').slice(0, 3000), context })
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
    const parsed = parseStructuredOutput(response.data) || fallbackResult();
    const base = fallbackResult();
    return {
      used: true,
      status: 'ok',
      extraction: {
        ...base,
        ...parsed,
        fields: { ...base.fields, ...(parsed?.fields || {}) },
        fieldEvidence: { ...base.fieldEvidence, ...(parsed?.fieldEvidence || {}) },
      },
      model: MODEL
    };
  } catch (error) {
    return { used: true, status: 'error', extraction: fallbackResult(), model: MODEL, error };
  }
}
