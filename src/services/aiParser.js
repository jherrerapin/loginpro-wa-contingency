/**
 * aiParser.js — Sprint 2 v2
 *
 * Cerebro del bot. Recibe el contexto completo de la conversación y retorna
 * un JSON estructurado con la decisión que el webhook debe ejecutar.
 *
 * Cambios frente a v1:
 * - runAITurn(): nueva función principal con historial + contexto dinámico
 * - buildSystemPrompt(): system prompt dinámico con vacantes, estado y reglas
 * - buildVacancyCatalogBlock(): formatea vacantes para el prompt de forma compacta
 * - Soporte a imágenes (GPT Vision) vía imageBase64
 * - Compatibilidad con gpt-4.1-nano (sin temperature, max_tokens reducido)
 * - tryOpenAIParse() se mantiene para compatibilidad con código legado
 */

import axios from 'axios';

const OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';

// ---------------------------------------------------------------------------
// Utilidades internas
// ---------------------------------------------------------------------------

function extractTextFromChatCompletion(data = {}) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part?.type === 'text' && typeof part?.text === 'string') return part.text;
        return '';
      })
      .join('')
      .trim();
  }
  return '{}';
}

function parseModelJson(rawText = '{}') {
  const normalized = String(rawText || '').trim();
  if (!normalized) return {};
  try {
    return JSON.parse(normalized);
  } catch {
    const fencedMatch = normalized.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fencedMatch?.[1]) {
      try { return JSON.parse(fencedMatch[1].trim()); } catch { return {}; }
    }
    return {};
  }
}

function summarizeOpenAIError(error) {
  const status = error?.response?.status ? `HTTP ${error.response.status}` : null;
  const code = error?.code || null;
  const name = error?.name || 'Error';
  const message = typeof error?.message === 'string' ? error.message.slice(0, 180) : null;
  const apiMessage = typeof error?.response?.data?.error?.message === 'string'
    ? error.response.data.error.message.slice(0, 220)
    : null;
  return [name, status, code, apiMessage || message || 'Unexpected error'].filter(Boolean).join(' | ');
}

// ---------------------------------------------------------------------------
// Builder del bloque de vacantes para el system prompt
// Compacto para no desperdiciar tokens en gpt-4.1-nano
// ---------------------------------------------------------------------------

function buildVacancyCatalogBlock(activeVacancies = []) {
  if (!activeVacancies.length) return 'Sin vacantes activas en este momento.';

  return activeVacancies.map((v) => {
    const lines = [
      `KEY: ${v.key}`,
      `TITULO: ${v.title}`,
      `CARGO: ${v.cargo || v.title}`,
      `CIUDAD: ${v.city}`,
    ];
    if (v.salary)            lines.push(`SALARIO: ${v.salary}`);
    if (v.schedule)          lines.push(`HORARIO: ${v.schedule}`);
    if (v.contractType)      lines.push(`CONTRATO: ${v.contractType}`);
    if (v.requirementsSummary) lines.push(`REQUISITOS: ${v.requirementsSummary}`);
    if (v.profile)           lines.push(`PERFIL: ${v.profile}`);
    if (v.operationAddress)  lines.push(`DIRECCION_OPERACION: ${v.operationAddress}`);
    if (v.requiresLocality)  {
      const zones = Array.isArray(v.operationZones) ? v.operationZones.join(', ') : (v.operationZones || '');
      lines.push(`REQUIERE_LOCALIDAD: true`);
      if (zones) lines.push(`ZONAS_VIABLES: ${zones}`);
    }
    lines.push(`REQUIERE_ENTREVISTA: ${v.requiresInterview ? 'true' : 'false'}`);
    if (v.botIntroText)      lines.push(`INTRO: ${v.botIntroText}`);
    if (v.adTextHints)       lines.push(`HINTS: ${v.adTextHints}`);
    const aliases = Array.isArray(v.aliases) ? v.aliases.join(', ') : (v.aliases || '');
    if (aliases)             lines.push(`ALIASES: ${aliases}`);
    return lines.join('\n');
  }).join('\n---\n');
}

// ---------------------------------------------------------------------------
// Builder del estado actual del candidato para el system prompt
// ---------------------------------------------------------------------------

function buildCandidateStateBlock(candidateState = {}) {
  const fields = [
    ['Nombre completo', candidateState.fullName],
    ['Tipo de documento', candidateState.documentType],
    ['Numero de documento', candidateState.documentNumber],
    ['Edad', candidateState.age],
    ['Barrio/Sector', candidateState.neighborhood],
    ['Localidad/Municipio', candidateState.locality],
    ['Experiencia (Si/No)', candidateState.experienceInfo],
    ['Tiempo de experiencia', candidateState.experienceTime],
    ['Restricciones medicas', candidateState.medicalRestrictions],
    ['Medio de transporte', candidateState.transportMode],
    ['CV subido', candidateState.hasCv ? 'Si' : null],
  ];

  const filled = fields.filter(([, val]) => val !== null && val !== undefined && val !== '');
  if (!filled.length) return 'Sin datos recolectados aun.';
  return filled.map(([label, val]) => `${label}: ${val}`).join('\n');
}

