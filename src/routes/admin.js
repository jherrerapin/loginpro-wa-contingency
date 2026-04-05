// Importa Express para crear el router del panel administrativo.
import express from 'express';
import ExcelJS from 'exceljs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { normalizeCandidateFields } from '../services/candidateData.js';
import { exportFilenameByScope, filterCandidatesByScope, normalizeCandidateStatusForUI } from '../services/candidateExport.js';
import { sendTextMessage } from '../services/whatsapp.js';
import { MessageDirection, MessageType } from '@prisma/client';
import { buildTechnicalOutboundCandidateUpdate } from '../services/adminOutboundPolicy.js';
import { describeResumeBehavior } from '../services/botAutomationPolicy.js';

// Middleware de autenticación por sesión para proteger el dashboard.
function sessionAuth(req, res, next) {
  const role = req.session?.userRole;
  if (!role) return res.redirect('/login');
  req.userRole = role;
  return next();
}

function normalizeString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function formatDateTimeCO(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
}

function formatTimeCO(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  }).format(date);
}

/**
 * Retorna { start, end } como objetos Date (UTC) que cubren
 * el día completo en zona Colombia para la fecha dada.
 * @param {string} dateStr  YYYY-MM-DD en hora Colombia
 */
function colombiaDayBounds(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const startUTC = new Date(Date.UTC(year, month - 1, day,     5,  0,  0,   0));
  const endUTC   = new Date(Date.UTC(year, month - 1, day + 1, 4, 59, 59, 999));
  return { start: startUTC, end: endUTC };
}

/**
 * Retorna la fecha de hoy en Colombia como string YYYY-MM-DD.
 */
function todayCO() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

/**
 * Valida que un string sea YYYY-MM-DD.
 */
function isValidDateString(str) {
  return typeof str === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(str);
}

const STATUS_LABELS = {
  'NUEVO': 'Nuevo',
  'REGISTRADO': 'Registrado',
  'VALIDANDO': 'Registrado',
  'APROBADO': 'Registrado',
  'RECHAZADO': 'Rechazado',
  'CONTACTADO': 'Contactado'
};

const ADMIN_STATUS_SCOPES = new Set(['registered', 'new', 'contacted', 'rejected', 'all']);
const EXPORT_SCOPES = new Set(['registered', 'missing_cv_complete', 'new', 'contacted', 'rejected', 'all']);

const STATUS_SCOPE_SUMMARY_LABELS = {
  registered: 'registrados',
  new: 'nuevos',
  contacted: 'contactados',
  rejected: 'rechazados',
  all: 'totales'
};

const ALLOWED_CV_MIMES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]);
const ALLOWED_CV_EXTENSIONS = new Set(['.pdf', '.doc', '.docx']);

function buildCvStatusQuery(type, message) {
  const params = new URLSearchParams();
  params.set(type, message);
  return params.toString();
}

function isAllowedCvFile(file) {
  const extension = path.extname(file.originalname || '').toLowerCase();
  if (ALLOWED_CV_MIMES.has(file.mimetype)) return true;
  const mimeMissingOrGeneric = !file.mimetype || file.mimetype === 'application/octet-stream';
  return mimeMissingOrGeneric && ALLOWED_CV_EXTENSIONS.has(extension);
}

function normalizeBinaryData(value) {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  return Buffer.from(value);
}

function ensureDevRole(req, res, next) {
  if (req.userRole !== 'dev') return res.status(403).send('Acceso restringido a desarrolladores');
  return next();
}

const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;

async function getOutboundWindowStatus(prisma, candidateId, now = new Date()) {
  const lastInbound = await prisma.message.findFirst({
    where: { candidateId, direction: MessageDirection.INBOUND },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true }
  });
  const lastInboundAt = lastInbound?.createdAt || null;
  const isOpen = Boolean(lastInboundAt) && (now.getTime() - new Date(lastInboundAt).getTime()) <= WHATSAPP_WINDOW_MS;
  return { hasInbound: Boolean(lastInboundAt), lastInboundAt, isOpen };
}

