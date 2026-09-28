import { prisma } from '../lib/prisma.js';

export async function finalizeStudentExam(
  studentExamId: string,
  status: 'submitted' | 'auto_submitted' = 'auto_submitted',
) {
  return prisma.$transaction(
    async (tx) => {
      const studentExam = await tx.studentExam.findUnique({
        where: { id: studentExamId },
        include: {
          exam: true,
          questions: {
            include: { grade_adjustments: { orderBy: { created_at: 'desc' } } },
          },
        },
      });
      if (!studentExam) return null;
      if (studentExam.status === 'submitted' || studentExam.status === 'auto_submitted') {
        return studentExam;
      }

      const points = Number(studentExam.exam.points_per_question);
      let total = 0;

      for (const question of studentExam.questions) {
        const adjustment = question.grade_adjustments[0];

        if (adjustment) {
          const awarded = Number(adjustment.new_points);
          total += awarded;
          await tx.studentExamQuestion.update({
            where: { id: question.id },
            data: { grade_awarded: awarded },
          });
        } else {
          const isCorrect =
            question.selected_answer != null &&
            question.selected_answer === question.correct_answer;
          const awarded = isCorrect ? points : 0;
          total += awarded;
          await tx.studentExamQuestion.update({
            where: { id: question.id },
            data: { grade_awarded: awarded },
          });
        }
      }

      return tx.studentExam.update({
        where: { id: studentExamId },
        data: { status, submitted_at: new Date(), total_grade: total },
      });
    },
    { timeout: 30000 },
  );
}

export async function autoSubmitExpiredExams(): Promise<{ finalized: number }> {
  const now = new Date();
  const expired = await prisma.studentExam.findMany({
    where: { status: 'in_progress', deadline_at: { lte: now } },
    select: { id: true },
  });

  for (const studentExam of expired) {
    await finalizeStudentExam(studentExam.id, 'auto_submitted');
  }

  return { finalized: expired.length };
}