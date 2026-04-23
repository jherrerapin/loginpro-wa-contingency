import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeAttachment } from '../src/services/attachmentAnalyzer.js';
import { buildPolicyReply } from '../src/services/responsePolicy.js';
import { runReminderDispatcher, scheduleReminderForCandidate } from '../src/services/reminder.js';
import { applyFieldPolicy } from '../src/services/policyLayer.js';
import { createMockPrisma } from './helpers/mockPrisma.js';
import { createWhatsappMock } from './helpers/mockWhatsapp.js';
import { installOpenAIMock } from './helpers/mockOpenAI.js';

test('saludo no se persiste como fullName', () => {
  const result = applyFieldPolicy({
    fields: { fullName: 'hola buenas tardes' },
    fieldEvidence: { fullName: { snippet: 'hola buenas tardes', confidence: 0.95, source: 'responses_extractor' } }
  });

  assert.equal(result.persistedFields.fullName, undefined);
  assert.equal(result.blocked[0]?.reason, 'greeting_as_name');
});

test('calle 80 nunca se persiste como edad', () => {
  const result = applyFieldPolicy({
    fields: { age: 80 },
    fieldEvidence: { age: { snippet: 'vivo en calle 80', confidence: 0.93, source: 'responses_extractor' } }
  });

  assert.equal(result.persistedFields.age, undefined);
  assert.equal(result.blocked[0]?.reason, 'address_as_age');
});

test('género femenino explícito se persiste con evidencia sólida', () => {
  const result = applyFieldPolicy({
    fields: { gender: 'FEMALE' },
    fieldEvidence: { gender: { snippet: 'soy mujer', confidence: 0.91, source: 'responses_extractor' } }
  });

  assert.equal(result.persistedFields.gender, 'FEMALE');
});

test('género ambiguo no debe usarse para decisiones duras', () => {
  const result = applyFieldPolicy({
    fields: { gender: 'FEMALE' },
    fieldEvidence: { gender: { snippet: 'me llamo Alex', confidence: 0.6, source: 'name_inference' } }
  });

  assert.equal(result.persistedFields.gender, undefined);
  assert.equal(result.reviewQueue[0]?.reason, 'weak_gender_inference');
  assert.equal(result.shouldPreventAutoDiscard, true);
});

test('documento no CV se clasifica OTHER y no CV_VALID', async () => {
  const buffer = Buffer.from('certificado bancario de apertura de cuenta');
  const result = await analyzeAttachment({
    buffer,
    mimeType: 'application/pdf',
    filename: 'certificado.pdf'
  });

  assert.notEqual(result.classification, 'CV_VALID');
  assert.equal(result.classification, 'OTHER');
});

test('imagen no se clasifica automáticamente como CV_IMAGE_ONLY', async () => {
  const result = await analyzeAttachment({
    buffer: Buffer.from('fake-image-content'),
    mimeType: 'image/jpeg',
    filename: 'foto.jpg'
  });

  assert.notEqual(result.classification, 'CV_IMAGE_ONLY');
});

test('responsePolicy mantiene intención para pedir HV en PDF/Word', () => {
  const result = buildPolicyReply({ replyIntent: 'request_cv_pdf_word', recentOutbound: [] });
  assert.equal(result.intent, 'request_cv_pdf_word');
  assert.match(result.text, /PDF|Word/i);
});

test('responsePolicy soporta request_missing_data con intención determinista', () => {
  const result = buildPolicyReply({ replyIntent: 'request_missing_data', recentOutbound: [] });
  assert.equal(result.intent, 'request_missing_data');
  assert.match(result.text, /dato/i);
});

test('responsePolicy evita repetición fuerte incluso por similitud semántica', () => {
  const repeated = 'Perfecto, para seguir me falta tu HV en PDF o Word (.doc/.docx).';
  const result = buildPolicyReply({
    replyIntent: 'request_cv_pdf_word',
    recentOutbound: [{ body: 'Perfecto para seguir me falta tu hoja de vida en PDF o Word doc docx' }]
  });
  assert.notEqual(result.text, repeated);
});

test('campo crítico ambiguo activa protección de autodescarte', () => {
  const result = applyFieldPolicy({
    fields: { age: 17 },
    fieldEvidence: { age: { snippet: 'creo que tengo 17', confidence: 0.4, source: 'responses_extractor' } }
  });

  assert.equal(result.shouldPreventAutoDiscard, true);
  assert.deepEqual(result.protectedDiscardFields, ['age']);
});

test('scheduleReminderForCandidate encola reminder a una hora', async () => {
  process.env.FF_POSTGRES_JOB_QUEUE = 'true';
  const now = new Date('2026-04-23T10:00:00.000Z');
  const candidate = {
    id: 'cand-queue-1',
    reminderState: 'NONE',
    reminderScheduledFor: null,
    status: 'NUEVO',
    currentStep: 'COLLECTING_DATA',
    botPaused: false,
    lastInboundAt: new Date('2026-04-23T09:30:00.000Z')
  };
  const updates = [];
  const jobs = [];
  const prisma = {
    candidate: {
      findUnique: async () => candidate,
      update: async ({ data }) => { updates.push(data); return { ...candidate, ...data }; }
    },
    jobQueue: {
      create: async ({ data }) => { jobs.push(data); return data; }
    }
  };

  await scheduleReminderForCandidate(prisma, candidate.id, now);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].type, 'interview_reminder');
  assert.equal(new Date(jobs[0].runAt).toISOString(), '2026-04-23T11:00:00.000Z');
  assert.equal(updates[0].reminderState, 'SCHEDULED');
  delete process.env.FF_POSTGRES_JOB_QUEUE;
});

test('keepalive se corta si entrevista inactiva o reminder ya intentado', async () => {
  process.env.META_PHONE_NUMBER_ID = 'meta-phone-id';
  process.env.META_ACCESS_TOKEN = 'meta-access-token';
  const now = new Date('2026-04-23T21:00:00.000Z');
  const prisma = createMockPrisma({
    candidates: [{
      id: 'cand-k-1',
      phone: '573001001001',
      currentStep: 'SCHEDULED',
      reminderState: 'NONE',
      lastInboundAt: new Date('2026-04-23T20:00:00.000Z'),
      botPaused: false
    }],
    interviewBookings: [{
      id: 'book-k-1',
      candidateId: 'cand-k-1',
      vacancyId: 'vac',
      slotId: 'slot',
      scheduledAt: new Date('2026-04-23T22:00:00.000Z'),
      status: 'CONFIRMED',
      reminderSentAt: new Date('2026-04-23T20:30:00.000Z'),
      reminderWindowClosed: false
    }]
  });
  const whatsappMock = createWhatsappMock();
  const restoreAxios = installOpenAIMock({ whatsappMock });

  try {
    await runReminderDispatcher(prisma, { now });
    assert.equal(whatsappMock.sentMessages.length, 0);
  } finally {
    restoreAxios();
  }
});
