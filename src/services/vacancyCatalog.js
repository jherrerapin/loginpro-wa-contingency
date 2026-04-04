/**
 * vacancyCatalog.js — Sprint 2 v2
 *
 * Rol actualizado: solo gestiona el catalogo de vacantes y construye
 * el contexto para el system prompt de runAITurn().
 *
 * La deteccion de vacante por regex/scoring fue movida al modelo de IA.
 * detectVacancyAndCity() se mantiene como fallback legado pero no se usa
 * en el nuevo flujo del webhook.
 */

const DEFAULT_NEUTRAL_VACANCY_PROMPT = 'Para orientarte mejor, \u00bfsobre cu\u00e1l oferta nos escribes? Puedes decirme el cargo o la ciudad del anuncio.';

export const DEFAULT_VACANCY_SEED = Object.freeze([
  {
    key: 'auxiliar_cargue_descargue_ibague',
    title: 'Auxiliar de Cargue y Descargue',
    cargo: 'Auxiliar Log\u00edstico',
    city: 'Ibagu\u00e9',
    description: 'Apoyo operativo en cargue y descargue para operaci\u00f3n log\u00edstica.',
    profile: 'Persona con buena condici\u00f3n f\u00edsica y disponibilidad de turnos.',
    salary: null,
    schedule: null,
    contractType: null,
    operationAddress: null,
    requiresLocality: false,
    operationZones: null,
    requiresInterview: false,
    botIntroText: 'Estamos buscando personal para operaci\u00f3n log\u00edstica en Ibagu\u00e9.',
    requirementsSummary: 'Pago quincenal, turnos rotativos, contrato obra labor y medio de transporte.',
    adTextHints: 'anuncio auxiliar logistico ibague cargue descargue aeropuerto operacion turnos',
    aliases: ['auxiliar', 'cargue', 'descargue', 'aeropuerto', 'operario logistico'],
    isActive: true,
    displayOrder: 1
  },
  {
    key: 'coordinador_ibague',
    title: 'Coordinador',
    cargo: 'Coordinador Operativo',
    city: 'Ibagu\u00e9',
    description: 'Coordinaci\u00f3n operativa y seguimiento de equipo en campo.',
    profile: 'Perfil de liderazgo, orden y experiencia coordinando personal.',
    salary: null,
    schedule: null,
    contractType: null,
    operationAddress: null,
    requiresLocality: false,
    operationZones: null,
    requiresInterview: false,
    botIntroText: 'Tenemos una oferta para coordinar operaci\u00f3n en Ibagu\u00e9.',
    requirementsSummary: 'Experiencia liderando equipos, seguimiento operativo y reportes b\u00e1sicos.',
    adTextHints: 'anuncio coordinador ibague liderazgo operacion supervisor equipo',
    aliases: ['coordinador', 'coordinadora', 'lider', 'coordinaci\u00f3n', 'supervisor'],
    isActive: true,
    displayOrder: 2
  }
]);

function normalizeText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function toAliasList(aliases) {
  if (Array.isArray(aliases)) return aliases.map((item) => String(item || '').trim()).filter(Boolean);
  if (typeof aliases === 'string') {
    const trimmed = aliases.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map((item) => String(item || '').trim()).filter(Boolean);
    } catch {
      return trimmed.split(',').map((item) => item.trim()).filter(Boolean);
    }
  }
  return [];
}

/**
 * Retorna las vacantes activas ordenadas para pasar al system prompt de runAITurn.
 * Agrega los campos nuevos del Sprint 1 si existen en el objeto.
 */
export function getActiveVacancyCatalog(vacancies = []) {
  return (vacancies || [])
    .filter((vacancy) => Boolean(vacancy?.isActive))
    .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0))
    .map((vacancy) => ({
      ...vacancy,
      aliases: toAliasList(vacancy.aliases),
      operationZones: Array.isArray(vacancy.operationZones)
        ? vacancy.operationZones
        : (typeof vacancy.operationZones === 'string' ? [vacancy.operationZones] : []),
      requiresLocality: Boolean(vacancy.requiresLocality),
      requiresInterview: Boolean(vacancy.requiresInterview)
    }));
}

/**
 * Construye el saludo inicial de la vacante para el primer mensaje del bot.
 * Se sigue usando en webhook.js al detectar la vacante.
 */
export function buildVacancyGreeting(vacancy) {
  if (!vacancy) return null;
  const lines = [
    'Hola, gracias por comunicarte con LoginPro.',
    `Te comparto la informaci\u00f3n de la oferta: *${vacancy.title || 'Vacante'}* (${vacancy.city || 'Ciudad por confirmar'}).`
  ];
  if (vacancy.cargo && vacancy.cargo !== vacancy.title) lines.push(`Cargo: ${vacancy.cargo}`);
  if (vacancy.botIntroText) lines.push(vacancy.botIntroText);
  const conditions = [vacancy.salary, vacancy.schedule, vacancy.contractType].filter(Boolean);
  if (conditions.length) lines.push(`Condiciones: ${conditions.join(' | ')}`);
  if (vacancy.requirementsSummary) lines.push(`Requisitos clave: ${vacancy.requirementsSummary}`);
  lines.push('Si deseas continuar, resp\u00f3ndeme y te solicitar\u00e9 tus datos.');
  return lines.filter(Boolean).join('\n\n');
}

