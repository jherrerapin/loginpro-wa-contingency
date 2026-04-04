/**
 * multiline.test.js — Sprint 8
 *
 * Tests unitarios del servicio de batching de mensajes multilinea.
 * Verifica que la ventana de tiempo y el versionado funcionan correctamente.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { shouldBatchMessage, buildBatchKey } from './multiline.js';

// ─── buildBatchKey ────────────────────────────────────────────────────────────────

describe('buildBatchKey', () => {
  it('genera una clave que incluye el phone', () => {
    const key = buildBatchKey('573001234567');
    assert.ok(typeof key === 'string' && key.length > 0);
    assert.ok(key.includes('573001234567'), `La clave debe incluir el phone: ${key}`);
  });

  it('genera la misma clave para el mismo phone (determinista)', () => {
    assert.equal(buildBatchKey('573009999999'), buildBatchKey('573009999999'));
  });

  it('genera claves distintas para phones distintos', () => {
    assert.notEqual(buildBatchKey('573001111111'), buildBatchKey('573002222222'));
  });
});

// ─── shouldBatchMessage ─────────────────────────────────────────────────────────────

describe('shouldBatchMessage', () => {
  it('retorna true cuando el mensaje llega dentro de la ventana de batch', () => {
    const now = Date.now();
    const inWindow = now - 500;  // 500ms atrás (dentro de la ventana típica de 1-2s)
    const result = shouldBatchMessage({ firstMessageAt: inWindow, lastMessageAt: inWindow, version: 1 }, now);
    assert.equal(result, true);
  });

  it('retorna false cuando el mensaje está fuera de la ventana de batch', () => {
    const now = Date.now();
    const outOfWindow = now - 60_000;  // 60 segundos atrás
    const result = shouldBatchMessage({ firstMessageAt: outOfWindow, lastMessageAt: outOfWindow, version: 1 }, now);
    assert.equal(result, false);
  });

  it('retorna false si el batch state es null/undefined', () => {
    const result = shouldBatchMessage(null, Date.now());
    assert.equal(result, false);
  });
});
