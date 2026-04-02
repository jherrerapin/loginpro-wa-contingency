function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

export function isReadyForReview(candidate) {
  return hasValue(candidate.fullName)
    && hasValue(candidate.documentType)
    && hasValue(candidate.documentNumber)
    && candidate.age !== null
    && candidate.age !== undefined
    && hasValue(candidate.neighborhood)
    && hasValue(candidate.experienceInfo)
    && hasValue(candidate.experienceTime)
    && hasValue(candidate.medicalRestrictions)
    && hasValue(candidate.transportMode)
    && Boolean(candidate.cvData)
    && candidate.status !== 'RECHAZADO';
}

export function filterCandidatesByScope(candidates, scope = 'all') {
  if (scope === 'registered') return candidates.filter((c) => c.status === 'REGISTRADO');
  if (scope === 'ready_review') return candidates.filter((c) => isReadyForReview(c));
  if (scope === 'missing_cv') return candidates.filter((c) => !c.cvData && c.status !== 'RECHAZADO');
  if (scope === 'rejected') return candidates.filter((c) => c.status === 'RECHAZADO');
  return candidates;
}

export function exportFilenameByScope(scope = 'all') {
  const safeScope = ['all', 'registered', 'ready_review', 'missing_cv', 'rejected'].includes(scope)
    ? scope
    : 'all';
  const today = new Date().toISOString().slice(0, 10);
  return `candidatos_${safeScope}_${today}.xlsx`;
}
