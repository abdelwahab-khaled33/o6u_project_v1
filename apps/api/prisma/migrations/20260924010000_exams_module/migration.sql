-- CreateEnum
CREATE TYPE "QuizSource" AS ENUM ('shared_bank', 'own_questions');

-- CreateTable
CREATE TABLE "ExamQuestion" (
    "exam_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,

    CONSTRAINT "ExamQuestion_pkey" PRIMARY KEY ("exam_id","question_id")
);

-- AlterTable
ALTER TABLE "Exam" ADD COLUMN     "owner_id" UUID NOT NULL,
ADD COLUMN     "points_per_question" DECIMAL(6,2) NOT NULL,
ADD COLUMN     "quiz_source" "QuizSource";

-- AlterTable
ALTER TABLE "StudentExam" ADD COLUMN     "deadline_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "StudentExamQuestion" ADD COLUMN     "question_type" "QuestionType" NOT NULL,
ADD COLUMN     "text" TEXT NOT NULL,
ADD COLUMN     "options" JSONB NOT NULL,
ADD COLUMN     "correct_answer" TEXT NOT NULL,
ADD COLUMN     "difficulty" "Difficulty" NOT NULL,
ADD COLUMN     "image_url" TEXT;

-- AddForeignKey
ALTER TABLE "Exam" ADD CONSTRAINT "Exam_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamQuestion" ADD CONSTRAINT "ExamQuestion_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamQuestion" ADD CONSTRAINT "ExamQuestion_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- DropForeignKey
ALTER TABLE "ExamTargetSection" DROP CONSTRAINT "ExamTargetSection_exam_id_fkey";

-- AddForeignKey
ALTER TABLE "ExamTargetSection" ADD CONSTRAINT "ExamTargetSection_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DropForeignKey
ALTER TABLE "ExamTargetStudent" DROP CONSTRAINT "ExamTargetStudent_exam_id_fkey";

-- AddForeignKey
ALTER TABLE "ExamTargetStudent" ADD CONSTRAINT "ExamTargetStudent_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DropForeignKey
ALTER TABLE "StudentExam" DROP CONSTRAINT "StudentExam_exam_id_fkey";

-- AddForeignKey
ALTER TABLE "StudentExam" ADD CONSTRAINT "StudentExam_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;
