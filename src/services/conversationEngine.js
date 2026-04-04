/**
 * conversationEngine.js
 * ──────────────────────────────────────────────────────────────────────
 *
 * El cerebro del bot. OpenAI lee la conversación completa, entiende
 * el contexto, decide qué hacer y qué responder — todo de una sola vez.
 *
 * Arquitectura:
 *
 *   1. think()  — OpenAI razona sobre la conversación completa y devuelve:
 *                  - La respuesta que debe enviarle al candidato (texto natural)
 *                  - Las acciones que el sistema debe ejecutar (guardar datos,
 *                    agendar entrevista, marcar rechazo, etc.)
 *                  - El nuevo paso del flujo
 *
 *   2. act()    — El sistema ejecuta las acciones indicadas por OpenAI
 *                  (Prisma, WhatsApp API, scheduler). Nada de lógica de
 *                  negocio aquí — solo efectos secundarios.
 *
 * Por qué este diseño:
 *   Un webhook lleno de if/else con mensajes quemados es un bot de 2018.
 *   OpenAI puede leer "dos añitos", "soy del jordán", "tengo moto propia",
 *   "no me queda ese horario", "cuanto pagan" — y saber exactamente qué
 *   hacer. No necesita que el código le diga cómo interpretar cada frase.
 */

import axios from 'axios';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

// ─────────────────────────────────────────────
// Construcción del contexto para OpenAI
// ─────────────────────────────────────────────

function buildCandidateContext(candidate) {
  const fields = [
    candidate.fullName && `Nombre: ${candidate.fullName}`,
    candidate.documentType && candidate.documentNumber
      && `Documento: ${candidate.documentType} ${candidate.documentNumber}`,
    candidate.age && `Edad: ${candidate.age}`,
    candidate.neighborhood && `Barrio: ${candidate.neighborhood}`,
    candidate.experienceInfo && `Experiencia: ${candidate.experienceInfo}`,
    candidate.experienceTime && `Tiempo de experiencia: ${candidate.experienceTime}`,
    candidate.medicalRestrictions && `Restricciones médicas: ${candidate.medicalRestrictions}`,
    candidate.transportMode && `Transporte: ${candidate.transportMode}`
  ].filter(Boolean);

  return fields.length
    ? `Datos capturados hasta ahora:\n${fields.join('\n')}`
    : 'No se han capturado datos aún.';
}

function buildVacancyContext(vacancy) {
  if (!vacancy) return 'Vacante: no identificada aún.';
  return [
    `Vacante: ${vacancy.title || vacancy.role}`,
    `Cargo: ${vacancy.role}`,
    `Ciudad: ${vacancy.city}`,
    vacancy.operationAddress && `Dirección: ${vacancy.operationAddress}`,
    `Requisitos: ${vacancy.requirements}`,
    `Condiciones: ${vacancy.conditions}`,
    vacancy.requiredDocuments && `Documentación para entrevista: ${vacancy.requiredDocuments}`,
    vacancy.roleDescription && `Descripción del cargo: ${vacancy.roleDescription}`,
    vacancy.schedulingEnabled ? 'Agendamiento de entrevistas: habilitado' : 'Agendamiento: no aplica'
  ].filter(Boolean).join('\n');
}

function buildConversationHistory(recentMessages) {
  if (!recentMessages?.length) return '';
  return recentMessages
    .map((m) => {
      const role = m.direction === 'INBOUND' ? 'Candidato' : 'Bot';
      return `${role}: ${m.body || ''}`;
    })
    .join('\n');
}

function buildNextSlotContext(nextSlot) {
  if (!nextSlot?.slot) return '';
  return [
    `\nPróximo slot de entrevista disponible: ${nextSlot.formattedDate}`,
    !nextSlot.windowOk && nextSlot.windowExtension?.needsWindowExtension
      ? '(Nota: la entrevista está fuera de la ventana de 24h de WhatsApp — se programará re-enganche automático)'
      : ''
  ].filter(Boolean).join(' ');
}

// ─────────────────────────────────────────────
// System prompt — el alma del bot
// ─────────────────────────────────────────────

