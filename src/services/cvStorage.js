import path from 'node:path';
import crypto from 'node:crypto';
import {
  uploadBufferToR2,
  downloadBufferFromR2,
  deleteObjectFromR2,
  isStorageConfigured
} from './storage.js';

function sanitizeNamePart(value = '') {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized || 'file';
}

export function candidateHasStoredCv(candidate = {}) {
  return Boolean(candidate.cvStorageKey || candidate.cvData || candidate.cvOriginalName || candidate.cvMimeType);
}

export function buildCandidateCvStorageKey(candidateId, originalName = 'hoja_de_vida') {
  const ext = path.extname(originalName || '').toLowerCase() || '.bin';
  const base = sanitizeNamePart(path.basename(originalName || 'hoja_de_vida', ext));
  const suffix = crypto.randomBytes(6).toString('hex');
  return `candidates/${candidateId}/cv/${Date.now()}-${suffix}-${base}${ext}`;
}

export async function storeCandidateCv(prisma, candidateId, buffer, options = {}) {
  const originalName = options.originalName || 'hoja_de_vida';
  const mimeType = options.mimeType || 'application/octet-stream';
  const currentCvStorageKey = options.currentCvStorageKey || null;

  if (!isStorageConfigured()) {
    return prisma.candidate.update({
      where: { id: candidateId },
      data: {
        cvData: buffer,
        cvMimeType: mimeType,
        cvOriginalName: originalName
      }
    });
  }

  const storageKey = buildCandidateCvStorageKey(candidateId, originalName);
  await uploadBufferToR2(storageKey, buffer, mimeType);

  const updatedCandidate = await prisma.candidate.update({
    where: { id: candidateId },
    data: {
      cvStorageKey: storageKey,
      cvData: null,
      cvMimeType: mimeType,
      cvOriginalName: originalName
    }
  });

  if (currentCvStorageKey && currentCvStorageKey !== storageKey) {
    await deleteObjectFromR2(currentCvStorageKey).catch((error) => {
      console.warn('[CV_STORAGE_DELETE_OLD_FAILED]', { candidateId, currentCvStorageKey, error: error?.message || error });
    });
  }

  return updatedCandidate;
}

export async function resolveCandidateCvBuffer(candidate) {
  if (!candidate) return null;
  if (candidate.cvStorageKey && isStorageConfigured()) {
    return downloadBufferFromR2(candidate.cvStorageKey);
  }
  if (candidate.cvData) {
    return Buffer.isBuffer(candidate.cvData) ? candidate.cvData : Buffer.from(candidate.cvData);
  }
  return null;
}

export async function clearCandidateCvStorage(candidate = {}) {
  if (candidate.cvStorageKey) {
    await deleteObjectFromR2(candidate.cvStorageKey).catch((error) => {
      console.warn('[CV_STORAGE_DELETE_FAILED]', { candidateId: candidate.id, cvStorageKey: candidate.cvStorageKey, error: error?.message || error });
    });
  }
}
