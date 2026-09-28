-- CreateEnum
CREATE TYPE "GradeAdjustmentType" AS ENUM ('full_credit', 'set_points');

-- DropTable (GradeAdjustment rebuilt with per-student linkage)
DROP TABLE "GradeAdjustment";

-- CreateTable
CREATE TABLE "GradeAdjustment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "student_exam_question_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "adjustment_type" "GradeAdjustmentType" NOT NULL,
    "reason" TEXT NOT NULL,
    "previous_points" DECIMAL(6,2) NOT NULL,
    "new_points" DECIMAL(6,2) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GradeAdjustment_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "GradeAdjustment" ADD CONSTRAINT "GradeAdjustment_student_exam_question_id_fkey" FOREIGN KEY ("student_exam_question_id") REFERENCES "StudentExamQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeAdjustment" ADD CONSTRAINT "GradeAdjustment_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;