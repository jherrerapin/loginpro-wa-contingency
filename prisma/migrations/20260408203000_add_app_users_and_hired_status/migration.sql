ALTER TYPE "CandidateStatus" ADD VALUE IF NOT EXISTS 'CONTRATADO';

CREATE TYPE "AppUserRole" AS ENUM ('DEV', 'ADMIN');

CREATE TYPE "UserAccessScope" AS ENUM ('ALL', 'CITY', 'VACANCY');

CREATE TABLE "AppUser" (
  "id" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "recoveryCodeHash" TEXT,
  "role" "AppUserRole" NOT NULL DEFAULT 'ADMIN',
  "accessScope" "UserAccessScope" NOT NULL DEFAULT 'ALL',
  "scopeCity" TEXT,
  "scopeVacancyId" TEXT,
  "recoveryPhone" TEXT,
  "recoveryEmail" TEXT,
  "createdByUsername" TEXT,
  "lastPasswordResetAt" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AppUser_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AppUser_username_key" ON "AppUser"("username");
CREATE INDEX "AppUser_accessScope_scopeCity_idx" ON "AppUser"("accessScope", "scopeCity");
CREATE INDEX "AppUser_scopeVacancyId_idx" ON "AppUser"("scopeVacancyId");

ALTER TABLE "AppUser"
  ADD CONSTRAINT "AppUser_scopeVacancyId_fkey"
  FOREIGN KEY ("scopeVacancyId") REFERENCES "Vacancy"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
