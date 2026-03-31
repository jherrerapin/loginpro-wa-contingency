# Loginpro WhatsApp Contingency Starter

## Objetivo
Proyecto paralelo para captar candidatos por WhatsApp, recibir hoja de vida y mostrar todo en un panel admin sin tocar el proyecto actual.

## Requisitos
- Node.js 20+
- PostgreSQL 15+
- Cuenta Meta con WhatsApp Cloud API ya habilitada
- Bucket S3 compatible (Cloudflare R2 recomendado)

## Arranque local
1. Copia `.env.example` a `.env`
2. Instala dependencias: `npm install`
3. Ejecuta migraciones:
   - `npx prisma generate`
   - `npx prisma migrate dev --name init`
4. Arranca: `npm run dev`

## Endpoints
- Health: `/health`
- Webhook verify + receive: `/webhook`
- Admin: `/admin`

## Nota crítica
No uses `.env` manual en servidor. En producción, carga todas las variables como secrets del proveedor.
