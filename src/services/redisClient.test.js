/**
 * redisClient.test.js — Sprint 8
 *
 * Tests unitarios de buildSessionStore y createRedisClient.
 * No requieren Redis real.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { buildSessionStore, createRedisClient } from './redisClient.js';

// ─── buildSessionStore ────────────────────────────────────────────────────────────

describe('buildSessionStore', () => {
  it('retorna undefined cuando redisClient es null (MemoryStore fallback)', () => {
    const store = buildSessionStore(null);
    assert.equal(store, undefined);
  });

  it('retorna undefined cuando redisClient es undefined', () => {
    const store = buildSessionStore(undefined);
    assert.equal(store, undefined);
  });

  it('retorna un objeto RedisStore cuando se pasa un cliente válido', () => {
    // Mock mínimo que connect-redis necesita: objeto con métodos get/set/del
    const fakeClient = {
      get: async () => null,
      set: async () => 'OK',
      del: async () => 1,
      status: 'ready'
    };
    const store = buildSessionStore(fakeClient);
    // RedisStore es un objeto (instancia de clase)
    assert.ok(store !== undefined && store !== null);
    assert.ok(typeof store === 'object');
    // connect-redis RedisStore implementa estos métodos de express-session store
    assert.ok(typeof store.get === 'function', 'store.get debe ser una función');
    assert.ok(typeof store.set === 'function', 'store.set debe ser una función');
    assert.ok(typeof store.destroy === 'function', 'store.destroy debe ser una función');
  });
});

// ─── createRedisClient ────────────────────────────────────────────────────────────

describe('createRedisClient', () => {
  let originalRedisUrl;

  before(() => {
    originalRedisUrl = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
  });

  after(() => {
    if (originalRedisUrl !== undefined) process.env.REDIS_URL = originalRedisUrl;
    else delete process.env.REDIS_URL;
  });

  it('retorna null cuando REDIS_URL no está configurada', async () => {
    const client = await createRedisClient();
    assert.equal(client, null);
  });
});
