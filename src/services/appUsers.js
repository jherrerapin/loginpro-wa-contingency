import { randomInt } from 'node:crypto';

export const USER_ACCESS_SCOPES = ['ALL', 'CITY', 'VACANCY'];

function normalizeString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

export function toSlug(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function normalizeUserAccessScope(value) {
  const normalized = normalizeString(value)?.toUpperCase();
  return USER_ACCESS_SCOPES.includes(normalized) ? normalized : 'ALL';
}

export function buildRecruiterUsernameBase({ accessScope, scopeCity, vacancyTitle } = {}) {
  const scope = normalizeUserAccessScope(accessScope);
  if (scope === 'CITY') {
    return `reclutador-${toSlug(scopeCity) || 'ciudad'}`;
  }
  if (scope === 'VACANCY') {
    return `reclutador-${toSlug(vacancyTitle) || 'vacante'}`;
  }
  return 'reclutador-general';
}

export async function buildUniqueRecruiterUsername(prisma, options = {}) {
  const base = buildRecruiterUsernameBase(options);
  const existingUsers = await prisma.appUser.findMany({
    where: {
      username: {
        startsWith: base
      }
    },
    select: { username: true }
  });

  const used = new Set(existingUsers.map((user) => user.username));
  if (!used.has(base)) return base;

  let index = 2;
  while (used.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

export function generateRecoveryCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function getAccessContext(source = {}) {
  const role = source.userRole || null;
  const scope = role === 'dev'
    ? 'ALL'
    : normalizeUserAccessScope(source.userAccessScope || 'ALL');

  return {
    role,
    username: source.username || null,
    userId: source.userId || null,
    scope,
    city: normalizeString(source.userAccessCity),
    vacancyId: normalizeString(source.userAccessVacancyId),
    isDev: role === 'dev',
    isAdmin: role === 'admin'
  };
}

export function hasFullAccess(context = {}) {
  return context.isDev || context.scope === 'ALL';
}

export function buildVacancyAccessWhere(context = {}) {
  if (hasFullAccess(context)) return {};
  if (context.scope === 'CITY') {
    return { city: context.city || '__OUT_OF_SCOPE__' };
  }
  if (context.scope === 'VACANCY') {
    return { id: context.vacancyId || '__OUT_OF_SCOPE__' };
  }
  return {};
}

export function buildCandidateAccessWhere(context = {}) {
  if (hasFullAccess(context)) return {};
  if (context.scope === 'CITY') {
    return {
      vacancy: {
        city: context.city || '__OUT_OF_SCOPE__'
      }
    };
  }
  if (context.scope === 'VACANCY') {
    return { vacancyId: context.vacancyId || '__OUT_OF_SCOPE__' };
  }
  return {};
}

export function canAccessVacancy(context = {}, vacancy = {}) {
  if (hasFullAccess(context)) return true;
  if (context.scope === 'CITY') {
    return normalizeString(vacancy?.city) === context.city;
  }
  if (context.scope === 'VACANCY') {
    return vacancy?.id === context.vacancyId;
  }
  return false;
}

export function canAccessCandidate(context = {}, candidate = {}) {
  if (hasFullAccess(context)) return true;
  if (context.scope === 'CITY') {
    return normalizeString(candidate?.vacancy?.city) === context.city;
  }
  if (context.scope === 'VACANCY') {
    return candidate?.vacancyId === context.vacancyId || candidate?.vacancy?.id === context.vacancyId;
  }
  return false;
}

export function describeUserScope(user = {}) {
  const scope = normalizeUserAccessScope(user.accessScope);
  if (scope === 'CITY') return `Ciudad: ${user.scopeCity || 'Sin ciudad'}`;
  if (scope === 'VACANCY') return `Vacante: ${user.scopeVacancy?.title || user.scopeVacancyId || 'Sin vacante'}`;
  return 'Todas las vacantes';
}
