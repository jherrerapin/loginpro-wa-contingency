import { PrismaClient } from '@prisma/client';
import { claimDueJobs, completeJob, failJob, JOB_TYPES } from '../services/jobQueue.js';
import { runReminderDispatcher } from '../services/reminder.js';
import { runAutoCvMigration } from '../services/cvMigration.js';

const prisma = new PrismaClient();
const POLL_MS = Number.parseInt(process.env.JOB_WORKER_POLL_MS || '5000', 10);

async function runJob(job) {
  if (job.type === JOB_TYPES.INTERVIEW_REMINDER) {
    await runReminderDispatcher(prisma, { now: new Date() });
    return;
  }
  if (job.type === JOB_TYPES.CV_STORAGE_MIGRATION) {
    await runAutoCvMigration(prisma);
    return;
  }
  if (job.type === JOB_TYPES.ADMIN_FORWARD_ATTACHMENT) {
    return;
  }
}

async function tick() {
  const jobs = await claimDueJobs(prisma, { limit: 20, now: new Date() });
  for (const job of jobs) {
    try {
      await runJob(job);
      await completeJob(prisma, job.id);
    } catch (error) {
      await failJob(prisma, job.id, error?.message || 'worker_error');
    }
  }
}

setInterval(() => {
  tick().catch((error) => console.error('[JOB_WORKER_TICK_ERROR]', error));
}, POLL_MS);

console.log('[JOB_WORKER_STARTED]', { pollMs: POLL_MS });
