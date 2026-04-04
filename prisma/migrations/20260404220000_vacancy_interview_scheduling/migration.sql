-- Migration: 20260404220000_vacancy_interview_scheduling
-- Adds: Gender enum, ExperienceRequirement enum, BookingStatus enum,
--       ConversationStep new values (SCHEDULING, SCHEDULED),
--       Vacancy model, InterviewSlot model, InterviewBooking model,
--       New columns in Candidate (vacancyId, gender, locality, zoneViable, interviewNotes)

-- ─────────────────────────────────────────────
-- 1. Nuevos ENUMs
-- ─────────────────────────────────────────────

CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER', 'UNKNOWN');

CREATE TYPE "ExperienceRequirement" AS ENUM ('YES', 'NO', 'INDIFFERENT');

CREATE TYPE "BookingStatus" AS ENUM ('SCHEDULED', 'CONFIRMED', 'RESCHEDULED', 'NO_SHOW', 'CANCELLED');

-- Agrega nuevos valores al enum ConversationStep
ALTER TYPE "ConversationStep" ADD VALUE IF NOT EXISTS 'SCHEDULING';
ALTER TYPE "ConversationStep" ADD VALUE IF NOT EXISTS 'SCHEDULED';

-- ─────────────────────────────────────────────
-- 2. Tabla Vacancy
-- ─────────────────────────────────────────────

CREATE TABLE "Vacancy" (
    "id"                    TEXT NOT NULL,
    "title"                 TEXT NOT NULL,
    "role"                  TEXT NOT NULL,
    "roleDescription"       TEXT,
    "city"                  TEXT NOT NULL,
    "operationAddress"      TEXT NOT NULL,
    "requirements"          TEXT NOT NULL,
    "conditions"            TEXT NOT NULL,
    "requiredDocuments"     TEXT,
    "minAge"                INTEGER,
    "maxAge"                INTEGER,
    "experienceRequired"    "ExperienceRequirement" NOT NULL DEFAULT 'INDIFFERENT',
    "minExperienceMonths"   INTEGER,
    "maxExperienceMonths"   INTEGER,
    "imageData"             BYTEA,
    "imageMimeType"         TEXT,
    "zoneFilterEnabled"     BOOLEAN NOT NULL DEFAULT false,
    "zoneContext"           TEXT,
    "schedulingEnabled"     BOOLEAN NOT NULL DEFAULT false,
    "acceptingApplications" BOOLEAN NOT NULL DEFAULT true,
    "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"             TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vacancy_pkey" PRIMARY KEY ("id")
);

-- ─────────────────────────────────────────────
-- 3. Tabla InterviewSlot
-- ─────────────────────────────────────────────

CREATE TABLE "InterviewSlot" (
    "id"                  TEXT NOT NULL,
    "vacancyId"           TEXT NOT NULL,
    "dayOfWeek"           INTEGER,
    "specificDate"        TIMESTAMP(3),
    "startTime"           TEXT NOT NULL,
    "endTime"             TEXT NOT NULL,
    "slotDurationMinutes" INTEGER NOT NULL DEFAULT 20,
    "maxCandidates"       INTEGER NOT NULL DEFAULT 10,
    "isActive"            BOOLEAN NOT NULL DEFAULT true,
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterviewSlot_pkey" PRIMARY KEY ("id")
);

-- ─────────────────────────────────────────────
-- 4. Tabla InterviewBooking
-- ─────────────────────────────────────────────

CREATE TABLE "InterviewBooking" (
    "id"                   TEXT NOT NULL,
    "candidateId"          TEXT NOT NULL,
    "vacancyId"            TEXT NOT NULL,
    "slotId"               TEXT NOT NULL,
    "scheduledAt"          TIMESTAMP(3) NOT NULL,
    "status"               "BookingStatus" NOT NULL DEFAULT 'SCHEDULED',
    "reminderSentAt"       TIMESTAMP(3),
    "reminderWindowClosed" BOOLEAN NOT NULL DEFAULT false,
    "reminderResponse"     TEXT,
    "notes"                TEXT,
    "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"            TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterviewBooking_pkey" PRIMARY KEY ("id")
);

-- ─────────────────────────────────────────────
-- 5. Columnas nuevas en Candidate
-- ─────────────────────────────────────────────

ALTER TABLE "Candidate"
    ADD COLUMN IF NOT EXISTS "vacancyId"       TEXT,
    ADD COLUMN IF NOT EXISTS "gender"          "Gender" NOT NULL DEFAULT 'UNKNOWN',
    ADD COLUMN IF NOT EXISTS "locality"        TEXT,
    ADD COLUMN IF NOT EXISTS "zoneViable"      BOOLEAN,
    ADD COLUMN IF NOT EXISTS "interviewNotes"  TEXT;

-- ─────────────────────────────────────────────
-- 6. Foreign keys
-- ─────────────────────────────────────────────

ALTER TABLE "Candidate"
    ADD CONSTRAINT "Candidate_vacancyId_fkey"
        FOREIGN KEY ("vacancyId") REFERENCES "Vacancy"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InterviewSlot"
    ADD CONSTRAINT "InterviewSlot_vacancyId_fkey"
        FOREIGN KEY ("vacancyId") REFERENCES "Vacancy"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InterviewBooking"
    ADD CONSTRAINT "InterviewBooking_candidateId_fkey"
        FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InterviewBooking"
    ADD CONSTRAINT "InterviewBooking_vacancyId_fkey"
        FOREIGN KEY ("vacancyId") REFERENCES "Vacancy"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InterviewBooking"
    ADD CONSTRAINT "InterviewBooking_slotId_fkey"
        FOREIGN KEY ("slotId") REFERENCES "InterviewSlot"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
