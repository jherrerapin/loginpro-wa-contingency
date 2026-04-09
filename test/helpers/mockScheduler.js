export function buildFutureSlot({
  vacancyId,
  id,
  hoursFromNow,
  maxCandidates = 1,
  isActive = true
}) {
  const date = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
  const colombia = new Date(date.getTime() - 5 * 60 * 60 * 1000);
  const yyyy = colombia.getUTCFullYear();
  const mm = String(colombia.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(colombia.getUTCDate()).padStart(2, '0');
  const hh = String(colombia.getUTCHours()).padStart(2, '0');
  const min = String(colombia.getUTCMinutes()).padStart(2, '0');

  return {
    id,
    vacancyId,
    isActive,
    specificDate: `${yyyy}-${mm}-${dd}T05:00:00.000Z`,
    dayOfWeek: null,
    startTime: `${hh}:${min}`,
    maxCandidates,
    bookings: []
  };
}