// ---------------------------------------------------------------------------
// Compatibilidad legada
// detectVacancyAndCity() y scoreVacancy() se mantienen pero NO se usan
// en el nuevo flujo. El modelo de IA hace este trabajo en runAITurn().
// ---------------------------------------------------------------------------

function scoreVacancy(text, vacancy) {
  const nText = normalizeText(text);
  if (!nText) return { score: 0, sources: [] };
  const scoreParts = [];
  const nTitle = normalizeText(vacancy.title);
  const nCity = normalizeText(vacancy.city);
  const keyParts = String(vacancy.key || '').split('_').filter((part) => part.length > 2).map((part) => normalizeText(part));
  const aliasParts = (vacancy.aliases || []).map((alias) => normalizeText(alias));
  const adHintParts = normalizeText(vacancy.adTextHints || '')
    .split(/[\s,.;:\n]+/).map((item) => item.trim()).filter((item) => item.length > 2);
  if (nTitle && nText.includes(nTitle)) scoreParts.push({ score: 4, source: 'title' });
  if (nCity && nText.includes(nCity)) scoreParts.push({ score: 2, source: 'city' });
  for (const keyPart of keyParts) if (keyPart && nText.includes(keyPart)) scoreParts.push({ score: 1, source: 'key' });
  for (const alias of aliasParts) if (alias && nText.includes(alias)) scoreParts.push({ score: 2, source: 'alias' });
  for (const hint of adHintParts) if (hint && nText.includes(hint)) scoreParts.push({ score: 1.5, source: 'ad_text_hints' });
  const score = scoreParts.reduce((total, item) => total + item.score, 0);
  const sources = [...new Set(scoreParts.map((item) => item.source))];
  return { score, sources };
}

/** @deprecated Usar runAITurn() para detecci\u00f3n de vacante. */
export function detectVacancyAndCity({ text = '', activeVacancies = [], currentVacancyKey = null } = {}) {
  const catalog = getActiveVacancyCatalog(activeVacancies);
  const nText = normalizeText(text);
  const cityScores = new Map();
  for (const vacancy of catalog) {
    const city = normalizeText(vacancy.city);
    if (!city) continue;
    if (!cityScores.has(city)) cityScores.set(city, { cityKey: city, score: 0, source: 'vacancy_catalog' });
    if (nText.includes(city)) { cityScores.get(city).score += 1; cityScores.get(city).source = 'text'; }
  }
  const ordered = [...cityScores.values()].sort((a, b) => b.score - a.score);
  const best = ordered[0] || { cityKey: null, score: 0, source: 'none' };
  const cityDetection = { cityKey: best.cityKey, confidence: best.score >= 1 ? 0.9 : 0, source: best.score >= 1 ? best.source : 'none' };
  const scored = catalog.map((vacancy) => { const s = scoreVacancy(text, vacancy); return { vacancy, score: s.score, sources: s.sources }; }).sort((a, b) => b.score - a.score);
  const top = scored[0];
  const correctionHint = /(corrijo|quise decir|mejor|de hecho|actualizo|no es)/.test(nText);
  const current = currentVacancyKey ? catalog.find((v) => v.key === currentVacancyKey) : null;
  if (current && !correctionHint) {
    const cs = scoreVacancy(text, current).score;
    if (!top || cs >= top.score) return { vacancyDetection: { vacancyKey: current.key, confidence: cs > 0 ? 0.9 : 0.82, source: cs > 0 ? 'context+text' : 'context', detected: true }, cityDetection, suggestedNextAction: 'collect_or_confirm' };
  }
  if (!top || top.score < 2) return { vacancyDetection: { vacancyKey: null, confidence: 0, source: 'none', detected: false }, cityDetection, suggestedNextAction: 'ask_which_vacancy' };
  const second = scored[1];
  if (second && second.score > 0 && Math.abs(top.score - second.score) <= 1) return { vacancyDetection: { vacancyKey: null, confidence: 0.4, source: 'ambiguous', detected: false }, cityDetection, suggestedNextAction: 'ask_which_vacancy' };
  return { vacancyDetection: { vacancyKey: top.vacancy.key, confidence: Math.min(0.98, 0.4 + (top.score * 0.08)), source: top.sources[0] || 'text', detected: true }, cityDetection, suggestedNextAction: 'collect_or_confirm' };
}

export { DEFAULT_NEUTRAL_VACANCY_PROMPT };