// ---------------------------------------------------------------------------
// Builder del system prompt dinámico
// Disenado para ser compacto y efectivo con gpt-4.1-nano
// ---------------------------------------------------------------------------

function buildSystemPrompt({ activeVacancies = [], candidateState = {}, currentVacancyKey = null, availableSlots = [] } = {}) {
  const currentVacancy = currentVacancyKey
    ? activeVacancies.find((v) => v.key === currentVacancyKey)
    : null;

  const slotsBlock = availableSlots.length
    ? availableSlots.map((s) => `- ID:${s.id} | ${s.label}`).join('\n')
    : 'Sin horarios configurados.';

  return `Eres un reclutador de LoginPro por WhatsApp para una empresa de logistica colombiana.
Tu tono es cordial, claro y profesional. Usas lenguaje natural colombiano.
Respondes SIEMPRE en JSON valido con exactamente estas claves:
{
  "intent": string,
  "vacancyKey": string|null,
  "fields": object,
  "proximityVerdict": "viable"|"no_viable"|"unknown",
  "reply": string,
  "action": string,
  "interviewSlotId": string|null
}

VALORES PERMITIDOS para "intent":
greeting, apply_intent, provide_data, provide_correction, confirmation_yes,
confirmation_no_or_correction, cv_ready, cv_declined, interview_accept,
interview_decline, interview_reschedule, faq, thanks, farewell,
post_completion_ack, unsupported_file_or_message

VALORES PERMITIDOS para "action":
ask_vacancy, save_vacancy, save_fields, ask_locality, confirm_proximity_ko,
request_confirm_data, save_confirmed_data, request_cv, schedule_interview,
confirm_interview, close, send_info, noop

REGLAS CRITICAS:
1. Si el candidato NO ha identificado vacante aun: action=ask_vacancy, vacancyKey=null.
2. Si el candidato identifica una vacante: action=save_vacancy, vacancyKey=<key exacta del catalogo>.
3. Diferencia EDAD de TIEMPO DE EXPERIENCIA. "22 anos" sin contexto laboral = edad. NUNCA pongas edad en experienceTime.
4. Si detectas documentos (CC, TI, CE, PPT, Pasaporte) extrae documentType y documentNumber de una sola vez.
5. Si la vacante tiene REQUIERE_LOCALIDAD=true: pide localidad y evalua si es VIABLE segun ZONAS_VIABLES. Si no hay zonas configuradas, evalua por logica geografica general de Colombia.
6. proximityVerdict: "viable" si la localidad/municipio del candidato es razonablemente cercana a la operacion. "no_viable" si esta claramente lejos. "unknown" si no hay localidad aun o no aplica.
7. Si proximity="no_viable": action=confirm_proximity_ko, reply explicando amablemente que la ubicacion puede ser un inconveniente pero sin rechazar definitivamente.
8. NUNCA rechaces automaticamente a un candidato. Solo informa y deja que el reclutador decida.
9. Si la vacante tiene REQUIERE_ENTREVISTA=false: action=request_cv cuando ya esten todos los datos, luego action=close con mensaje de "quedaste registrado, te contactaremos".
10. Si la vacante tiene REQUIERE_ENTREVISTA=true: despues del CV, ofrece el slot mas proximo disponible para entrevista.
11. Para agendar entrevista: action=schedule_interview, interviewSlotId=<id del slot elegido>.
12. "fields" solo contiene los campos detectados en ESTE mensaje. No repitas campos ya guardados.
13. El campo "reply" es el mensaje EXACTO que se enviara al candidato. Sin JSON, sin corchetes, texto natural.
14. Si recibes una imagen: intenta detectar la vacante por el contenido visual del anuncio.
15. Nunca inventes datos que el candidato no haya proporcionado.

VACANTES ACTIVAS:
${buildVacancyCatalogBlock(activeVacancies)}

VACANTE ACTUAL DEL CANDIDATO: ${currentVacancyKey || 'No identificada aun'}

DATO DEL CANDIDATO YA RECOLECTADOS:
${buildCandidateStateBlock(candidateState)}

HORARIOS DE ENTREVISTA DISPONIBLES:
${slotsBlock}`;
}

// ---------------------------------------------------------------------------
// runAITurn — función principal del Sprint 2
// ---------------------------------------------------------------------------

/**
 * Ejecuta un turno completo del bot con contexto de conversación.
 *
 * @param {object} params
 * @param {Array}  params.conversationHistory  - Historial [{role, content}] (max 15)
 * @param {object} params.candidateState       - Campos ya recolectados del candidato
 * @param {Array}  params.activeVacancies      - Catalo de vacantes activas
 * @param {string} params.currentVacancyKey    - Key de la vacante ya identificada (o null)
 * @param {Array}  params.availableSlots       - Slots [{id, label}] para entrevistas
 * @param {string} params.imageBase64          - Base64 de imagen si el mensaje era foto
 * @param {string} params.imageMimeType        - MIME de la imagen (image/jpeg, etc.)
 * @returns {Promise<object>} Resultado con intent, fields, reply, action, etc.
 */