function outboundTemplates(candidate) {
  return {
    request_missing_data: 'Hola 👋 Para continuar con tu postulación, por favor envíame los datos faltantes que aún no has compartido.',
    request_hv: 'Hola 👋 Para continuar tu proceso necesito tu Hoja de vida (HV) en PDF o Word (.doc/.docx).',
    reminder: 'Te recuerdo que tu proceso sigue activo. Si deseas continuar, comparte la información faltante o tu Hoja de vida (HV).'
  };
}

function toHexPreview(buffer, maxBytes = 16) {
  if (!buffer || !buffer.length) return '';
  return buffer.subarray(0, maxBytes).toString('hex');
}

function shouldValidatePdfSignature(filename = '', mimeType = '') {
  return mimeType === 'application/pdf' || path.extname(filename || '').toLowerCase() === '.pdf';
}

function hasPdfSignature(buffer) {
  if (!buffer || buffer.length < 5) return false;
  return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
}

/**
 * Construye la estructura de datos del dashboard por ciudad/vacante.
 */
async function buildDashboardData(prisma, dateStr) {
  const { start, end } = colombiaDayBounds(dateStr);

  const vacancies = await prisma.vacancy.findMany({
    where: { acceptingApplications: true },
    orderBy: [{ city: 'asc' }, { title: 'asc' }],
    include: {
      interviewBookings: {
        where: {
          scheduledAt: { gte: start, lte: end },
          status: { in: ['SCHEDULED', 'CONFIRMED', 'RESCHEDULED'] }
        },
        include: {
          candidate: {
            select: {
              id: true, fullName: true, phone: true,
              documentType: true, documentNumber: true,
              age: true, neighborhood: true, status: true,
              cvData: true, gender: true
            }
          }
        },
        orderBy: { scheduledAt: 'asc' }
      },
      candidates: {
        where: {
          status: { in: ['NUEVO', 'REGISTRADO', 'VALIDANDO', 'APROBADO', 'CONTACTADO'] }
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, fullName: true, phone: true,
          documentType: true, documentNumber: true,
          age: true, neighborhood: true, status: true,
          cvData: true, gender: true, createdAt: true,
          interviewBookings: {
            where: { status: { in: ['SCHEDULED', 'CONFIRMED', 'RESCHEDULED'] } },
            select: { id: true }
          }
        }
      }
    }
  });

  const legacyCandidates = await prisma.candidate.findMany({
    where: {
      vacancyId: null,
      status: { in: ['NUEVO', 'REGISTRADO', 'VALIDANDO', 'APROBADO', 'CONTACTADO'] }
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true, fullName: true, phone: true,
      documentType: true, documentNumber: true,
      age: true, neighborhood: true, status: true,
      cvData: true, createdAt: true
    }
  });

  const citiesMap = new Map();
  const ATTENDED_STATUSES = new Set(['RECHAZADO', 'CONTACTADO']);

  for (const v of vacancies) {
    const city = v.city || 'Sin ciudad';
    if (!citiesMap.has(city)) citiesMap.set(city, []);

    const bookedCandidateIds = new Set(v.candidates
      .filter(c => c.interviewBookings.length > 0)
      .map(c => c.id));

    const enriched = {
      ...v,
      bookingsToday: v.interviewBookings.map(b => ({
        ...b,
        formattedTime: formatTimeCO(b.scheduledAt),
        formattedDateTime: formatDateTimeCO(b.scheduledAt)
      })),
      registeredNoBooking: v.schedulingEnabled
        ? v.candidates.filter(c => !bookedCandidateIds.has(c.id) && !ATTENDED_STATUSES.has(c.status))
        : [],
      cvOnlyPipeline: !v.schedulingEnabled
        ? v.candidates
        : []
    };

    citiesMap.get(city).push(enriched);
  }

  const cities = Array.from(citiesMap.entries()).map(([name, vacs]) => ({ name, vacancies: vacs }));
  return { cities, legacyCandidates };
}

