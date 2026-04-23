const INTERVIEW_CONFIRMATION_WINDOW_HOURS = Number.parseInt(
  process.env.INTERVIEW_CONFIRMATION_WINDOW_HOURS || '6',
  10
) || 6;

const INTERVIEW_NO_RESPONSE_MINUTES_BEFORE = Number.parseInt(
  process.env.INTERVIEW_NO_RESPONSE_MINUTES_BEFORE || '10',
  10
) || 10;

const ACTIVE_BOOKING_STATUSES = new Set(['SCHEDULED', 'CONFIRMED']);
const CLOSED_BOOKING_STATUSES = new Set(['CANCELLED', 'RESCHEDULED', 'NO_RESPONSE', 'ATTENDED', 'NO_SHOW']);

function normalize(text = '') {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export function hasActiveInterviewBooking(booking) {
  return Boolean(booking && ACTIVE_BOOKING_STATUSES.has(booking.status));
}

export function shouldStopInterviewAutomation(booking, now = new Date()) {
  if (!booking) return true;
  if (CLOSED_BOOKING_STATUSES.has(booking.status)) return true;
  const scheduledAt = new Date(booking.scheduledAt);
  if (scheduledAt <= now) return true;
  if (booking.reminderSentAt || booking.reminderWindowClosed) return true;
  return false;
}

export function isWithinInterviewConfirmationWindow(booking, now = new Date()) {
  if (!hasActiveInterviewBooking(booking)) return false;
  const scheduledAt = new Date(booking.scheduledAt);
  if (scheduledAt <= now) return false;
  if (booking.reminderSentAt) return true;
  const diffHours = (scheduledAt.getTime() - now.getTime()) / (60 * 60 * 1000);
  return diffHours <= INTERVIEW_CONFIRMATION_WINDOW_HOURS;
}

export function detectInterviewIntent({ text = '', booking = null, now = new Date() } = {}) {
  if (!hasActiveInterviewBooking(booking)) return 'none';

  const n = normalize(text);
  if (!n) return 'none';

  if (/\b(cancel|cancelar|cancelo|ya no voy|no voy|no podre asistir|no podre ir)\b/.test(n)) {
    return 'cancel_interview';
  }

  if (/\b(reagend|reprogram|otro horario|otra hora|otro dia|cambiar horario|mover cita|me pasas otra fecha)\b/.test(n)) {
    return 'reschedule_interview';
  }

  const hasAffirmativeInterviewSignal = /\b(confirmo|si voy|si ire|alla estare|estare ahi|asistire|nos vemos|confirmada)\b/.test(n);
  if (!hasAffirmativeInterviewSignal) return 'none';

  if (!isWithinInterviewConfirmationWindow(booking, now)) return 'none';
  return 'confirm_attendance';
}

export function shouldMarkNoResponse(booking, { now = new Date(), hasReminderReply = false } = {}) {
  if (!hasActiveInterviewBooking(booking)) return false;
  if (!booking?.reminderSentAt) return false;
  if (hasReminderReply) return false;
  const scheduledAt = new Date(booking.scheduledAt);
  if (scheduledAt <= now) return false;
  const remainingMinutes = (scheduledAt.getTime() - now.getTime()) / (60 * 1000);
  return remainingMinutes <= INTERVIEW_NO_RESPONSE_MINUTES_BEFORE;
}

export function getInterviewConfirmationWindowHours() {
  return INTERVIEW_CONFIRMATION_WINDOW_HOURS;
}

export function getInterviewNoResponseMinutesBefore() {
  return INTERVIEW_NO_RESPONSE_MINUTES_BEFORE;
}
