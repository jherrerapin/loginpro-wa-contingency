const ROLE_STOPWORDS = new Set([
  'a', 'al', 'ante', 'aplicar', 'aplicando', 'aplicarme', 'aplico', 'ayuda',
  'buen', 'buena', 'buenas', 'cargo', 'con', 'continuar', 'cual', 'cuales',
  'cuanto', 'de', 'del', 'desde', 'deseo', 'el', 'en', 'es', 'esa', 'ese',
  'esta', 'estoy', 'favor', 'gracias', 'hola', 'informacion', 'interesa',
  'interesada', 'interesado', 'la', 'las', 'loginpro', 'los', 'me', 'mi',
  'necesito', 'para', 'por', 'postular', 'postularme', 'puesto', 'que',
  'quiero', 'rol', 'seria', 'solicito', 'su', 'trabajar', 'trabajo', 'una',
  'uno', 'vacante', 'y'
]);

export function normalizeResolverText(text = '') {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text = '') {
  return normalizeResolverText(text).split(' ').filter(Boolean);
}

function canonicalVacancyCity(vacancy) {
  return vacancy?.operation?.city?.name || vacancy?.city || null;
}

function buildCityNames(vacancies = []) {
  return Array.from(new Set(vacancies.map(canonicalVacancyCity).filter(Boolean)));
}

export function detectCityFromText(text = '', cityNames = []) {
  const normalized = normalizeResolverText(text);
  if (!normalized) return null;
  const padded = ` ${normalized} `;

  let bestMatch = null;
  for (const cityName of cityNames) {
    const cityNormalized = normalizeResolverText(cityName);
    if (!cityNormalized) continue;
    if (padded.includes(` ${cityNormalized} `)) {
      if (!bestMatch || cityNormalized.length > bestMatch.normalized.length) {
        bestMatch = { value: cityName, normalized: cityNormalized };
      }
    }
  }

  return bestMatch?.value || null;
}

function cleanRoleTokens(tokens = [], cityTokens = new Set()) {
  return tokens.filter((token) => (
    token
    && token.length > 1
    && !ROLE_STOPWORDS.has(token)
    && !cityTokens.has(token)
  ));
}

export function detectRoleHintFromText(text = '', options = {}) {
  const normalized = normalizeResolverText(text);
  if (!normalized) return null;

  const cityTokens = new Set(tokenize(options.city || ''));
  const explicitPatterns = [
    /\b(?:vacante|cargo|rol|puesto)\s+(?:de|para)?\s*([a-z0-9 ]{3,80})/i,
    /\b(?:quiero aplicar(?: a)?|quiero postularme(?: a)?|me interesa(?: la)?|estoy interesad[oa] en(?: la)?|informacion(?: de)?(?: la)?|para)\s+(?:vacante|cargo|rol|puesto)?\s*(?:de|para)?\s*([a-z0-9 ]{3,80})/i
  ];

  for (const pattern of explicitPatterns) {
    const match = normalized.match(pattern);
    if (!match?.[1]) continue;
    const roleTokens = cleanRoleTokens(tokenize(match[1]), cityTokens);
    if (roleTokens.length) return roleTokens.join(' ');
  }

  const roleTokens = cleanRoleTokens(tokenize(normalized), cityTokens);
  return roleTokens.length ? roleTokens.join(' ') : null;
}

function similarityScore(input = '', candidate = '') {
  const inputTokens = cleanRoleTokens(tokenize(input));
  const candidateTokens = cleanRoleTokens(tokenize(candidate));
  if (!inputTokens.length || !candidateTokens.length) return 0;

  const inputSet = new Set(inputTokens);
  const candidateSet = new Set(candidateTokens);
  let overlap = 0;
  for (const token of inputSet) {
    if (candidateSet.has(token)) overlap += 1;
  }
  if (!overlap) return 0;

  const inputNormalized = normalizeResolverText(input);
  const candidateNormalized = normalizeResolverText(candidate);
  let score = overlap / Math.max(inputSet.size, candidateSet.size);

  if (candidateNormalized && inputNormalized) {
    if (candidateNormalized === inputNormalized) score += 0.9;
    else if (candidateNormalized.includes(inputNormalized) || inputNormalized.includes(candidateNormalized)) score += 0.45;
  }

  return score;
}

