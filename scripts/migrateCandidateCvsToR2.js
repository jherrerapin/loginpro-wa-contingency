import { PrismaClient } from '@prisma/client';
import { storeCandidateCv } from '../src/services/cvStorage.js';

const prisma = new PrismaClient();

async function main() {
  const batchSize = Number.parseInt(process.argv[2] || '100', 10) || 100;
  const candidates = await prisma.candidate.findMany({
    where: {
      cvData: { not: null },
      cvStorageKey: null
    },
    select: {
      id: true,
      cvData: true,
      cvMimeType: true,
      cvOriginalName: true
    },
    take: batchSize,
    orderBy: { createdAt: 'asc' }
  });

  let migrated = 0;
  let failed = 0;

  for (const candidate of candidates) {
    try {
      await storeCandidateCv(prisma, candidate.id, Buffer.from(candidate.cvData), {
        mimeType: candidate.cvMimeType || 'application/octet-stream',
        originalName: candidate.cvOriginalName || 'hoja_de_vida'
      });
      migrated += 1;
    } catch (error) {
      failed += 1;
      console.error('[CV_MIGRATION_FAILED]', candidate.id, error?.message || error);
    }
  }

  console.log(JSON.stringify({
    batchSize,
    found: candidates.length,
    migrated,
    failed
  }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