export async function runAITurn({
  conversationHistory = [],
  candidateState = {},
  activeVacancies = [],
  currentVacancyKey = null,
  availableSlots = [],
  imageBase64 = null,
  imageMimeType = 'image/jpeg'
} = {}) {
  if (!process.env.OPENAI_API_KEY) {
    return {
      used: false,
      status: 'disabled',
      intent: null,
      action: 'noop',
      reply: null,
      fields: {},
      vacancyKey: null,
      proximityVerdict: 'unknown',
      interviewSlotId: null
    };
  }

  const model = process.env.OPENAI_MODEL || 'gpt-4.1-nano';
  const systemPrompt = buildSystemPrompt({ activeVacancies, candidateState, currentVacancyKey, availableSlots });

  // Construir mensajes: system + historial (max 15) + mensaje actual con imagen si aplica
  const recentHistory = conversationHistory.slice(-15);

  // Si hay imagen, el ultimo mensaje del usuario se convierte en multimodal
  let messages;
  if (imageBase64 && recentHistory.length > 0) {
    const lastUserIdx = [...recentHistory].map((m) => m.role).lastIndexOf('user');
    if (lastUserIdx >= 0) {
      const withVision = [...recentHistory];
      const lastUserMsg = withVision[lastUserIdx];
      withVision[lastUserIdx] = {
        role: 'user',
        content: [
          { type: 'text', text: typeof lastUserMsg.content === 'string' ? lastUserMsg.content : 'Imagen recibida' },
          { type: 'image_url', image_url: { url: `data:${imageMimeType};base64,${imageBase64}`, detail: 'low' } }
        ]
      };
      messages = [{ role: 'system', content: systemPrompt }, ...withVision];
    } else {
      messages = [
        { role: 'system', content: systemPrompt },
        ...recentHistory,
        { role: 'user', content: [
          { type: 'text', text: 'Imagen recibida del candidato' },
          { type: 'image_url', image_url: { url: `data:${imageMimeType};base64,${imageBase64}`, detail: 'low' } }
        ]}
      ];
    }
  } else {
    messages = [{ role: 'system', content: systemPrompt }, ...recentHistory];
  }

  const payload = {
    model,
    response_format: { type: 'json_object' },
    messages,
    max_completion_tokens: 500
  };

  try {
    const response = await axios.post(
      OPENAI_CHAT_COMPLETIONS_URL,
      payload,
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );

    const parsed = parseModelJson(extractTextFromChatCompletion(response.data));

    return {
      used: true,
      status: 'ok',
      model,
      intent: parsed.intent || null,
      vacancyKey: parsed.vacancyKey || null,
      fields: parsed.fields || {},
      proximityVerdict: parsed.proximityVerdict || 'unknown',
      reply: typeof parsed.reply === 'string' ? parsed.reply.trim() : null,
      action: parsed.action || 'noop',
      interviewSlotId: parsed.interviewSlotId || null
    };
  } catch (error) {
    const summarized = summarizeOpenAIError(error);
    const wrappedError = new Error(summarized);
    wrappedError.name = error?.name || 'OpenAIError';
    wrappedError.code = error?.code;
    wrappedError.response = error?.response ? { status: error.response.status } : undefined;

    return {
      used: true,
      status: 'error',
      model,
      intent: null,
      action: 'noop',
      reply: null,
      fields: {},
      vacancyKey: null,
      proximityVerdict: 'unknown',
      interviewSlotId: null,
      error: wrappedError
    };
  }
}

// ---------------------------------------------------------------------------
// Compatibilidad legada — tryOpenAIParse se mantiene pero delega a runAITurn
// Usar solo para flujos que aun no se migraron al nuevo webhook
// ---------------------------------------------------------------------------

/**
 * @deprecated Usar runAITurn() en su lugar.
 * Se mantiene para no romper imports existentes durante la migracion.
 */
export async function tryOpenAIParse(text) {
  if (!process.env.OPENAI_API_KEY) {
    return { used: false, status: 'disabled', intent: null, parsedFields: {} };
  }

  const result = await runAITurn({
    conversationHistory: [{ role: 'user', content: String(text || '') }],
    candidateState: {},
    activeVacancies: [],
    currentVacancyKey: null,
    availableSlots: []
  });

  return {
    used: result.used,
    status: result.status,
    intent: result.intent,
    parsedFields: result.fields,
    model: result.model,
    error: result.error
  };
}

// Exportaciones de utilidades para tests y otros servicios
export { extractTextFromChatCompletion, parseModelJson, summarizeOpenAIError, buildSystemPrompt, buildVacancyCatalogBlock };