function hasInterestSignal(text = '') {
  return /\b(vacante|cargo|empleo|trabajo|informacion|interesa|interesado|interesada|aplicar|postular|continuar)\b/i
    .test(normalizeResolverText(text));
}

function scoreVacancy(vacancy, { text, city, roleHint }) {
  const vacancyText = [vacancy?.title, vacancy?.role].filter(Boolean).join(' ');
  const vacancyCity = canonicalVacancyCity(vacancy);
  let score = 0;

  if (city) {
    const normalizedVacancyCity = normalizeResolverText(vacancyCity);
    const normalizedCity = normalizeResolverText(city);
    if (normalizedVacancyCity !== normalizedCity) return -1;
    score += 4;
  }

  if (roleHint) {
    score += similarityScore(roleHint, vacancyText) * 6;
  } else {
    score += similarityScore(text, vacancyText) * 3;
  }

  const normalizedText = normalizeResolverText(text);
  const normalizedTitle = normalizeResolverText(vacancy?.title || '');
  const normalizedRole = normalizeResolverText(vacancy?.role || '');

  if (normalizedTitle && normalizedText.includes(normalizedTitle)) score += 2;
  if (normalizedRole && normalizedText.includes(normalizedRole)) score += 2;

  return score;
}

export async function findActiveVacancies(prisma) {
  return prisma.vacancy.findMany({
    where: {
      isActive: true,
      acceptingApplications: true,
    },
    include: {
      operation: {
        include: {
          city: true,
        },
      },
    },
    orderBy: [
      { updatedAt: 'desc' },
      { title: 'asc' },
    ],
  });
}

export async function resolveVacancyFromText(prisma, text, options = {}) {
  const normalizedText = normalizeResolverText(text);
  if (!normalizedText) {
    return { resolved: false, vacancy: null, city: null, roleHint: null, reason: 'empty_input' };
  }

  const vacancies = options.vacancies || await findActiveVacancies(prisma);
  if (!vacancies.length) {
    return { resolved: false, vacancy: null, city: null, roleHint: null, reason: 'no_active_vacancies' };
  }

  const city = options.cityHint || detectCityFromText(text, buildCityNames(vacancies));
  const roleHint = options.roleHint || detectRoleHintFromText(text, { city });
  if (!city && !roleHint) {
    return { resolved: false, vacancy: null, city: null, roleHint: null, reason: 'missing_city_and_role' };
  }

  const matchingCityVacancies = city
    ? vacancies.filter((vacancy) => normalizeResolverText(canonicalVacancyCity(vacancy)) === normalizeResolverText(city))
    : vacancies;

  if (city && !matchingCityVacancies.length) {
    return { resolved: false, vacancy: null, city, roleHint, reason: 'city_without_active_vacancies' };
  }

  const scored = matchingCityVacancies
    .map((vacancy) => ({ vacancy, score: scoreVacancy(vacancy, { text, city, roleHint }) }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const runnerUp = scored[1];
  const hasUniqueCityMatch = Boolean(city && matchingCityVacancies.length === 1 && hasInterestSignal(text));
  const threshold = roleHint ? 4.5 : hasUniqueCityMatch ? 4 : 6;
  const margin = runnerUp ? best.score - runnerUp.score : best.score;

  if (!best || best.score < threshold) {
    return { resolved: false, vacancy: null, city, roleHint, reason: 'low_confidence_match' };
  }

  if (runnerUp && margin < 0.75) {
    return { resolved: false, vacancy: null, city, roleHint, reason: 'ambiguous_match' };
  }

  return {
    resolved: true,
    vacancy: best.vacancy,
    city: city || canonicalVacancyCity(best.vacancy),
    roleHint,
    reason: 'matched_active_vacancy'
  };
}
