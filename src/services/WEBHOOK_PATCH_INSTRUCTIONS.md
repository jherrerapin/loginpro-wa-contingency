# Instrucciones de patch manual para webhook.js

Este archivo documenta los 4 cambios que deben aplicarse manualmente al archivo `src/routes/webhook.js`
por su tamaño (105KB). Los cambios en `reminderPolicy.js` y `detail.ejs` ya están aplicados.

---

## CAMBIO 1 — Import cvStorage

**Buscar (línea ~31):**
```js
import { storeCandidateCv } from '../services/cvStorage.js';
```

**Reemplazar con:**
```js
import { storeCandidateCv, candidateHasStoredCv } from '../services/cvStorage.js';
```

---

## CAMBIO 2 — Import reminderPolicy

**Buscar:**
```js
import { cancelReminderOnInbound, scheduleReminderForCandidate } from '../services/reminder.js';
```

**Reemplazar con:**
```js
import { cancelReminderOnInbound, scheduleReminderForCandidate } from '../services/reminder.js';
import { isInterviewToday } from '../services/reminderPolicy.js';
```

---

## CAMBIO 3 — Guard CV (no sobreescribir si ya existe)

**Buscar el bloque** donde se llama `storeCandidateCv` dentro del handler de mensajes de tipo `document`:
```js
await storeCandidateCv(prisma, candidate.id, cvBuffer, {
  mimeType: mimeType || null,
  originalName: filename
});
```

**Reemplazar con:**
```js
if (candidateHasStoredCv(candidate)) {
  // Ya tiene HV: no sobreescribir, informar al candidato
  if (!automationBlocked) {
    const cvGuardMsg = 'Ya tengo tu hoja de vida registrada. Si deseas enviar una nueva, escríbeme primero *"actualizar hoja de vida"* y luego la adjuntas.';
    await reply(prisma, candidate.id, from, cvGuardMsg, filename, { body: cvGuardMsg, source: 'bot_cv_guard' });
  }
} else {
  await storeCandidateCv(prisma, candidate.id, cvBuffer, {
    mimeType: mimeType || null,
    originalName: filename
  });
}
```

---

## CAMBIO 4 — Guard confirmación (solo el mismo día)

**Buscar TODAS las ocurrencias de este bloque** (hay 2 en el archivo):
```js
if (isSchedulingConfirmationIntent(cleanText)) {
  if (activeBooking?.id) {
```

**Reemplazar cada una con:**
```js
if (isSchedulingConfirmationIntent(cleanText)) {
  if (activeBooking?.id) {
    // Solo confirmar si la entrevista es HOY (Colombia UTC-5)
    if (!isInterviewToday(activeBooking)) {
      const scheduledDate = formatInterviewDate(new Date(activeBooking.scheduledAt));
      const earlyConfirmBody = `Gracias por tu respuesta. Tu entrevista está programada para ${scheduledDate}. Podrás confirmar tu asistencia el mismo día de la cita.`;
      return reply(prisma, candidate.id, from, earlyConfirmBody, cleanText, { body: earlyConfirmBody, source: 'interview_confirm_too_early' });
    }
```

> **Nota:** El bloque `if (activeBooking?.id) {` que sigue inmediatamente debe conservarse. Solo se agrega el guard de `isInterviewToday` DENTRO de ese if, antes de la lógica de confirmación existente.

---

Una vez aplicados estos 4 cambios manualmente, eliminar este archivo.
