const INTENT_REPLIES = {
  request_cv_pdf_word: 'Gracias por enviarlo. Para continuar necesito tu hoja de vida en PDF o Word (.doc/.docx).',
  request_missing_cv: 'Gracias. Ese documento no corresponde a la hoja de vida. Por favor envíame tu HV en PDF o Word.',
  acknowledge_and_continue: 'Perfecto, gracias. Continúo con tu postulación y te pido el siguiente dato enseguida.'
};

function normalize(text = '') {
  return String(text).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function isStrongRepeat(candidateReply, recentOutbound = []) {
  const norm = normalize(candidateReply);
  if (!norm) return false;
  return recentOutbound.some((msg) => normalize(msg?.body || '') === norm);
}

export function buildPolicyReply({ replyIntent = 'acknowledge_and_continue', recentOutbound = [], fallback = '' } = {}) {
  const base = INTENT_REPLIES[replyIntent] || fallback || INTENT_REPLIES.acknowledge_and_continue;
  if (!isStrongRepeat(base, recentOutbound)) return base;

  if (replyIntent === 'request_cv_pdf_word') {
    return 'Te ayudo con eso: envíame la hoja de vida en PDF o en Word para poder registrarla.';
  }
  if (replyIntent === 'request_missing_cv') {
    return 'Recibido. Aún me falta tu hoja de vida; compártela en formato PDF o Word, por favor.';
  }
  return 'Listo, quedo atento para continuar con tu registro.';
}