// ─────────────────────────────────────────────────────────────
// Helpers para el CRUD de vacantes
// ─────────────────────────────────────────────────────────────

function parseVacancyBody(body) {
  const str = (v) => (typeof v === 'string' ? v.trim() || null : null);
  const int = (v) => { const n = parseInt(v, 10); return Number.isNaN(n) ? null : n; };
  const bool = (v) => v === 'true' || v === true || v === 'on';

  return {
    title:                str(body.title),
    city:                 str(body.city),
    key:                  str(body.key),
    role:                 str(body.role),
    description:          str(body.description),
    requirements:         str(body.requirements),
    conditions:           str(body.conditions),
    operationAddress:     str(body.operationAddress),
    minAge:               int(body.minAge),
    maxAge:               int(body.maxAge),
    experienceRequired:   str(body.experienceRequired) || 'INDIFFERENT',
    isActive:             bool(body.isActive),
    acceptingApplications: bool(body.acceptingApplications),
    schedulingEnabled:    bool(body.schedulingEnabled),
  };
}

/**
 * Carga las operaciones con su ciudad para los selects del modal.
 * Si el modelo Operation no existe todavía en el schema, devuelve [].
 */
async function loadOperations(prisma) {
  try {
    return await prisma.operation.findMany({
      orderBy: [{ city: { name: 'asc' } }, { name: 'asc' }],
      include: { city: { select: { name: true } } }
    });
  } catch {
    // El modelo aún no existe en esta versión del schema
    return [];
  }
}

