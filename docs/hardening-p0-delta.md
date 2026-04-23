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
- **Webhook**: integra `responsePolicy` para respuestas de adjuntos, guarda clasificación en `AttachmentAnalysis` y evita pausar automáticamente el bot por recepción de media.
- **Webhook**: ahora pasa outbound reciente al `responsePolicy` para variar respuestas de adjuntos sin repetir frase exacta.
- **Reminder/keepalive**: recordatorio operativo ajustado a una hora y encolado con JobQueue (cuando `FF_POSTGRES_JOB_QUEUE=true`); keepalive se corta al detectar entrevista vencida, reminder ya intentado o booking inactivo.
- **Job worker**: el job `INTERVIEW_REMINDER` procesa por `candidateId` (payload) para evitar ejecuciones amplias no deterministas.
- **JobQueue**: se agrega `completedAt` para trazabilidad de finalización en jobs `DONE` y `FAILED` terminales.
- **Tests**: se amplían casos delta para saludo/nombre, calle 80/edad, género explícito vs ambiguo, no repetición fuerte, reminder + corte keepalive y clasificación de adjuntos.

## Feature flags relevantes (fallback false)

- `FF_RESPONSES_EXTRACTOR`
- `FF_POLICY_LAYER`
- `FF_POSTGRES_JOB_QUEUE`
- `FF_ATTACHMENT_ANALYZER`
- `FF_STOP_KEEPALIVE_AFTER_INTERVIEW`
- `FF_SEMANTIC_SHORT_MEMORY`
- `FF_ASYNC_ADMIN_MEDIA_FORWARD`
