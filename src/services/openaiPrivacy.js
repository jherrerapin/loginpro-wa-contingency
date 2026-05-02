/**
 * openaiPrivacy.js
 * ──────────────────────────────────────────────────────────────────────
 * Utilidades para minimizar datos personales antes de enviar texto a OpenAI.
 *
 * Objetivo:
 * - OpenAI recibe etiquetas como [DOCUMENTO], [TELEFONO] o [NOMBRE_CANDIDATO].
 * - El backend conserva extracción local mínima cuando el dato es claro.
 * - No se intenta reconstruir datos personales desde la respuesta del modelo.
 */

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const CO_PHONE_PATTERN = /\b(?:\+?57\s*)?(3\d{2})[\s.-]?(\d{3})[\s.-]?(\d{4})\b/g;
const DOCUMENT_WITH_TYPE_PATTERN = /\b(CC|C\.C\.|CEDULA|CÉDULA|PPT)\s*(?:NUMERO|NÚMERO|NUM|#|:)?\s*(\d{6,12})\b/gi;
const LONG_NUMBER_PATTERN = /\b\d{7,12}\b/g;
const NAME_PATTERN = /\b(?:ME LLAMO|MI NOMBRE ES|NOMBRE COMPLETO ES|SOY)\s+([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑa-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑa-záéíóúñ]+){1,4})\b/g;

function normalizeDocumentType(value = '') {
  const normalized = String(value || '')
    .trim()
    .toUpperCase()
    .replaceAll('.', '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (['CC', 'CEDULA'].includes(normalized)) return 'CC';
  if (normalized === 'PPT') return 'PPT';
  return null;
}

function titleCaseName(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function pushRedaction(redactions, value) {
  if (value) redactions.add(value);
}

function mergeLocalField(target, key, value) {
  if (value !== undefined && value !== null && String(value).trim() !== '') {
    target[key] = value;
  }
}

export function maskTextForOpenAI(rawText = '') {
  let sanitizedText = String(rawText || '');
  const redactions = new Set();
  const localFields = {};

  sanitizedText = sanitizedText.replace(EMAIL_PATTERN, () => {
    pushRedaction(redactions, 'email');
    return '[EMAIL]';
  });

  sanitizedText = sanitizedText.replace(CO_PHONE_PATTERN, () => {
    pushRedaction(redactions, 'telefono');
    return '[TELEFONO]';
  });

  sanitizedText = sanitizedText.replace(DOCUMENT_WITH_TYPE_PATTERN, (match, rawType, documentNumber) => {
    const documentType = normalizeDocumentType(rawType);
    mergeLocalField(localFields, 'documentType', documentType);
    mergeLocalField(localFields, 'documentNumber', String(documentNumber || '').replace(/\D+/g, ''));
    pushRedaction(redactions, 'documento');
    return '[TIPO_DOCUMENTO] [DOCUMENTO]';
  });

  sanitizedText = sanitizedText.replace(LONG_NUMBER_PATTERN, (match) => {
    if (!localFields.documentNumber) {
      mergeLocalField(localFields, 'documentNumber', String(match || '').replace(/\D+/g, ''));
    }
    pushRedaction(redactions, 'numero_largo');
    return '[NUMERO_LARGO]';
  });

  sanitizedText = sanitizedText.replace(NAME_PATTERN, (match, name) => {
    mergeLocalField(localFields, 'fullName', titleCaseName(name));
    pushRedaction(redactions, 'nombre');
    return match.replace(name, '[NOMBRE_CANDIDATO]');
  });

  return {
    sanitizedText,
    localFields,
    redactionSummary: Array.from(redactions),
    sensitiveDataDetected: redactions.size > 0
  };
}

export function mergeLocalSensitiveFields(modelFields = {}, localFields = {}) {
  return {
    ...(modelFields || {}),
    ...(localFields || {})
  };
}

export function removeMaskedPlaceholdersFromFields(fields = {}) {
  const cleaned = { ...(fields || {}) };
  for (const [key, value] of Object.entries(cleaned)) {
    if (typeof value === 'string' && /\[[A-Z_]+\]/.test(value)) {
      cleaned[key] = null;
    }
  }
  return cleaned;
}

export function buildOpenAIPrivacyMetadata(maskingResult = {}) {
  return {
    privacyMaskingEnabled: true,
    sensitiveDataDetected: Boolean(maskingResult.sensitiveDataDetected),
    redactionSummary: Array.isArray(maskingResult.redactionSummary)
      ? maskingResult.redactionSummary
      : []
  };
}