// Expone el router administrativo.
export function adminRouter(prisma) {
  const router = express.Router();
  const cvUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }
  }).single('cvFile');

  router.use(sessionAuth);

  // ─────────────────────────────────────────────
  // Ruta principal: dashboard por ciudad/vacante.
  // ─────────────────────────────────────────────
  router.get('/', async (req, res) => {
    const requestedStatus = normalizeString(req.query.status);
    if (requestedStatus && ADMIN_STATUS_SCOPES.has(requestedStatus)) {
      const allCandidates = await prisma.candidate.findMany({
        orderBy: { createdAt: 'desc' },
        take: 200
      });
      const candidates = filterCandidatesByScope(allCandidates, requestedStatus);
      return res.render('list', {
        mode: 'legacy',
        candidates,
        formatDateTimeCO,
        role: req.userRole,
        activeStatusScope: requestedStatus,
        summaryLabel: STATUS_SCOPE_SUMMARY_LABELS[requestedStatus] || STATUS_SCOPE_SUMMARY_LABELS.all,
        normalizeCandidateStatusForUI,
        cities: [],
        legacyCandidates: [],
        activeCity: null,
        selectedDate: todayCO(),
        todayStr: todayCO()
      });
    }

    const rawDate = normalizeString(req.query.date);
    const selectedDate = isValidDateString(rawDate) ? rawDate : todayCO();
    const { cities, legacyCandidates } = await buildDashboardData(prisma, selectedDate);

    const rawCity = normalizeString(req.query.city);
    const availableCities = cities.map(c => c.name);
    const activeCity = (rawCity && availableCities.includes(rawCity))
      ? rawCity
      : (availableCities[0] || null);

    return res.render('list', {
      mode: 'vacancies',
      cities,
      legacyCandidates,
      activeCity,
      selectedDate,
      todayStr: todayCO(),
      formatDateTimeCO,
      formatTimeCO,
      role: req.userRole,
      normalizeCandidateStatusForUI,
      candidates: [],
      activeStatusScope: null,
      summaryLabel: ''
    });
  });

  // ─────────────────────────────────────────────
  // CRUD de vacantes
  // ─────────────────────────────────────────────

  /** GET /admin/vacancies — lista todas las vacantes */
  router.get('/vacancies', async (req, res) => {
    const [vacancies, operations] = await Promise.all([
      prisma.vacancy.findMany({
        orderBy: [{ city: 'asc' }, { title: 'asc' }]
      }),
      loadOperations(prisma)
    ]);
    const successMsg = normalizeString(req.query.success);
    const errorMsg   = normalizeString(req.query.error);
    res.render('vacancies', { vacancies, operations, role: req.userRole, successMsg, errorMsg });
  });

  /** POST /admin/vacancies/create — crear nueva vacante */
  router.post('/vacancies/create', express.urlencoded({ extended: true }), async (req, res) => {
    const data = parseVacancyBody(req.body);

    if (!data.title || !data.city || !data.key) {
      return res.redirect('/admin/vacancies?error=' + encodeURIComponent('Título, ciudad y clave son obligatorios.'));
    }

    // Verifica que la key no exista ya
    const existing = await prisma.vacancy.findFirst({ where: { key: data.key } });
    if (existing) {
      return res.redirect('/admin/vacancies?error=' + encodeURIComponent('Ya existe una vacante con esa clave (' + data.key + '). Elige otra.'));
    }

    await prisma.vacancy.create({
      data: {
        id:        randomUUID(),
        key:       data.key,
        title:     data.title,
        city:      data.city,
        role:      data.role,
        description:          data.description,
        requirements:         data.requirements,
        conditions:           data.conditions,
        operationAddress:     data.operationAddress,
        minAge:               data.minAge,
        maxAge:               data.maxAge,
        experienceRequired:   data.experienceRequired,
        isActive:             data.isActive,
        acceptingApplications: data.acceptingApplications,
        schedulingEnabled:    data.schedulingEnabled,
      }
    });

    res.redirect('/admin/vacancies?success=' + encodeURIComponent('Vacante "' + data.title + '" creada correctamente.'));
  });

  /** POST /admin/vacancies/:id/edit — actualizar vacante */
  router.post('/vacancies/:id/edit', express.urlencoded({ extended: true }), async (req, res) => {
    const { id } = req.params;
    const data = parseVacancyBody(req.body);

    if (!data.title || !data.city || !data.key) {
      return res.redirect('/admin/vacancies?error=' + encodeURIComponent('Título, ciudad y clave son obligatorios.'));
    }

    // Verifica que la key no la use otra vacante
    const conflict = await prisma.vacancy.findFirst({
      where: { key: data.key, NOT: { id } }
    });
    if (conflict) {
      return res.redirect('/admin/vacancies?error=' + encodeURIComponent('La clave "' + data.key + '" ya está en uso por otra vacante.'));
    }

    await prisma.vacancy.update({
      where: { id },
      data: {
        key:       data.key,
        title:     data.title,
        city:      data.city,
        role:      data.role,
        description:          data.description,
        requirements:         data.requirements,
        conditions:           data.conditions,
        operationAddress:     data.operationAddress,
        minAge:               data.minAge,
        maxAge:               data.maxAge,
        experienceRequired:   data.experienceRequired,
        isActive:             data.isActive,
        acceptingApplications: data.acceptingApplications,
        schedulingEnabled:    data.schedulingEnabled,
      }
    });

    res.redirect('/admin/vacancies?success=' + encodeURIComponent('Vacante "' + data.title + '" actualizada correctamente.'));
  });

  /** POST /admin/vacancies/:id/toggle — activar/pausar vacante */
  router.post('/vacancies/:id/toggle', async (req, res) => {
    const { id } = req.params;
    const vacancy = await prisma.vacancy.findUnique({ where: { id } });
    if (!vacancy) return res.redirect('/admin/vacancies?error=' + encodeURIComponent('Vacante no encontrada.'));

    const isCurrentlyOpen = vacancy.isActive && vacancy.acceptingApplications;
    await prisma.vacancy.update({
      where: { id },
      data: {
        isActive:             isCurrentlyOpen ? true  : true,
        acceptingApplications: isCurrentlyOpen ? false : true,
      }
    });

    const msg = isCurrentlyOpen ? 'Vacante pausada.' : 'Vacante reactivada.';
    res.redirect('/admin/vacancies?success=' + encodeURIComponent(msg));
  });

  return router;
}