function buildSystemPrompt({ vacancy, candidate, recentMessages, nextSlot, currentStep }) {
  const candidateName = candidate?.fullName?.split(' ')[0] || null;
  const missingFields = getMissingFields(candidate);
  const hasMissing = missingFields.length > 0;
  const cvPending = !candidate.cvData && currentStep === 'ASK_CV';

  return `Eres un reclutador humano de LoginPro atendiendo candidatos por WhatsApp.
Tu nombre no importa — eres simplemente la persona del equipo de selección.

TONO Y ESTILO:
- Natural, cálido, directo. Como un colombiano trabajando en RRHH.
- Sin listas con viñetas. Sin formato Markdown. Sin negritas.
- Máximo 3-4 oraciones por respuesta.
- Usa el nombre del candidato cuando sea natural, no en cada frase.
- Si el candidato se presenta o saluda, respóndele el saludo antes de pedir datos.
- Si pregunta algo sobre la vacante, respóndelo con la info que tienes.
- Si no sabes algo, sé honesto: "eso lo maneja directamente el equipo, te confirman".
- Nunca digas que eres un bot o IA, a menos que el candidato lo pregunte directamente.
- No repitas frases que ya enviaste antes.

${buildVacancyContext(vacancy)}

${buildCandidateContext(candidate)}
${hasMissing ? `\nDatos que aún faltan: ${missingFields.join(', ')}` : '\nTodos los datos están completos.'}
${cvPending ? '\nEstá pendiente que el candidato envíe su hoja de vida.' : ''}
${buildNextSlotContext(nextSlot)}

PASO ACTUAL DEL FLUJO: ${currentStep}

HISTORIAL RECIENTE:
${buildConversationHistory(recentMessages)}

TU TAREA AHORA:
Lee el último mensaje del candidato, entiende qué quiso decir, y devuelve SOLO un objeto JSON con esta estructura:

{
  "reply": string,           // Lo que le vas a responder al candidato (texto natural, sin Markdown)
  "nextStep": string,        // Paso del flujo: MENU | GREETING_SENT | COLLECTING_DATA | CONFIRMING_DATA | ASK_CV | DONE | SCHEDULING | SCHEDULED
  "actions": [               // Lista de acciones que el sistema debe ejecutar
    {
      "type": string,        // Ver acciones disponibles abajo
      "data": object         // Datos necesarios para la acción
    }
  ],
  "extractedFields": object  // Campos del candidato que pudiste extraer del mensaje (pueden ser 0)
}

ACCIONES DISPONIBLES:
- "save_fields"         — guardar campos del candidato. data: { campos extraidos }
- "request_confirmation" — pedir confirmación de datos al candidato
- "mark_rejected"       — candidato no cumple requisitos. data: { reason, details }
- "offer_interview"     — ofrecer horario de entrevista (requiere nextSlot disponible)
- "confirm_booking"     — confirmar agendamiento (candidato aceptó el horario)
- "reschedule"          — candidato rechazó el horario, ofrecer el siguiente
- "request_cv"          — pedir hoja de vida
- "mark_no_interest"    — candidato expresó que no quiere continuar
- "pause_bot"           — conversación necesita atención humana
- "nothing"             — no se requiere ninguna acción del sistema

CRITERIOS DE RECHAZO (solo marca rejected si aplica):
- Edad claramente fuera del rango definido para la vacante
- Documento vencido o inexistente (candidato lo menciona explícitamente)
- Extranjero sin CE, PPT o Pasaporte

Si el candidato da datos (nombre, edad, barrio, etc.), extéralos en extractedFields,
incluye save_fields en actions, y decide si ya hay suficientes datos para pedir confirmación
o si aún hay campos importantes que faltan (en ese caso, pídeselos de forma natural, no como un formulario).

Devuelve SOLO el JSON. Sin texto antes ni después.`;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

const REQUIRED_FIELDS = [
  'fullName', 'documentType', 'documentNumber', 'age',
  'neighborhood', 'experienceInfo', 'experienceTime',
  'medicalRestrictions', 'transportMode'
];

const FIELD_LABELS = {
  fullName: 'nombre completo',
  documentType: 'tipo de documento',
  documentNumber: 'número de documento',
  age: 'edad',
  neighborhood: 'barrio',
  experienceInfo: 'experiencia en el cargo',
  experienceTime: 'tiempo de experiencia',
  medicalRestrictions: 'restricciones médicas',
  transportMode: 'medio de transporte'
};

function getMissingFields(candidate) {
  return REQUIRED_FIELDS
    .filter((f) => !candidate[f] && candidate[f] !== 0)
    .map((f) => FIELD_LABELS[f]);
}

function parseEngineJson(rawText = '{}') {
  const t = String(rawText || '').trim();
  try { return JSON.parse(t); } catch {
    const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) { try { return JSON.parse(fenced[1].trim()); } catch { /* fall */ } }
    // Último recurso: extraer el objeto JSON del texto
    const objMatch = t.match(/\{[\s\S]*\}/);
    if (objMatch) { try { return JSON.parse(objMatch[0]); } catch { /* fall */ } }
    return null;
  }
}

// ─────────────────────────────────────────────
// think() — el razonamiento central
// ─────────────────────────────────────────────

/**
 * Llama a OpenAI con el contexto completo y obtiene:
 *  - reply: respuesta para el candidato
 *  - nextStep: nuevo paso del flujo
 *  - actions: acciones del sistema a ejecutar
 *  - extractedFields: datos del candidato encontrados en el mensaje
 *
 * @param {object} params
 * @param {string} params.inboundText - último mensaje del candidato
 * @param {object} params.candidate - registro actual del candidato en DB
 * @param {object|null} params.vacancy - vacante actual (puede ser null)
 * @param {Array} params.recentMessages - historial reciente de la conversación
 * @param {object|null} params.nextSlot - próximo slot disponible (si schedulingEnabled)
 * @param {string} params.currentStep - paso actual del flujo
 * @returns {Promise<{
 *   reply: string,
 *   nextStep: string,
 *   actions: Array<{type: string, data: object}>,
 *   extractedFields: object,
 *   raw: object,
 *   fallback: boolean
 * }>}
 */
