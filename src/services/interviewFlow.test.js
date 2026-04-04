/**
 * interviewFlow.test.js — Sprint 4
 *
 * Tests unitarios del flujo de entrevistas.
 * Usa un mock de Prisma liviano (sin base de datos real).
 * Ejecutar con: node --test src/services/interviewFlow.test.js
 */

import { strict as assert } from 'assert';
import { test, describe, beforeEach } from 'node:test';
import { buildSlotLabel, buildSlotsMenu, buildReminderMessage, processReminderResponse } from './interviewFlow.js';

// ---------------------------------------------------------------------------
// buildSlotLabel
// ---------------------------------------------------------------------------
describe('buildSlotLabel', () => {
  test('formatea martes 7 de abril a las 10:00 a.m.', () => {
    // 2026-04-07T10:00:00 Colombia = UTC-5 = 15:00 UTC
    const d = new Date('2026-04-07T15:00:00.000Z');
    const label = buildSlotLabel(d);
    assert.ok(label.includes('10:00'), `esperaba 10:00 en "${label}"`);
    assert.ok(label.includes('abril'), `esperaba "abril" en "${label}"`);
    assert.ok(label.includes('a.m.'), `esperaba "a.m." en "${label}"`);
  });

  test('formatea las 2:30 p.m. correctamente', () => {
    const d = new Date('2026-04-08T19:30:00.000Z'); // 2:30 p.m. COT
    const label = buildSlotLabel(d);
    assert.ok(label.includes('p.m.'), `esperaba "p.m." en "${label}"`);
    assert.ok(label.includes('2:30'), `esperaba "2:30" en "${label}"`);
  });
});

// ---------------------------------------------------------------------------
// buildSlotsMenu
// ---------------------------------------------------------------------------
describe('buildSlotsMenu', () => {
  test('retorna null si no hay slots', () => {
    assert.equal(buildSlotsMenu([]), null);
  });

  test('numera los slots correctamente', () => {
    const slots = [
      { label: 'lunes 6 de abril a las 9:00 a.m.' },
      { label: 'martes 7 de abril a las 2:00 p.m.' }
    ];
    const menu = buildSlotsMenu(slots);
    assert.ok(menu.startsWith('1.'), `esperaba empezar con "1." en "${menu}"`);
    assert.ok(menu.includes('2.'), `esperaba "2." en "${menu}"`);
  });
});

// ---------------------------------------------------------------------------
// buildReminderMessage
// ---------------------------------------------------------------------------
describe('buildReminderMessage', () => {
  test('incluye el nombre del candidato', () => {
    const d = new Date('2026-04-07T15:00:00.000Z');
    const msg = buildReminderMessage('Carlos Pérez', d);
    assert.ok(msg.includes('Carlos'), `esperaba "Carlos" en el mensaje`);
  });

  test('incluye la dirección si se proporciona', () => {
    const d = new Date('2026-04-07T15:00:00.000Z');
    const msg = buildReminderMessage('Ana', d, 'Calle 13 # 45-20, Bogotá');
    assert.ok(msg.includes('Calle 13'), `esperaba la dirección en el mensaje`);
  });

  test('funciona sin nombre ni dirección', () => {
    const d = new Date('2026-04-07T15:00:00.000Z');
    const msg = buildReminderMessage(null, d, null);
    assert.ok(typeof msg === 'string' && msg.length > 0, 'debe retornar string no vacío');
  });
});

// ---------------------------------------------------------------------------
// processReminderResponse — mock de Prisma
// ---------------------------------------------------------------------------
describe('processReminderResponse', () => {
  let mockPrisma;
  let storedInterview;
  let storedCandidateStep;

  beforeEach(() => {
    storedInterview = {
      id: 'iv-1',
      candidateId: 'c-1',
      status: 'SCHEDULED',
      reminderSentAt: new Date(),
      reminderResponse: null,
      slot: { scheduledAt: new Date(Date.now() + 3600000) }
    };
    storedCandidateStep = 'SCHEDULING_INTERVIEW';

    mockPrisma = {
      interview: {
        findFirst: async () => storedInterview,
        update: async ({ data }) => { Object.assign(storedInterview, data); return storedInterview; }
      },
      candidate: {
        update: async ({ data }) => { if (data.currentStep) storedCandidateStep = data.currentStep; }
      }
    };
  });

  test('confirma con "sí"', async () => {
    const result = await processReminderResponse(mockPrisma, 'c-1', 'sí');
    assert.equal(result.action, 'confirmed');
    assert.equal(storedInterview.status, 'CONFIRMED');
  });

  test('confirma con "claro"', async () => {
    const result = await processReminderResponse(mockPrisma, 'c-1', 'claro');
    assert.equal(result.action, 'confirmed');
  });

  test('cancela con "no puedo"', async () => {
    const result = await processReminderResponse(mockPrisma, 'c-1', 'no puedo');
    assert.equal(result.action, 'cancelled');
    assert.equal(storedInterview.status, 'CANCELLED');
  });

  test('reprograma con "quiero reprogramar"', async () => {
    const result = await processReminderResponse(mockPrisma, 'c-1', 'quiero reprogramar');
    assert.equal(result.action, 'rescheduled');
    assert.equal(storedCandidateStep, 'SCHEDULING_INTERVIEW');
  });

  test('respuesta ambigua retorna unknown', async () => {
    const result = await processReminderResponse(mockPrisma, 'c-1', 'depende');
    assert.equal(result.action, 'unknown');
  });

  test('sin entrevista activa retorna unknown', async () => {
    mockPrisma.interview.findFirst = async () => null;
    const result = await processReminderResponse(mockPrisma, 'c-1', 'sí');
    assert.equal(result.action, 'unknown');
  });

  test('sin reminderSentAt retorna unknown (recordatorio no enviado)', async () => {
    storedInterview.reminderSentAt = null;
    const result = await processReminderResponse(mockPrisma, 'c-1', 'sí');
    assert.equal(result.action, 'unknown');
  });
});
