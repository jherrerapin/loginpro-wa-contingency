import test from 'node:test';
import assert from 'node:assert/strict';
import { exportFilenameByScope, filterCandidatesByScope, isReadyForReview } from '../src/services/candidateExport.js';

const baseCandidate = {
  id: 'ready-1',
  fullName: 'Ana Perez',
  documentType: 'CC',
  documentNumber: '123',
  age: 25,
  neighborhood: 'Picalena',
  experienceInfo: 'Sí',
  experienceTime: '6 meses',
  medicalRestrictions: 'Sin restricciones médicas',
  transportMode: 'Moto',
  status: 'REGISTRADO',
  cvData: Buffer.from('cv')
};

test('ready_review exige campos operativos completos y CV', () => {
  assert.equal(isReadyForReview(baseCandidate), true);
  assert.equal(isReadyForReview({ ...baseCandidate, cvData: null }), false);
  assert.equal(isReadyForReview({ ...baseCandidate, status: 'RECHAZADO' }), false);
  assert.equal(isReadyForReview({ ...baseCandidate, experienceTime: '' }), false);
});

test('filtra candidatos por scopes operativos', () => {
  const candidates = [
    baseCandidate,
    { ...baseCandidate, id: 'missing-cv', cvData: null },
    { ...baseCandidate, id: 'rejected', status: 'RECHAZADO' }
  ];

  assert.deepEqual(filterCandidatesByScope(candidates, 'ready_review').map((c) => c.id), ['ready-1']);
  assert.deepEqual(filterCandidatesByScope(candidates, 'missing_cv').map((c) => c.id), ['missing-cv']);
  assert.deepEqual(filterCandidatesByScope(candidates, 'rejected').map((c) => c.id), ['rejected']);
  assert.deepEqual(filterCandidatesByScope(candidates, 'registered').map((c) => c.id), ['ready-1', 'missing-cv']);
});

test('nombre de archivo de exportación incluye scope solicitado', () => {
  assert.match(exportFilenameByScope('ready_review'), /^candidatos_ready_review_\d{4}-\d{2}-\d{2}\.xlsx$/);
  assert.match(exportFilenameByScope('invalid-scope'), /^candidatos_all_\d{4}-\d{2}-\d{2}\.xlsx$/);
});
