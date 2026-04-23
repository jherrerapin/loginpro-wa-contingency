# Hardening P0 Delta

Este delta refina componentes existentes sin rehacer arquitectura:

- **Extractor estructurado**: se amplió el schema con conflictos estructurados, `replyIntent` tipado y evidencia por campo consistente para policy.
- **Extractor estructurado**: se reforzó el prompt de extracción para evitar `fullName` falsos (saludos), evitar edad desde direcciones (ej. "calle 80") y exigir evidencia/coherencia por campo con salida strict JSON Schema.
- **Policy layer**: endurece bloqueo de saludo como nombre, bloqueo de dirección como edad y protección anti-autodescarte para campos críticos con evidencia débil.
- **Policy layer**: la inferencia de género débil pasa a revisión (`weak_gender_inference`) y no se persiste para decisiones duras.
- **Response policy**: ahora usa variantes por intención, control de repetición semántica y salida con `text + intent`.
- **Response policy**: se añadió intención explícita `request_missing_data` y selección con anti-repetición sobre outbound reciente.
- **Response policy**: agrega contexto corto de adjunto/pregunta para evitar respuestas rígidas y repetitivas.
- **Attachment analyzer**: pipeline híbrida PDF/DOCX + fallback multimodal con Responses API, sin tratar automáticamente toda imagen como HV en foto.
- **Attachment analyzer**: se fija política explícita para `.doc` legacy: no se procesa con `mammoth`, se clasifica como `OTHER` (`unsupported_doc_format`) y se solicita reenviar HV en PDF o DOCX para evitar falsos `CV_VALID`.
- **Webhook**: integra `responsePolicy` para respuestas de adjuntos, guarda clasificación en `AttachmentAnalysis` y evita pausar automáticamente el bot por recepción de media.
- **Webhook**: ahora pasa outbound reciente al `responsePolicy` para variar respuestas de adjuntos sin repetir frase exacta.
- **Reminder/keepalive**: recordatorio operativo ajustado a una hora y encolado con JobQueue (cuando `FF_POSTGRES_JOB_QUEUE=true`); keepalive se corta como política permanente al detectar entrevista vencida, reminder ya intentado o booking inactivo (sin depender de rollout adicional).
- **Job worker**: el job `INTERVIEW_REMINDER` procesa por `candidateId` (payload) para evitar ejecuciones amplias no deterministas.
- **JobQueue**: se agrega `completedAt` para trazabilidad de finalización en jobs `DONE` y `FAILED` terminales.
- **Tests**: se amplían casos delta para saludo/nombre, calle 80/edad, género explícito vs ambiguo, no repetición fuerte, reminder + corte keepalive y clasificación de adjuntos.

## Alcance real PR 64 (quirúrgico post PR 63)

- Corregir soporte de adjuntos para bloquear `.doc` legacy y guiar a PDF/DOCX.
- Formalizar que keepalive no debe ejecutarse después de entrevista vencida ni en bookings cerrados/intentados.
- Cubrir explícitamente con tests: `.doc` no válido como HV, anti-repetición con contexto de pregunta+adjunto, dispatcher por `candidateId`, y guardas de keepalive.
- Sin cambios de `ConversationStep`, sin cambios SaaS/tenant/RLS, sin rehacer webhook/conversationEngine ni extractor estructurado.

## Feature flags relevantes (fallback false)

- `FF_RESPONSES_EXTRACTOR`
- `FF_POLICY_LAYER`
- `FF_POSTGRES_JOB_QUEUE`
- `FF_ATTACHMENT_ANALYZER`
- `FF_SEMANTIC_SHORT_MEMORY`
- `FF_ASYNC_ADMIN_MEDIA_FORWARD`

## Interview lifecycle hardening definitivo

- **SCHEDULED vs CONFIRMED**:
  - Aceptar un horario crea/actualiza booking en `SCHEDULED`.
  - `CONFIRMED` solo se permite como confirmación de asistencia cerca de entrevista.
  - Ventana explícita de confirmación: `INTERVIEW_CONFIRMATION_WINDOW_HOURS` (default `6` horas).
  - Si ya se envió reminder de entrevista (`reminderSentAt`), una confirmación afirmativa sí puede marcar `CONFIRMED`.
  - Un “confirmo” temprano, fuera de ventana y sin reminder enviado, **no** cambia estado.

- **Recordatorio real de entrevista**:
  - Se ejecuta a `scheduledAt - 1 hora`.
  - Marca `reminderSentAt` y cierra keepalive (`reminderWindowClosed=true`).
  - Solo envía si booking está activo (`SCHEDULED`/`CONFIRMED`), no vencido y sin reminder previo.
  - El copy es explícitamente de entrevista (no de faltantes/HV).

- **Intenciones de entrevista centralizadas**:
  - Se agregó servicio determinista reutilizable (`interviewLifecycle`) para detectar:
    - `confirm_attendance`
    - `cancel_interview`
    - `reschedule_interview`
    - `none`
  - La detección depende de texto + proximidad temporal + estado de reminder + existencia de booking activo.

- **Política de cancelación / reagendamiento**:
  - Cancelación explícita: `booking.status = CANCELLED` + `reminderResponse` con evidencia textual.
  - Reagendamiento explícito: `booking.status = RESCHEDULED` + `reminderResponse`, conservando oferta de nuevo slot cuando hay wiring.

- **Política NO_RESPONSE (10 minutos antes)**:
  - Configurable por `INTERVIEW_NO_RESPONSE_MINUTES_BEFORE` (default `10`).
  - Si reminder ya salió y no existe respuesta inbound del candidato, al entrar en umbral se marca `NO_RESPONSE`.
  - Luego de `NO_RESPONSE`, no se insiste con keepalive ni nuevos recordatorios automáticos para esa entrevista.

- **Keepalive y cero insistencia post-entrevista**:
  - Keepalive solo corre si existe booking activo real.
  - No se envía keepalive para candidatos en `SCHEDULING` sin booking.
  - Keepalive se corta cuando: reminder enviado/intento, booking cerrado/inactivo o entrevista vencida.
  - Después de `scheduledAt`: no keepalive, no reminder de entrevista, no insistencia automática por esa cita.

- **Canal WhatsApp**:
  - Se mantiene política sin templates de Meta para este flujo.
