import type { Prisma, Question, Difficulty } from '@prisma/client';
import crypto from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { getEligibleStudentIds } from './exam-eligibility.js';
import { shuffle, chunk } from './random.js';

type DifficultyMix = { easy: number; medium: number; hard: number };

const TIERS: Difficulty[] = ['easy', 'medium', 'hard'];

export type PoolSufficiency =
  | { ok: true }
  | { ok: false; error: string };

export function checkPoolSufficiency(
  poolQuestions: { difficulty: Difficulty }[],
  mix: DifficultyMix,
): PoolSufficiency {
  const counts: Record<Difficulty, number> = { easy: 0, medium: 0, hard: 0 };
  for (const q of poolQuestions) counts[q.difficulty]++;

  for (const tier of TIERS) {
    const needed = mix[tier] ?? 0;
    if (needed > 0 && counts[tier] < needed) {
      return {
        ok: false,
        error: `Pool has only ${counts[tier]} ${tier} question(s) but ${needed} are required`,
      };
    }
  }
  return { ok: true };
}

function buildSnapshot(question: Question): { options: string[]; correctAnswer: string } {
  if (question.question_type === 'true_false') {
    return {
      options: ['true', 'false'],
      correctAnswer: question.correct_answer.toLowerCase(),
    };
  }
  const options = shuffle(question.options as string[]);
  return { options, correctAnswer: question.correct_answer };
}

async function loadPoolByTier(
  client: Prisma.TransactionClient,
  examId: string,
): Promise<Record<Difficulty, Question[]>> {
  const poolLinks = await client.examQuestion.findMany({
    where: { exam_id: examId },
    include: { question: true },
  });

  const poolByTier: Record<Difficulty, Question[]> = { easy: [], medium: [], hard: [] };
  for (const link of poolLinks) {
    if (!link.question.is_archived) {
      poolByTier[link.question.difficulty].push(link.question);
    }
  }
  return poolByTier;
}

function sampleForStudent(
  poolByTier: Record<Difficulty, Question[]>,
  usage: Map<string, number>,
  mix: DifficultyMix,
): Question[] {
  let selected: Question[] = [];

  for (const tier of TIERS) {
    const needed = mix[tier] ?? 0;
    if (needed === 0) continue;

    const candidates = shuffle(poolByTier[tier]).sort(
      (a, b) => (usage.get(a.id) ?? 0) - (usage.get(b.id) ?? 0),
    );
    const picked = candidates.slice(0, needed);
    for (const q of picked) usage.set(q.id, (usage.get(q.id) ?? 0) + 1);
    selected = selected.concat(picked);
  }

  return shuffle(selected);
}

export async function generateStudentExamsForExam(
  client: Prisma.TransactionClient,
  examId: string,
): Promise<{ generated: number }> {
  const exam = await client.exam.findUniqueOrThrow({ where: { id: examId } });
  const mix = exam.difficulty_mix as unknown as DifficultyMix;

  const poolByTier = await loadPoolByTier(client, examId);
  const sufficiency = checkPoolSufficiency(
    TIERS.flatMap((tier) => poolByTier[tier]),
    mix,
  );
  if (!sufficiency.ok) {
    throw new Error(sufficiency.error);
  }

  // The client must be threaded through: for sections/student_list scopes the target
  // rows are still uncommitted when this runs, and the default singleton cannot see them,
  // which silently produced zero attempts for every TA quiz created approved in-transaction.
  const eligibleStudentIds = await getEligibleStudentIds(exam, client);
  if (eligibleStudentIds.length === 0) {
    return { generated: 0 };
  }

  const existing = await client.studentExam.findMany({
    where: { exam_id: examId, student_id: { in: eligibleStudentIds } },
    select: { student_id: true },
  });
  const already = new Set(existing.map((e) => e.student_id));
  const toGenerate = eligibleStudentIds.filter((id) => !already.has(id));
  if (toGenerate.length === 0) {
    return { generated: 0 };
  }

  const usage = new Map<string, number>();

  const studentExamCreates: Prisma.StudentExamCreateManyInput[] = [];
  const questionCreates: Prisma.StudentExamQuestionCreateManyInput[] = [];

  for (const studentId of toGenerate) {
    const studentExamId = crypto.randomUUID();
    studentExamCreates.push({
      id: studentExamId,
      exam_id: examId,
      student_id: studentId,
      status: 'not_started',
    });

    const selected = sampleForStudent(poolByTier, usage, mix);
    selected.forEach((question, index) => {
      const { options, correctAnswer } = buildSnapshot(question);
      questionCreates.push({
        id: crypto.randomUUID(),
        student_exam_id: studentExamId,
        question_id: question.id,
        question_type: question.question_type,
        text: question.text,
        options,
        correct_answer: correctAnswer,
        difficulty: question.difficulty,
        image_url: question.image_url,
        order: index,
      });
    });
  }

  for (const batch of chunk(studentExamCreates, 1000)) {
    await client.studentExam.createMany({ data: batch });
  }
  for (const batch of chunk(questionCreates, 1000)) {
    await client.studentExamQuestion.createMany({ data: batch });
  }

  return { generated: toGenerate.length };
}

export async function ensureStudentExamForStudent(
  examId: string,
  studentId: string,
): Promise<void> {
  const existing = await prisma.studentExam.findUnique({
    where: { exam_id_student_id: { exam_id: examId, student_id: studentId } },
  });
  if (existing) return;

  try {
    await prisma.$transaction(
      async (tx) => {
        const exam = await tx.exam.findUniqueOrThrow({ where: { id: examId } });
        if (exam.status !== 'approved') return;

        const stillExisting = await tx.studentExam.findUnique({
          where: { exam_id_student_id: { exam_id: examId, student_id: studentId } },
        });
        if (stillExisting) return;

        const poolByTier = await loadPoolByTier(tx, examId);
        const mix = exam.difficulty_mix as unknown as DifficultyMix;
        const usage = new Map<string, number>();
        const selected = sampleForStudent(poolByTier, usage, mix);

        const studentExamId = crypto.randomUUID();
        await tx.studentExam.create({
          data: {
            id: studentExamId,
            exam_id: examId,
            student_id: studentId,
            status: 'not_started',
          },
        });

        const data: Prisma.StudentExamQuestionCreateManyInput[] = selected.map(
          (question, index) => {
            const { options, correctAnswer } = buildSnapshot(question);
            return {
              id: crypto.randomUUID(),
              student_exam_id: studentExamId,
              question_id: question.id,
              question_type: question.question_type,
              text: question.text,
              options,
              correct_answer: correctAnswer,
              difficulty: question.difficulty,
              image_url: question.image_url,
              order: index,
            };
          },
        );
        if (data.length > 0) {
          await tx.studentExamQuestion.createMany({ data });
        }
      },
      { timeout: 30000 },
    );
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== 'P2002') throw err;
  }
}
