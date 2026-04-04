# ────────────────────────────────────────────────────────────────────
# Stage 1 — deps
# Instala SOLO dependencias de producción.
# Se ejecuta en una imagen con todas las herramientas de build; el resultado
# (node_modules) se copia al stage final para no arrastrar el toolchain.
# ────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /build

# Copia manifiestos de dependencias.
COPY package.json package-lock.json* ./

# npm ci garantiza un install reproducible y limpio.
# --omit=dev excluye devDependencies (nodemon, etc.)
RUN npm ci --omit=dev --ignore-scripts

# ────────────────────────────────────────────────────────────────────
# Stage 2 — builder
# Genera el Prisma Client contra el schema del proyecto.
# Se necesita prisma CLI + schema + node_modules de prod para esto.
# ────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /build

# Copia node_modules del stage anterior (sin reinstalar).
COPY --from=deps /build/node_modules ./node_modules
COPY package.json ./
COPY prisma ./prisma

# Genera el Prisma Client tipado para la imagen de producción.
RUN node_modules/.bin/prisma generate

# ────────────────────────────────────────────────────────────────────
# Stage 3 — runner (imagen final)
# Imagen mínima: solo runtime, código de la app y artefactos necesarios.
# Sin npm, sin CLI de Prisma, sin devDeps.
# ────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

# Metadatos de la imagen.
LABEL org.opencontainers.image.title="loginpro-wa-contingency"
LABEL org.opencontainers.image.description="Bot de reclutamiento WhatsApp + dashboard admin"
LABEL org.opencontainers.image.source="https://github.com/jherrerapin/loginpro-wa-contingency"

WORKDIR /app

# Variables de entorno de producción.
ENV NODE_ENV=production
ENV PORT=3000

# Copia node_modules con Prisma Client ya generado.
COPY --from=builder /build/node_modules ./node_modules

# Copia schema de Prisma (necesario para migrate deploy en runtime).
COPY prisma ./prisma

# Copia código fuente de la aplicación.
COPY src ./src

# Copia manifiestos (requerido por Node.js ESM para resolver el package type).
COPY package.json ./

# — Seguridad: no correr como root —
# La imagen node:20-alpine incluye el usuario "node" (uid 1000).
# Cambiar ownership antes de hacer el switch.
RUN chown -R node:node /app
USER node

EXPOSE 3000

# Healthcheck interno: verifica que el servidor responde en /health.
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

# ENTRYPOINT con exec form para recibir señales del OS correctamente (SIGTERM).
# migrate deploy: aplica migraciones pendientes antes de arrancar.
# Si no hay migraciones nuevas, es un no-op seguro.
ENTRYPOINT ["sh", "-c"]
CMD ["node_modules/.bin/prisma migrate deploy && node src/server.js"]
