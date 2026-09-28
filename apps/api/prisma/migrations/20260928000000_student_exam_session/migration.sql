-- AlterTable (device-bound session + release audit, §5.3 / FR-30 / FR-32)
ALTER TABLE "StudentExam" ADD COLUMN     "session_ip" VARCHAR(45),
ADD COLUMN     "session_released_at" TIMESTAMP(3),
ADD COLUMN     "session_released_by" UUID,
ADD COLUMN     "session_token" VARCHAR(128);

-- AddForeignKey
ALTER TABLE "StudentExam" ADD CONSTRAINT "StudentExam_session_released_by_fkey" FOREIGN KEY ("session_released_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;