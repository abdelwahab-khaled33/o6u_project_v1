import { prisma } from '../lib/prisma.js';
import type { Prisma } from '@prisma/client';
import type { AdjustmentType } from '@exam/shared';

export interface GradeAdjustmentParams {
  sourceQuestionId: string;
  examId: string;
  adjustmentType: AdjustmentType;
  points?: number;
  studentExamIds?: string[];
  reason: string;
  actorId: string;
}

export interface GradeAdjustmentResult {
  adjustmentCount: number;
  totalGradeRecalculated: number;
}

export async function applyGradeCompensation(
  params: GradeAdjustmentParams,
): Promise<GradeAdjustmentResult> {
  if (params.adjustmentType === 'set_points' && params.points == null) {
    throw Object.assign(new Error('points is required for set_points adjustment'), { statusCode: 400 });
  }

  return prisma.$transaction(
    async (tx) => {
      const exam = await tx.exam.findUnique({
        where: { id: params.examId },
        select: { points_per_question: true },
      });
      if (!exam) throw Object.assign(new Error('Exam not found'), { statusCode: 404 });

      const pointsPerQuestion = Number(exam.points_per_question);

      const newPoints =
        params.adjustmentType === 'full_credit'
          ? pointsPerQuestion
          : params.points!;

      const questionWhere: Prisma.StudentExamQuestionWhereInput = {
        student_exam: { exam_id: params.examId },
        question_id: params.sourceQuestionId,
      };

      if (params.studentExamIds && params.studentExamIds.length > 0) {
        questionWhere.student_exam_id = { in: params.studentExamIds };
      }

      const seqs = await tx.studentExamQuestion.findMany({
        where: questionWhere,
        select: {
          id: true,
          student_exam_id: true,
          grade_awarded: true,
          student_exam: { select: { status: true, total_grade: true } },
        },
      });

      if (seqs.length === 0) {
        throw Object.assign(
          new Error(
            'No matching student exam questions found for this source question in this exam',
          ),
          { statusCode: 404 },
        );
      }

      const adjustments: Prisma.GradeAdjustmentCreateManyInput[] = [];
      const submittedUpdates: Array<{
        seqId: string;
        newPoints: number;
        studentExamId: string;
      }> = [];

      for (const seq of seqs) {
        const previous = seq.grade_awarded != null ? Number(seq.grade_awarded) : 0;

        adjustments.push({
          student_exam_question_id: seq.id,
          actor_id: params.actorId,
          adjustment_type: params.adjustmentType,
          reason: params.reason,
          previous_points: previous,
          new_points: newPoints,
        });

        const isSubmitted =
          seq.student_exam.status === 'submitted' ||
          seq.student_exam.status === 'auto_submitted';

        if (isSubmitted) {
          submittedUpdates.push({
            seqId: seq.id,
            newPoints,
            studentExamId: seq.student_exam_id,
          });
        }
      }

      await tx.gradeAdjustment.createMany({ data: adjustments });

      let totalGradeRecalculated = 0;

      if (submittedUpdates.length > 0) {
        for (const update of submittedUpdates) {
          await tx.studentExamQuestion.update({
            where: { id: update.seqId },
            data: { grade_awarded: update.newPoints },
          });
        }

        const uniqueStudentExamIds = [
          ...new Set(submittedUpdates.map((u) => u.studentExamId)),
        ];

        for (const studentExamId of uniqueStudentExamIds) {
          const allQuestions = await tx.studentExamQuestion.findMany({
            where: { student_exam_id: studentExamId },
            select: { grade_awarded: true },
          });

          const total = allQuestions.reduce(
            (sum, q) => sum + (q.grade_awarded != null ? Number(q.grade_awarded) : 0),
            0,
          );

          await tx.studentExam.update({
            where: { id: studentExamId },
            data: { total_grade: total },
          });

          totalGradeRecalculated++;
        }
      }

      return {
        adjustmentCount: adjustments.length,
        totalGradeRecalculated,
      };
    },
    { timeout: 30000 },
  );
}