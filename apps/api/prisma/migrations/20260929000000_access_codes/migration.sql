-- AlterTable
ALTER TABLE "Exam" ADD COLUMN     "access_code_encrypted" TEXT,
ADD COLUMN     "access_code_expires_at" TIMESTAMP(3),
ADD COLUMN     "access_code_hash" TEXT;

-- AlterTable
ALTER TABLE "StudentExam" ADD COLUMN     "access_code_attempt_window_started_at" TIMESTAMP(3),
ADD COLUMN     "wrong_access_code_attempts" INTEGER NOT NULL DEFAULT 0;
