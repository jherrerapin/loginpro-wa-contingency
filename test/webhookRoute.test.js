import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { webhookRouter } from '../src/routes/webhook.js';
import { createMockPrisma } from './helpers/mockPrisma.js';
import { createWhatsappMock } from './helpers/mockWhatsapp.js';
import { installOpenAIMock } from './helpers/mockOpenAI.js';

process.env.NODE_ENV = 'test';
process.env.OPENAI_API_KEY = 'test-openai-key';
process.env.USE_CONVERSATION_ENGINE = 'true';
process.env.META_PHONE_NUMBER_ID = 'meta-phone-id';
process.env.META_ACCESS_TOKEN = 'meta-access-token';

test('webhookRouter procesa mensajes de texto sin romper por cleanText y responde 200', async () => {
  const prisma = createMockPrisma();
  prisma.message.createMany = async ({ data }) => {
    let inserted = 0;
    for (const row of data || []) {
      const exists = row.waMessageId
        ? prisma.state.messages.some((message) => message.waMessageId === row.waMessageId)
        : false;
      if (exists) continue;
      inserted += 1;
      await prisma.message.create({ data: row });
    }
    return { count: inserted };
  };
  const whatsappMock = createWhatsappMock();
  const restoreAxios = installOpenAIMock({ whatsappMock });
  const app = express();
  app.use(express.json());
  app.use('/webhook', webhookRouter(prisma));

  let server;
  try {
    server = await new Promise((resolve) => {
      const instance = app.listen(0, () => resolve(instance));
    });

    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      id: 'wamid.text-1',
                      from: '573001112233',
                      type: 'text',
                      text: { body: 'Hola' }
                    }
                  ]
                }
              }
            ]
          }
        ]
      })
    });

    assert.equal(response.status, 200);
    assert.equal(prisma.state.candidates.length, 1);
    assert.ok(whatsappMock.sentMessages.length >= 1);
  } finally {
    restoreAxios();
    await new Promise((resolve, reject) => {
      if (!server) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
