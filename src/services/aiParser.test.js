/**
 * aiParser.test.js — Sprint 8
 *
 * Tests unitarios para las funciones puras y el comportamiento sin red de aiParser.js.
 * Usa node:test + node:assert nativos. Cero dependencias externas.
 *
 * Estrategia de cobertura:
 * 1. Funciones puras (parseModelJson, extractTextFromChatCompletion, etc.): tests exhaustivos.
 * 2. runAITurn sin OPENAI_API_KEY: verifica el early-return disabled sin tocar la red.
 * 3. buildSystemPrompt + buildVacancyCatalogBlock: verifica que el prompt contiene
 *    las secciones críticas que el modelo necesita para responder correctamente.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseModelJson,
  extractTextFromChatCompletion,
  summarizeOpenAIError,
  buildVacancyCatalogBlock,
  buildSystemPrompt,
  runAITurn
} from './aiParser.js';

// ─── parseModelJson ─────────────────────────────────────────────────────────────

describe('parseModelJson', () => {
  it('parsea JSON limpio correctamente', () => {
    const result = parseModelJson('{"intent":"greeting","action":"noop"}');
    assert.equal(result.intent, 'greeting');
    assert.equal(result.action, 'noop');
  });

  it('parsea JSON envuelto en fenced code block ```json', () => {
    const raw = '```json\n{"intent":"apply_intent","vacancyKey":"MOTO"}\n```';
    const result = parseModelJson(raw);
    assert.equal(result.intent, 'apply_intent');
    assert.equal(result.vacancyKey, 'MOTO');
  });

  it('parsea JSON envuelto en fenced block sin lenguaje ```', () => {
    const raw = '```\n{"action":"save_vacancy"}\n```';
    const result = parseModelJson(raw);
    assert.equal(result.action, 'save_vacancy');
  });

  it('retorna {} para JSON roto', () => {
    const result = parseModelJson('{intent: greeting}');
    assert.deepEqual(result, {});
  });

  it('retorna {} para string vacío', () => {
    assert.deepEqual(parseModelJson(''), {});
  });

  it('retorna {} para null/undefined', () => {
    assert.deepEqual(parseModelJson(null), {});
    assert.deepEqual(parseModelJson(undefined), {});
  });

  it('preserva tipos anidados (fields como objeto)', () => {
    const raw = JSON.stringify({ intent: 'provide_data', fields: { fullName: 'Ana Gómez', age: 28 } });
    const result = parseModelJson(raw);
    assert.equal(result.fields.fullName, 'Ana Gómez');
    assert.equal(result.fields.age, 28);
  });
});

// ─── extractTextFromChatCompletion ──────────────────────────────────────────────────

describe('extractTextFromChatCompletion', () => {
  it('extrae string directo del content', () => {
    const data = { choices: [{ message: { content: '{"intent":"greeting"}' } }] };
    assert.equal(extractTextFromChatCompletion(data), '{"intent":"greeting"}');
  });

  it('concatena array de parts (multimodal response)', () => {
    const data = {
      choices: [{
        message: {
          content: [
            { type: 'text', text: '{"intent":' },
            { type: 'text', text: '"farewell"}' }
          ]
        }
      }]
    };
    assert.equal(extractTextFromChatCompletion(data), '{"intent":"farewell"}');
  });

  it('retorna {} para respuesta sin choices', () => {
    assert.equal(extractTextFromChatCompletion({}), '{}');
  });

  it('retorna {} para data undefined', () => {
    assert.equal(extractTextFromChatCompletion(undefined), '{}');
  });

  it('ignora parts sin type text en array', () => {
    const data = {
      choices: [{
        message: {
          content: [
            { type: 'image_url', image_url: { url: 'data:...' } },
            { type: 'text', text: '{"action":"noop"}' }
          ]
        }
      }]
    };
    assert.equal(extractTextFromChatCompletion(data), '{"action":"noop"}');
  });
});

// ─── summarizeOpenAIError ───────────────────────────────────────────────────────────

describe('summarizeOpenAIError', () => {
  it('incluye HTTP status y mensaje de la API', () => {
    const err = {
      name: 'AxiosError',
      response: {
        status: 429,
        data: { error: { message: 'Rate limit exceeded' } }
      }
    };
    const summary = summarizeOpenAIError(err);
    assert.ok(summary.includes('HTTP 429'), `Expected HTTP 429 in: ${summary}`);
    assert.ok(summary.includes('Rate limit exceeded'), `Expected API message in: ${summary}`);
  });

  it('incluye error code de red (ECONNRESET)', () => {
    const err = { name: 'Error', code: 'ECONNRESET', message: 'socket hang up' };
    const summary = summarizeOpenAIError(err);
    assert.ok(summary.includes('ECONNRESET'), `Expected ECONNRESET in: ${summary}`);
  });

  it('maneja error plano sin response ni code', () => {
    const err = new Error('Unexpected error');
    const summary = summarizeOpenAIError(err);
    assert.ok(typeof summary === 'string' && summary.length > 0);
  });

  it('trunca mensajes largos (no supera ~400 chars)', () => {
    const longMsg = 'x'.repeat(1000);
    const err = { name: 'Error', message: longMsg, response: { status: 500, data: { error: { message: longMsg } } } };
    const summary = summarizeOpenAIError(err);
    assert.ok(summary.length < 600, `Summary demasiado largo: ${summary.length} chars`);
  });
});

// ─── buildVacancyCatalogBlock ────────────────────────────────────────────────────────

const VACANCY_FIXTURE = {
  key: 'MOTO',
  title: 'Mensajero en Moto',
  cargo: 'Mensajero',
  city: 'Bogotá',
  salary: '$1.800.000',
  schedule: 'L-S 7am-5pm',
  contractType: 'Término indefinido',
  requirementsSummary: 'Licencia A2, mínimo 1 año de experiencia',
  profile: 'Responsable, puntual',
  requiresLocality: true,
  operationZones: ['Suba', 'Engativá', 'Fontibón'],
  requiresInterview: false,
  botIntroText: 'Tenemos vacante de mensajero en moto en Bogotá.'
};

describe('buildVacancyCatalogBlock', () => {
  it('retorna aviso cuando no hay vacantes', () => {
    const result = buildVacancyCatalogBlock([]);
    assert.ok(result.includes('Sin vacantes'), `Expected sin vacantes message`);
  });

  it('incluye KEY y TITULO de la vacante', () => {
    const result = buildVacancyCatalogBlock([VACANCY_FIXTURE]);
    assert.ok(result.includes('KEY: MOTO'));
    assert.ok(result.includes('TITULO: Mensajero en Moto'));
  });

  it('incluye REQUIERE_ENTREVISTA como string', () => {
    const result = buildVacancyCatalogBlock([VACANCY_FIXTURE]);
    assert.ok(result.includes('REQUIERE_ENTREVISTA: false'));
  });

  it('incluye ZONAS_VIABLES cuando hay operationZones', () => {
    const result = buildVacancyCatalogBlock([VACANCY_FIXTURE]);
    assert.ok(result.includes('ZONAS_VIABLES: Suba, Engativá, Fontibón'));
  });

  it('no incluye campos opcionales vacios (salary, schedule)', () => {
    const minVacancy = { key: 'BARE', title: 'Auxiliar', city: 'Medellín', requiresInterview: false };
    const result = buildVacancyCatalogBlock([minVacancy]);
    assert.ok(!result.includes('SALARIO'));
    assert.ok(!result.includes('HORARIO'));
  });

  it('separa múltiples vacantes con ---', () => {
    const v2 = { ...VACANCY_FIXTURE, key: 'BICI', title: 'Mensajero en Bici' };
    const result = buildVacancyCatalogBlock([VACANCY_FIXTURE, v2]);
    assert.ok(result.includes('---'));
    assert.ok(result.includes('KEY: MOTO'));
    assert.ok(result.includes('KEY: BICI'));
  });
});

// ─── buildSystemPrompt ───────────────────────────────────────────────────────────────

describe('buildSystemPrompt', () => {
  it('contiene todas las claves JSON requeridas en el contrato del modelo', () => {
    const prompt = buildSystemPrompt({});
    const requiredKeys = ['intent', 'vacancyKey', 'fields', 'proximityVerdict', 'reply', 'action', 'interviewSlotId'];
    for (const key of requiredKeys) {
      assert.ok(prompt.includes(`"${key}"`), `Falta clave "${key}" en el prompt`);
    }
  });

  it('contiene la sección de VACANTES ACTIVAS', () => {
    const prompt = buildSystemPrompt({ activeVacancies: [VACANCY_FIXTURE] });
    assert.ok(prompt.includes('VACANTES ACTIVAS'));
    assert.ok(prompt.includes('KEY: MOTO'));
  });

  it('refleja el estado del candidato con datos parciales', () => {
    const prompt = buildSystemPrompt({
      candidateState: { fullName: 'Carlos Rios', age: 30 }
    });
    assert.ok(prompt.includes('Carlos Rios'));
    assert.ok(prompt.includes('30'));
  });

  it('indica la vacante actual cuando está identificada', () => {
    const prompt = buildSystemPrompt({
      activeVacancies: [VACANCY_FIXTURE],
      currentVacancyKey: 'MOTO'
    });
    assert.ok(prompt.includes('VACANTE ACTUAL DEL CANDIDATO: MOTO'));
  });

  it('muestra slots disponibles de entrevista', () => {
    const slots = [
      { id: 'slot_1', label: 'Lunes 7 Abr 9:00am' },
      { id: 'slot_2', label: 'Martes 8 Abr 2:00pm' }
    ];
    const prompt = buildSystemPrompt({ availableSlots: slots });
    assert.ok(prompt.includes('slot_1'));
    assert.ok(prompt.includes('Lunes 7 Abr 9:00am'));
  });

  it('muestra "Sin horarios configurados" cuando no hay slots', () => {
    const prompt = buildSystemPrompt({ availableSlots: [] });
    assert.ok(prompt.includes('Sin horarios configurados'));
  });

  it('es un string no vacío cuando se llama sin parámetros', () => {
    const prompt = buildSystemPrompt();
    assert.ok(typeof prompt === 'string' && prompt.length > 100);
  });
});

// ─── runAITurn ─────────────────────────────────────────────────────────────────────

describe('runAITurn — sin OPENAI_API_KEY', () => {
  let originalKey;

  before(() => {
    originalKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  after(() => {
    if (originalKey !== undefined) process.env.OPENAI_API_KEY = originalKey;
  });

  it('retorna status=disabled sin llamar a la red', async () => {
    const result = await runAITurn({
      conversationHistory: [{ role: 'user', content: 'Hola' }],
      candidateState: {},
      activeVacancies: []
    });

    assert.equal(result.used, false);
    assert.equal(result.status, 'disabled');
    assert.equal(result.action, 'noop');
    assert.equal(result.intent, null);
    assert.equal(result.reply, null);
    assert.deepEqual(result.fields, {});
  });

  it('retorna disabled incluso con parámetros completos', async () => {
    const result = await runAITurn({
      conversationHistory: [{ role: 'user', content: 'Quiero aplicar al cargo de mensajero' }],
      candidateState: { fullName: 'Pedro Pérez' },
      activeVacancies: [VACANCY_FIXTURE],
      currentVacancyKey: 'MOTO',
      availableSlots: [{ id: 's1', label: 'Lunes 9am' }]
    });

    assert.equal(result.status, 'disabled');
    assert.equal(result.used, false);
  });
});
