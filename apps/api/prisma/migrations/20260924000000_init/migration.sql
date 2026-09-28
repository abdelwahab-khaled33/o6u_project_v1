-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'doctor', 'ta', 'student');

-- CreateEnum
CREATE TYPE "QuestionOwnerType" AS ENUM ('doctor', 'ta_shared');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('mcq', 'true_false');

-- CreateEnum
CREATE TYPE "Difficulty" AS ENUM ('easy', 'medium', 'hard');

-- CreateEnum
CREATE TYPE "ExamType" AS ENUM ('doctor_exam', 'ta_quiz');

-- CreateEnum
CREATE TYPE "ExamStatus" AS ENUM ('draft', 'pending_approval', 'approved', 'rejected', 'locked', 'closed');

-- CreateEnum
CREATE TYPE "TargetScope" AS ENUM ('subject', 'sections', 'student_list');

-- CreateEnum
CREATE TYPE "StudentExamStatus" AS ENUM ('not_started', 'in_progress', 'submitted', 'auto_submitted');

-- CreateEnum
CREATE TYPE "ImportType" AS ENUM ('users', 'questions');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "student_code" TEXT,
    "role" "Role" NOT NULL,
    "can_change_password" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subject" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Subject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Enrollment" (
    "student_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,

    CONSTRAINT "Enrollment_pkey" PRIMARY KEY ("student_id","subject_id")
);

-- CreateTable
CREATE TABLE "DoctorAssignment" (
    "doctor_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,

    CONSTRAINT "DoctorAssignment_pkey" PRIMARY KEY ("doctor_id","subject_id")
);

-- CreateTable
CREATE TABLE "Section" (
    "id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "ta_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Section_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SectionMembership" (
    "student_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,

    CONSTRAINT "SectionMembership_pkey" PRIMARY KEY ("student_id","section_id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "owner_type" "QuestionOwnerType" NOT NULL,
    "doctor_id" UUID,
    "added_by_ta_id" UUID,
    "question_type" "QuestionType" NOT NULL,
    "text" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "correct_answer" TEXT NOT NULL,
    "grade" DECIMAL(6,2) NOT NULL,
    "difficulty" "Difficulty" NOT NULL,
    "image_url" TEXT,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exam" (
    "id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "type" "ExamType" NOT NULL,
    "created_by" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ExamStatus" NOT NULL DEFAULT 'draft',
    "rejection_reason" TEXT,
    "approved_by" UUID,
    "approved_at" TIMESTAMP(3),
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3) NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "difficulty_mix" JSONB NOT NULL,
    "target_scope" "TargetScope" NOT NULL DEFAULT 'subject',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Exam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamTargetSection" (
    "exam_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,

    CONSTRAINT "ExamTargetSection_pkey" PRIMARY KEY ("exam_id","section_id")
);

-- CreateTable
CREATE TABLE "ExamTargetStudent" (
    "exam_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,

    CONSTRAINT "ExamTargetStudent_pkey" PRIMARY KEY ("exam_id","student_id")
);

-- CreateTable
CREATE TABLE "StudentExam" (
    "id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "status" "StudentExamStatus" NOT NULL DEFAULT 'not_started',
    "started_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3),
    "total_grade" DECIMAL(6,2),
    "last_heartbeat_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentExam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentExamQuestion" (
    "id" UUID NOT NULL,
    "student_exam_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "selected_answer" TEXT,
    "is_flagged" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL,
    "grade_awarded" DECIMAL(6,2),
    "credit_adjustment_reason" TEXT,

    CONSTRAINT "StudentExamQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "permission_key" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPermissionOverride" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "permission_key" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserPermissionOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GradeAdjustment" (
    "id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "question_id" UUID,
    "adjustment_type" TEXT NOT NULL,
    "adjustment_value" DECIMAL(6,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "previous_value" DECIMAL(6,2),
    "resulting_value" DECIMAL(6,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GradeAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExcelImportLog" (
    "id" UUID NOT NULL,
    "import_type" "ImportType" NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "total_rows" INTEGER NOT NULL,
    "imported_count" INTEGER NOT NULL,
    "error_count" INTEGER NOT NULL,
    "error_report" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExcelImportLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_student_code_key" ON "User"("student_code");

-- CreateIndex
CREATE UNIQUE INDEX "Subject_code_key" ON "Subject"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Section_subject_id_ta_id_name_key" ON "Section"("subject_id", "ta_id", "name");

-- CreateIndex
CREATE INDEX "Question_subject_id_owner_type_idx" ON "Question"("subject_id", "owner_type");

-- CreateIndex
CREATE INDEX "Question_difficulty_idx" ON "Question"("difficulty");

-- CreateIndex
CREATE INDEX "StudentExam_status_idx" ON "StudentExam"("status");

-- CreateIndex
CREATE UNIQUE INDEX "StudentExam_exam_id_student_id_key" ON "StudentExam"("exam_id", "student_id");

-- CreateIndex
CREATE INDEX "StudentExamQuestion_student_exam_id_order_idx" ON "StudentExamQuestion"("student_exam_id", "order");

-- CreateIndex
CREATE UNIQUE INDEX "StudentExamQuestion_student_exam_id_question_id_key" ON "StudentExamQuestion"("student_exam_id", "question_id");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_role_permission_key_key" ON "Permission"("role", "permission_key");

-- CreateIndex
CREATE UNIQUE INDEX "UserPermissionOverride_user_id_permission_key_key" ON "UserPermissionOverride"("user_id", "permission_key");

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorAssignment" ADD CONSTRAINT "DoctorAssignment_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorAssignment" ADD CONSTRAINT "DoctorAssignment_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Section" ADD CONSTRAINT "Section_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Section" ADD CONSTRAINT "Section_ta_id_fkey" FOREIGN KEY ("ta_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectionMembership" ADD CONSTRAINT "SectionMembership_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectionMembership" ADD CONSTRAINT "SectionMembership_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "Section"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_added_by_ta_id_fkey" FOREIGN KEY ("added_by_ta_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exam" ADD CONSTRAINT "Exam_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exam" ADD CONSTRAINT "Exam_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exam" ADD CONSTRAINT "Exam_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamTargetSection" ADD CONSTRAINT "ExamTargetSection_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "Exam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamTargetSection" ADD CONSTRAINT "ExamTargetSection_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "Section"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamTargetStudent" ADD CONSTRAINT "ExamTargetStudent_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "Exam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamTargetStudent" ADD CONSTRAINT "ExamTargetStudent_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentExam" ADD CONSTRAINT "StudentExam_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "Exam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentExam" ADD CONSTRAINT "StudentExam_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentExamQuestion" ADD CONSTRAINT "StudentExamQuestion_student_exam_id_fkey" FOREIGN KEY ("student_exam_id") REFERENCES "StudentExam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentExamQuestion" ADD CONSTRAINT "StudentExamQuestion_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPermissionOverride" ADD CONSTRAINT "UserPermissionOverride_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeAdjustment" ADD CONSTRAINT "GradeAdjustment_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "Exam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeAdjustment" ADD CONSTRAINT "GradeAdjustment_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExcelImportLog" ADD CONSTRAINT "ExcelImportLog_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

