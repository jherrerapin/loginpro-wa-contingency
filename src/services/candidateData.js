/**
 * candidateData.js
 *
 * Lightweight extraction and normalization helpers.
 * This module supports the conversational engine; it does not control it.
 */

import { isSuspiciousFullName } from './debugTrace.js';

const NAME_TOKEN_REGEX = /^[A-Za-zÁÉÍÓÚÑáéíóúñ'.-]{2,}$/;
const IMPLICIT_NEIGHBORHOODS = new Set([
  'picalena', 'picaleña', 'boqueron', 'boquerón', 'jordan', 'jordán',
  'salado', 'gaitan', 'combeima', 'modelia', 'centro', 'ciudadela',
  'bolivar', 'simon'
]);
const BIKE_VARIANTS = ['bicicleta', 'bici', 'cicla', 'bicivleta', 'bivivleta', 'bisicleta'];
const MOTO_VARIANTS = ['moto', 'motocicleta'];
const CAR_VARIANTS = ['carro', 'automovil', 'automóvil', 'vehiculo', 'vehículo'];
const BUS_VARIANTS = ['bus', 'buseta', 'transporte publico', 'transporte público', 'servicio publico', 'servicio público'];
const INDEPENDENT_VARIANTS = ['independiente'];
const LOCATION_STOPWORDS = /\b(cc|ti|ce|ppt|pasaporte|documento|edad|experien|restric|medic|salud|transporte|moto|motocicleta|bicicleta|bici|cicla|bicivleta|bivivleta|bisicleta|bus|nombre|hoja de vida|hv|cv|trabaj|independiente)\b/i;

function normalizeLooseText(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function capitalizeWords(str = '') {
  return String(str || '')
    .toLowerCase()
    .replace(/(^|\s)(\S)/g, (_match, space, char) => `${space}${char.toUpperCase()}`)
    .trim();
}

function normalizeDocumentType(value = '') {
  const normalized = String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.\s]+/g, '');

  const map = {
    cc: 'CC',
    cedula: 'CC',
    ceduladeciudadania: 'CC',
    cedulaciudadania: 'CC',
    ccceduladeciudadania: 'CC',
    ti: 'TI',
    tarjetadeidentidad: 'TI',
    ce: 'CE',
    ceduladeextranjeria: 'CE',
    ppt: 'PPT',
    pasaporte: 'Pasaporte'
  };

  return map[normalized] || null;
}

function detectTransportKeyword(text = '') {
  const normalized = normalizeLooseText(text);
  if (!normalized) return null;

  if (/(^|\b)(sin|no tengo|no tiene|ninguno|ninguna)(\b|$)/.test(normalized) && /transporte|vehiculo|vehiculo|moto|bicicleta|carro|bus/.test(normalized)) {
    return 'Sin medio de transporte';
  }
  if (BIKE_VARIANTS.some((variant) => new RegExp(`\\b${normalizeLooseText(variant)}\\b`).test(normalized))) return 'Bicicleta';
  if (MOTO_VARIANTS.some((variant) => new RegExp(`\\b${normalizeLooseText(variant)}\\b`).test(normalized))) return 'Moto';
  if (CAR_VARIANTS.some((variant) => new RegExp(`\\b${normalizeLooseText(variant)}\\b`).test(normalized))) return 'Carro';
  if (BUS_VARIANTS.some((variant) => normalized.includes(normalizeLooseText(variant)))) return 'Bus';
  if (INDEPENDENT_VARIANTS.some((variant) => new RegExp(`\\b${variant}\\b`).test(normalized))) return 'Independiente';
  return null;
}

function detectContextualAge(text = '') {
  const compact = normalizeLooseText(text);
  if (!compact) return null;

  const explicit = compact.match(/\b(?:mi\s+edad\s+es|edad\s*(?:es|:)?|tengo|soy\s+de)\s*(\d{1,2})(?:\s*anos(?:\s+de\s+edad)?)?\b(?!\s+de\s+experiencia)/i);
  const fallback = !/experien/i.test(compact)
    ? compact.match(/^\D*(\d{1,2})(?:\s*anos(?:\s+de\s+edad)?)?\D*$/i)
    : null;
  const rawAge = explicit?.[1] || fallback?.[1];
  if (!rawAge) return null;

  const age = Number.parseInt(rawAge, 10);
  if (!Number.isFinite(age) || age < 14 || age > 80) return null;
  return age;
}