export async function think({
  inboundText,
  candidate,
  vacancy,
  recentMessages = [],
  nextSlot = null,
  currentStep
}) {
  const fallbackReply = '\u00a1Hola! Gracias por escribir. \u00bfEn qué puedo ayudarte?';

  if (!process.env.OPENAI_API_KEY) {
    return {
      reply: fallbackReply,
      nextStep: currentStep,
      actions: [],
      extractedFields: {},
      raw: null,
      fallback: true
    };
  }

  const systemPrompt = buildSystemPrompt({
    vacancy, candidate, recentMessages, nextSlot, currentStep
  });

  try {
    const response = await axios.post(
      OPENAI_URL,
      {
        model: DEFAULT_MODEL,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: String(inboundText || '') }
        ],
        max_completion_tokens: 600,
        temperature: 0.55
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 18000
      }
    );

    const raw = parseEngineJson(
      response.data?.choices?.[0]?.message?.content || '{}'
    );

    if (!raw || typeof raw.reply !== 'string') {
      console.warn('[ENGINE_PARSE_FAIL]', { phone: candidate?.phone });
      return {
        reply: fallbackReply,
        nextStep: currentStep,
        actions: [],
        extractedFields: {},
        raw,
        fallback: true
      };
    }

    return {
      reply: raw.reply.trim(),
      nextStep: raw.nextStep || currentStep,
      actions: Array.isArray(raw.actions) ? raw.actions : [],
      extractedFields: raw.extractedFields || {},
      raw,
      fallback: false
    };
  } catch (error) {
    console.error('[ENGINE_ERROR]', {
      phone: candidate?.phone,
      error: error?.message?.slice(0, 200)
    });
    return {
      reply: fallbackReply,
      nextStep: currentStep,
      actions: [],
      extractedFields: {},
      raw: null,
      fallback: true
    };
  }
}

// ─────────────────────────────────────────────
// act() — ejecuta las acciones indicadas por think()
// ─────────────────────────────────────────────

/**
 * Ejecuta las acciones que OpenAI ordenó.
 * Solo efectos secundarios — sin lógica de negocio.
 *
 * @param {object} params
 * @param {Array<{type: string, data: object}>} params.actions
 * @param {object} params.candidate
 * @param {string} params.nextStep
 * @param {object|null} params.nextSlot
 * @param {import('@prisma/client').PrismaClient} params.prisma
 * @returns {Promise<void>}
 */
export async function act({ actions, candidate, nextStep, nextSlot, prisma }) {
  const { normalizeCandidateFields } = await import('./candidateData.js');
  const { createBooking } = await import('./interviewScheduler.js');
  const { CandidateStatus, ConversationStep } = await import('@prisma/client');

  for (const action of actions) {
    try {
      switch (action.type) {
        case 'save_fields': {
          const fields = normalizeCandidateFields(action.data || {});
          if (Object.keys(fields).length) {
            await prisma.candidate.update({
              where: { id: candidate.id },
              data: fields
            });
          }
          break;
        }

        case 'mark_rejected': {
          await prisma.candidate.update({
            where: { id: candidate.id },
            data: {
              status: CandidateStatus.RECHAZADO,
              currentStep: ConversationStep.DONE,
              rejectionReason: action.data?.reason || 'No cumple requisitos',
              rejectionDetails: action.data?.details || null,
              reminderScheduledFor: null,
              reminderState: 'SKIPPED'
            }
          });
          break;
        }

        case 'confirm_booking': {
          if (!nextSlot?.slot || !candidate.vacancyId) break;
          await createBooking(
            prisma,
            candidate.id,
            candidate.vacancyId,
            nextSlot.slot.id,
            nextSlot.date,
            !nextSlot.windowOk
          );
          await prisma.candidate.update({
            where: { id: candidate.id },
            data: { currentStep: ConversationStep.SCHEDULED }
          });
          break;
        }

        case 'mark_no_interest': {
          await prisma.candidate.update({
            where: { id: candidate.id },
            data: { currentStep: ConversationStep.DONE }
          });
          break;
        }

        case 'pause_bot': {
          await prisma.candidate.update({
            where: { id: candidate.id },
            data: {
              botPaused: true,
              botPausedAt: new Date(),
              botPauseReason: action.data?.reason || 'Requiere atención humana'
            }
          });
          break;
        }

        // nothing | request_confirmation | offer_interview | reschedule | request_cv
        // — no requieren acción en DB, solo el reply ya fue generado por think()
        default:
          break;
      }
    } catch (err) {
      console.error('[ACT_ERROR]', { action: action.type, error: err?.message?.slice(0, 200) });
    }
  }

  // Actualizar el paso del flujo si cambió
  const validSteps = Object.values(ConversationStep);
  if (nextStep && validSteps.includes(nextStep) && nextStep !== candidate.currentStep) {
    await prisma.candidate.update({
      where: { id: candidate.id },
      data: { currentStep: nextStep }
    }).catch((e) => console.error('[ACT_STEP_UPDATE_ERROR]', e?.message));
  }
}
