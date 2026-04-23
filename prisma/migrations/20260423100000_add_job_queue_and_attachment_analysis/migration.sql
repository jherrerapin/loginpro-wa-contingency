-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "AttachmentClassification" AS ENUM ('CV_VALID', 'CV_IMAGE_ONLY', 'ID_DOC', 'OTHER', 'UNREADABLE');

-- CreateTable
CREATE TABLE "JobQueue" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "dedupe_key" TEXT,
  "run_at" TIMESTAMP(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 5,
  "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JobQueue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttachmentAnalysis" (
  "id" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "messageId" TEXT,
  "classification" "AttachmentClassification" NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "evidence" TEXT,
  "mimeType" TEXT,
  "fileName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AttachmentAnalysis_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "JobQueue_status_run_at_idx" ON "JobQueue"("status", "run_at");
CREATE UNIQUE INDEX "JobQueue_type_dedupe_key_key" ON "JobQueue"("type", "dedupe_key");
CREATE INDEX "AttachmentAnalysis_candidateId_createdAt_idx" ON "AttachmentAnalysis"("candidateId", "createdAt");

-- FK
ALTER TABLE "AttachmentAnalysis" ADD CONSTRAINT "AttachmentAnalysis_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
