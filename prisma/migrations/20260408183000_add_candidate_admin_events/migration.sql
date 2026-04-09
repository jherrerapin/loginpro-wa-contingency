CREATE TABLE "CandidateAdminEvent" (
  "id" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "actorRole" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "eventLabel" TEXT NOT NULL,
  "fromValue" TEXT,
  "toValue" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CandidateAdminEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CandidateAdminEvent_candidateId_createdAt_idx"
  ON "CandidateAdminEvent"("candidateId", "createdAt");

ALTER TABLE "CandidateAdminEvent"
  ADD CONSTRAINT "CandidateAdminEvent_candidateId_fkey"
  FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