function detectAgeFromSequence(text = '') {
  const segments = String(text || '')
    .split(/[\n,]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  for (const segment of segments) {
    const compact = normalizeLooseText(segment);
    if (!compact || /\d{6,}/.test(compact) || /experien/.test(compact)) continue;
    const match = compact.match(/^(?:edad\s*[:\-]?\s*)?(\d{1,2})(?:\s*anos(?:\s+de\s+edad)?)?$/i);
    if (!match?.[1]) continue;

    const age = Number.parseInt(match[1], 10);
    if (Number.isFinite(age) && age >= 14 && age <= 80) return age;
  }

  return null;
}

function normalizeExperienceTime(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;

  const wordToNum = {
    un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
    seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11,
    doce: 12, trece: 13, catorce: 14, quince: 15
  };

  let normalized = raw;
  for (const [word, num] of Object.entries(wordToNum)) {
    normalized = normalized.replace(new RegExp(`\\b${word}\\b`, 'i'), String(num));
  }

  const match = normalized.match(/(\d+)\s*(mes(?:e|es)?|a[nñ]os?|semanas?)/i);
  if (!match) return capitalizeWords(raw);

  const amount = Number.parseInt(match[1], 10);
  let unit = match[2].toLowerCase();
  if (unit.startsWith('mes')) unit = amount === 1 ? 'mes' : 'meses';
  else if (unit.match(/^a[nñ]/)) unit = amount === 1 ? 'año' : 'años';
  else if (unit.startsWith('semana')) unit = amount === 1 ? 'semana' : 'semanas';

  return `${amount} ${unit}`;
}

function normalizeMedicalRestrictions(value = '') {
  const raw = String(value || '').trim();
  const normalized = normalizeLooseText(raw);
  if (!normalized) return null;
  if (/^(no tengo restricciones?( medicas?)?|no cuento con restricciones?( medicas?)?|sin restricciones?( medicas?)?|sin ninguna restriccion|ninguna restriccion)$/.test(normalized)) {
    return 'Sin restricciones médicas';
  }
  return capitalizeWords(raw);
}

export function normalizeTransportMode(value = '') {
  const normalized = normalizeLooseText(value);
  if (!normalized) return null;

  if (
    ['sin medio de transporte', 'sin transporte', 'ninguno', 'ninguna', 'no tengo transporte', 'no tengo medio de transporte', 'no tiene', 'no tengo', 'sin vehiculo', 'sin vehículo'].includes(normalized)
    || /^(?:no\s+(?:tengo|tiene|cuento con)|sin)\b/.test(normalized)
  ) {
    return 'Sin medio de transporte';
  }

  const detected = detectTransportKeyword(normalized);
  if (detected) return detected;
  return capitalizeWords(normalized);
}

function cleanLocationValue(value = '') {
  return String(value || '')
    .replace(/\b(?:localidad|comuna|zona|sector|barrio|vereda|ciudadela)\s*[:\-]?\s*/i, '')
    .replace(/\b(?:y\s+tengo|tengo|con|y)\b.*$/i, '')
    .replace(/^[,;:\-\s]+|[,;:\-\s]+$/g, '')
    .trim();
}

function looksLikeLocationChunk(value = '') {
  const normalized = normalizeLooseText(cleanLocationValue(value));
  if (!normalized || normalized.length < 3 || normalized.length > 40) return false;
  if (/\d{3,}/.test(normalized)) return false;
  if (LOCATION_STOPWORDS.test(normalized)) return false;
  if (detectTransportKeyword(normalized)) return false;

  const words = normalized.split(' ').filter(Boolean);
  if (!words.length || words.length > 4) return false;
  return words.every((word) => /^[a-zñ]+$/.test(word) && word.length > 1);
}

function detectLocationFromSequence(text = '') {
  const segments = String(text || '')
    .split(/[\n,]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  let locality = null;
  for (const segment of segments) {
    const localityMatch = segment.match(/\b(?:localidad|comuna|zona)\s*[:\-]?\s*([^,.\n]{2,60})/i);
    if (localityMatch?.[1]) {
      locality = capitalizeWords(cleanLocationValue(localityMatch[1]));
      break;
    }
  }

  let neighborhood = null;
  for (let index = 1; index < Math.min(segments.length, 6); index += 1) {
    const segment = segments[index];
    if (!looksLikeLocationChunk(segment)) continue;
    neighborhood = capitalizeWords(cleanLocationValue(segment));
    break;
  }

  return { neighborhood, locality };
}

function normalizeExperienceInfo(value = '') {
  const normalized = normalizeLooseText(value);
  if (!normalized) return null;
  if ((/\b(no|sin|ninguna|ninguno|nunca)\b/.test(normalized) && /experien/.test(normalized)) || normalized === 'no') return 'No';
  if ((/\b(si|yes|tengo|cuento con|poseo)\b/.test(normalized) && /experien/.test(normalized)) || normalized === 'si' || normalized === 'sí') return 'Sí';
  return null;
}

function detectDocumentTypeHint(text = '') {
  const patterns = [
    /\b(?:tipo(?:\s+de)?\s+documento|documento|identificacion|identificación)\s*(?:es|:|-)?\s*(c\.?\s*c\.?|c[ée]dula(?:\s+(?:de\s+)?ciudadan[ií]a)?|t\.?\s*i\.?|tarjeta\s+de\s+identidad|c\.?\s*e\.?|c[ée]dula\s+de\s+extranjer[ií]a|pasaporte|ppt)\b/i,
    /\b(c[ée]dula\s+de\s+extranjer[ií]a|tarjeta\s+de\s+identidad|pasaporte|ppt)\b/i
  ];

  for (const pattern of patterns) {
    const match = String(text || '').match(pattern);
    if (match?.[1]) return normalizeDocumentType(match[1]);
  }

  return null;
}

function detectExperienceTime(text = '') {
  const compact = normalizeLooseText(text);
  if (!compact || !/\b(experien|trabaj|labor|cargo|oficio)\b/.test(compact)) return null;

  const match = compact.match(/\b((?:un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|\d+)\s*(?:mes(?:e|es)?|a[nñ]os?|semanas?))(?:\s+de\s+experiencia|\s+trabajando|\s+en\s+el\s+cargo|\s+laborando)?\b/i);
  if (!match?.[1]) return null;
  return normalizeExperienceTime(match[1]);
}

function hasNameTokens(candidate = '') {
  const parts = candidate.split(/\s+/).filter(Boolean);
  if (parts.length < 2 || parts.length > 4) return false;
  return parts.every((part) => NAME_TOKEN_REGEX.test(part));
}

function detectLeadingName(text = '') {
  const compact = String(text || '').trim();
  if (!compact) return null;

  const prefixed = compact.match(
    /(?:me\s+llamo|soy|mi\s+nombre\s+es|nombre\s*[:\-]?)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ][A-Za-zÁÉÍÓÚÑáéíóúñ'\-.\s]{3,60})/i
  );
  if (prefixed?.[1]) return capitalizeWords(prefixed[1]);

  const leading = compact.match(
    /^\s*([A-Za-zÁÉÍÓÚÑáéíóúñ][A-Za-zÁÉÍÓÚÑáéíóúñ'\-.]*(?:\s+[A-Za-zÁÉÍÓÚÑáéíóúñ][A-Za-zÁÉÍÓÚÑáéíóúñ'\-.]*){1,3})(?=\s+(?:c\.?\s*c\.?|c[ée]dula|t\.?\s*i\.?|c\.?\s*e\.?|pasaporte|ppt|\d))/i
  );
  if (leading?.[1]) {
    const cleaned = leading[1].replace(/\b(cc|ti|ce|ppt|pasaporte)\b$/i, '').trim();
    if (!hasNameTokens(cleaned)) return null;
    const candidate = capitalizeWords(cleaned);
    if (!isSuspiciousFullName(candidate)) return candidate;
  }

  const firstChunk = compact.split(/[\n,]/)[0]?.trim() || '';
  if (hasNameTokens(firstChunk)) {
    const candidate = capitalizeWords(firstChunk);
    if (!isSuspiciousFullName(candidate)) return candidate;
  }

  return null;
}

export function parseNaturalData(text = '') {
  const result = {};
  const compact = String(text || '').replace(/\n/g, ', ').replace(/\s+/g, ' ').trim();
  let remaining = String(text || '');

  const docRegex = /\b(c\.?\s*c\.?|c[ée]dula(?:\s+(?:de\s+)?ciudadan[ií]a)?|t\.?\s*i\.?|tarjeta\s+de\s+identidad|c\.?\s*e\.?|c[ée]dula\s+de\s+extranjer[íi]a|pasaporte|ppt)\s*(?:es|:|\-|#|,|\.|\s)+\s*(\d{6,12})\b/i;
  const docMatch = compact.match(docRegex) || remaining.match(docRegex);
  if (docMatch) {
    result.documentType = normalizeDocumentType(docMatch[1]) || docMatch[1].toUpperCase();
    result.documentNumber = docMatch[2];
    remaining = remaining.replace(docMatch[0], ' ');
  }

  if (!result.documentType) {
    result.documentType = detectDocumentTypeHint(compact);
  }

  if (!result.documentNumber) {
    const docNum = remaining.match(/(?:^|\s)(\d{7,12})(?:\s|$)/);
    if (docNum) {
      result.documentNumber = docNum[1];
      remaining = remaining.replace(docNum[1], ' ');
    }
  }

  const detectedAge = detectContextualAge(compact);
  if (detectedAge !== null) result.age = detectedAge;
  if (result.age === undefined) {
    const ageFromSequence = detectAgeFromSequence(text);
    if (ageFromSequence !== null) result.age = ageFromSequence;
  }

  const neighborhoodMatch = compact.match(/\b(?:barrio|zona|sector|localidad|vereda|ciudadela)\s*[:\-]?\s*([^,.\n]{2,60})/i)
    || remaining.match(/\b(?:barrio|zona|sector|localidad|vereda|ciudadela)\s*[:\-]?\s*([^,.\n]{2,60})/i);
  if (neighborhoodMatch) {
    const cleaned = neighborhoodMatch[1].replace(/\b(y\s+tengo|tengo|con|y)\b.*$/i, '').trim();
    const normalized = capitalizeWords(cleaned);
    result.neighborhood = /^ciudadela/i.test(neighborhoodMatch[0]) && !/^ciudadela\s+/i.test(normalized)
      ? `Ciudadela ${normalized}`.trim()
      : normalized;
    remaining = remaining.replace(neighborhoodMatch[0], ' ');
  }

  if (!result.neighborhood) {
    const ciudadelaSimon = compact.match(/\bciudadela\s+simon\s+bolivar\b/i) || compact.match(/\bsimon\s+bolivar\b/i);
    if (ciudadelaSimon) result.neighborhood = 'Ciudadela Simon Bolivar';
  }

  if (!result.neighborhood) {
    const tokens = String(text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
    const implicit = tokens.find((token) => IMPLICIT_NEIGHBORHOODS.has(token));
    if (implicit) result.neighborhood = capitalizeWords(implicit);
  }

  if (!result.neighborhood || !result.locality) {
    const inferredLocation = detectLocationFromSequence(text);
    if (!result.locality && inferredLocation.locality) result.locality = inferredLocation.locality;
    if (!result.neighborhood && inferredLocation.neighborhood) result.neighborhood = inferredLocation.neighborhood;
  }

  const medicalNegative = /\b(no\s+tengo\s+restricciones?(\s+medicas?)?|sin\s+restricciones?(\s+medicas?)?|ninguna\s+restriccion)\b/i.test(normalizeLooseText(compact));
  if (medicalNegative) result.medicalRestrictions = 'Sin restricciones médicas';

  const transportNegative = compact.match(/\b(?:no\s+(?:tengo|cuento\s+con)\s+(?:medio\s+de\s+transporte|transporte|moto|bicicleta|bici|carro|bus)|sin\s+medio\s+de\s+transporte)\b/i);
  if (transportNegative) result.transportMode = 'Sin medio de transporte';

  if (!result.transportMode) {
    const transportPositive = compact.match(/\b(?:mi\s+medio\s+de\s+transporte\s+es|medio\s+de\s+transporte\s*:|transporte\s*:|transporte\s+es|tengo|cuento con|si tengo|manejo|me movilizo en|voy en|independiente\s*-\s*bus)\b/i);
    if (transportPositive && detectTransportKeyword(compact)) {
      result.transportMode = normalizeTransportMode(compact);
    }
  }

  if (!result.transportMode && /^(?:en\s+)?[a-záéíóúñ]+$/i.test(compact)) {
    const directTransport = compact.replace(/^en\s+/i, '');
    if (detectTransportKeyword(directTransport)) {
      result.transportMode = normalizeTransportMode(directTransport);
    }
  }

  const negativeExperience = normalizeExperienceInfo(compact);
  if (negativeExperience) result.experienceInfo = negativeExperience;

  const experienceTime = detectExperienceTime(compact);
  if (experienceTime) {
    result.experienceTime = experienceTime;
    if (!result.experienceInfo) result.experienceInfo = 'Sí';
  }

  const positiveExperience = /\b(tengo experiencia|cuento con experiencia|si tengo experiencia|tengo mas de|he trabajado|trabaje|trabajando)\b/i.test(normalizeLooseText(compact));
  if (!result.experienceInfo && positiveExperience) result.experienceInfo = 'Sí';

  const detectedName = detectLeadingName(text);
  if (detectedName) result.fullName = detectedName;

  return result;
}

export function normalizeCandidateFields(fields = {}) {
  const normalized = {};

  if (fields.fullName) normalized.fullName = capitalizeWords(fields.fullName);
  if (fields.documentType) {
    normalized.documentType = normalizeDocumentType(fields.documentType) || String(fields.documentType).trim();
  }
  if (fields.documentNumber) {
    normalized.documentNumber = String(fields.documentNumber).replace(/\D/g, '');
  }
  if (fields.age !== undefined && fields.age !== null && fields.age !== '') {
    const age = Number.parseInt(String(fields.age), 10);
    if (Number.isFinite(age)) normalized.age = age;
  }
  if (fields.neighborhood) normalized.neighborhood = capitalizeWords(fields.neighborhood);
  if (fields.locality) normalized.locality = capitalizeWords(fields.locality);
  if (fields.medicalRestrictions) normalized.medicalRestrictions = normalizeMedicalRestrictions(fields.medicalRestrictions);
  if (fields.transportMode) normalized.transportMode = normalizeTransportMode(fields.transportMode);
  if (fields.experienceInfo) normalized.experienceInfo = normalizeExperienceInfo(fields.experienceInfo) || capitalizeWords(fields.experienceInfo);
  if (fields.experienceTime) normalized.experienceTime = normalizeExperienceTime(fields.experienceTime);

  return normalized;
}

export function isHighConfidenceLocalField(field, value) {
  const raw = String(value ?? '').trim();
  if (!raw) return false;

  if (field === 'age') {
    const age = Number.parseInt(raw, 10);
    return Number.isFinite(age) && age >= 14 && age <= 80;
  }
  if (field === 'fullName') return !isSuspiciousFullName(raw) && hasNameTokens(raw);
  if (field === 'neighborhood') return raw.length >= 3;
  if (field === 'locality') return raw.length >= 3;
  if (field === 'medicalRestrictions') {
    return /sin restricciones|no tengo restricciones|ninguna restriccion/i.test(raw) || raw.length >= 8;
  }
  if (field === 'transportMode') {
    return /^(moto|motocicleta|bicicleta|bici|cicla|bicivleta|bivivleta|bisicleta|carro|automovil|automóvil|vehiculo|vehículo|bus|buseta|transporte publico|transporte público|servicio publico|servicio público|independiente|sin medio de transporte|no tiene|no tengo)$/i.test(raw);
  }
  if (field === 'experienceInfo') return /^(si|sí|no)$/i.test(raw);
  if (field === 'experienceTime') return /\d+\s*(mes|meses|ano|años|anos|semanas?)/i.test(normalizeLooseText(raw));
  return true;
}

export function hasMeaningfulCandidateData(fields = {}) {
  const normalized = normalizeCandidateFields(fields);
  return Object.entries(normalized).some(([field, value]) => {
    if (value === undefined || value === null || value === '') return false;
    return isHighConfidenceLocalField(field, value);
  });
}
