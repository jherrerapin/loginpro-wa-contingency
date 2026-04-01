-- Add NO_INTERESADO status to CandidateStatus enum for terminal disinterest flow.
ALTER TYPE "CandidateStatus" ADD VALUE IF NOT EXISTS 'NO_INTERESADO';
