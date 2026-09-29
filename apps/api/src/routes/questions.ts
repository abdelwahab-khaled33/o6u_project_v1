import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { isUuid, requireUuidParam } from '../lib/uuid-param.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { canManageBank, buildScopedSubjectWhere } from '../services/subject-access.js';
import {
  dryRunQuestionImport,
  commitQuestionImport,
} from '../services/questions-import.js';
import { buildQuestionBankWorkbook } from '../services/questions-export.js';
import { sniffImage } from '../services/image-sniff.js';

const uploadDir = path.resolve(process.cwd(), 'uploads', 'images');
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

export const questionBankRouter = Router();
questionBankRouter.use(requireAuth, requirePermission('question_bank.manage'));

const questionSchema = z.object({
  subject_id: z.string().min(1),
  question_type: z.enum(['mcq', 'true_false']),
  text: z.string().min(1),
  options: z.array(z.string()).min(2).max(8).optional(),
  correct_answer: z.string().min(1),
  grade: z.number().positive(),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  image_url: z.string().nullable().optional(),
});

type AnswerCheck = { ok: true; correct_answer: string } | { ok: false; error: string };

/**
 * Guarantees the stored correct_answer is something a student can actually pick.
 *
 * MCQ options are compared verbatim because grading compares the submitted option
 * string, and true_false is lowercased because its option list is ['true','false'].
 */
export function normalizeQuestionAnswer(input: {
  question_type: 'mcq' | 'true_false';
  options: string[] | null | undefined;
  correct_answer: string;
}): AnswerCheck {
  const { question_type, options, correct_answer } = input;

  if (question_type === 'true_false') {
    const normalized = correct_answer.toLowerCase();
    if (normalized !== 'true' && normalized !== 'false') {
      return { ok: false, error: 'Correct answer must be true or false' };
    }
    return { ok: true, correct_answer: normalized };
  }

  if (!options) {
    return { ok: false, error: 'options are required for MCQ questions' };
  }
  if (options.length < 2) {
    return { ok: false, error: 'An MCQ question needs at least two options' };
  }
  if (!options.includes(correct_answer)) {
    return { ok: false, error: 'Correct answer must be one of the options' };
  }
  return { ok: true, correct_answer };
}

/**
 * The only image reference a stored question may carry.
 *
 * image_url is rendered as <img src> on the student runner, so it is stored in a column
 * and then handed to every student who sits the exam. Accepting any string here would
 * let one author point the whole cohort at a third-party host, a `javascript:` URL, or a
 * path outside the upload directory. The upload route answers with exactly
 * /uploads/images/<uuid>.<sniffed ext> and nothing else can produce such a value, so the
 * check is an allowlist of that shape rather than a blocklist of known-bad ones.
 */
const UPLOADED_IMAGE_PATH = /^\/uploads\/images\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|jpeg|gif|webp)$/;

export function normalizeImageUrl(
  value: string | null | undefined,
): { ok: true; image_url: string | null } | { ok: false; error: string } {
  if (value == null || value === '') return { ok: true, image_url: null };
  if (UPLOADED_IMAGE_PATH.test(value)) return { ok: true, image_url: value };
  return {
    ok: false,
    error:
      'image_url must be a path returned by the image upload endpoint ' +
      '(/uploads/images/<id>.<png|jpg|jpeg|gif|webp>)',
  };
}

/**
 * The single ownership authority for a question. A doctor owns their private bank;
 * a TA owns only what they personally added to the shared subject bank.
 *
 * Deliberately no admin branch. Spec 9 grants question_bank.manage to doctor and ta
 * only and the router enforces that key, so an admin cannot reach this today. Refusing
 * keeps the dead path fail-closed: relaxing the router guard must never silently hand
 * an admin edit rights over every question in the bank.
 */
export function canEditQuestion(
  q: { owner_type: string; doctor_id: string | null; added_by_ta_id: string | null },
  userId: string,
  role: string,
): boolean {
  if (q.owner_type === 'doctor') return role === 'doctor' && q.doctor_id === userId;
  if (q.owner_type === 'ta_shared') return role === 'ta' && q.added_by_ta_id === userId;
  return false;
}

// ---------------------------------------------------------------------------
// List / Create
// ---------------------------------------------------------------------------

questionBankRouter.get('/', async (req, res, next) => {
  try {
    const subjectId = req.query.subject_id as string | undefined;
    const { userId, role } = req.auth!;

    // Checked before the manage gate, which is itself a query, and before findMany. A
    // malformed id is answered 404 like an unknown one, so the pair stays
    // indistinguishable to a caller guessing subject ids.
    if (subjectId !== undefined && !isUuid(subjectId)) {
      return res.status(404).json({ error: 'Subject not found' });
    }

    // Same gate the create, import and export routes already use, so asking for a
    // subject by id cannot read a bank the caller may not manage.
    if (subjectId && !(await canManageBank(userId, role, subjectId))) {
      return res.status(403).json({ error: 'You do not manage this subject' });
    }

    const ownerScope =
      role === 'doctor'
        ? { owner_type: 'doctor' as const, doctor_id: userId }
        : role === 'ta'
          ? { owner_type: 'ta_shared' as const }
          : {};

    const questions = await prisma.question.findMany({
      where: {
        ...(subjectId ? { subject_id: subjectId } : {}),
        is_archived: false,
        ...ownerScope,
        // Redundant once the gate above passes with a subject named, and deliberately so:
        // an unqualified request has no subject to check, and this is the only thing
        // stopping it from reading every shared bank in the university. It is the same
        // scoping buildScopedSubjectWhere already gives GET /subjects.
        subject: buildScopedSubjectWhere(role, userId),
      },
      select: {
        id: true,
        question_type: true,
        text: true,
        options: true,
        correct_answer: true,
        grade: true,
        difficulty: true,
        image_url: true,
        owner_type: true,
        created_at: true,
        // Ownership columns are read here to answer can_edit, and are then dropped from
        // the response. The relations carry the author a client needs to display; the
        // raw columns would only tempt it into re-deriving ownership on its own.
        doctor_id: true,
        added_by_ta_id: true,
        owner: { select: { id: true, full_name: true } },
        added_by_ta: { select: { id: true, full_name: true } },
      },
      orderBy: { created_at: 'desc' },
    });

    res.json({
      questions: questions.map((row) => {
        // Answered from the full row, before the ownership columns are dropped below.
        const can_edit = canEditQuestion(row, userId, role);
        // is_mine is what the TA quiz wizard's own_questions pool needs, and it is answered here rather
        // than in the browser because the browser cannot establish authorship: it would have to compare
        // author.id with the signed-in user, which is the second ownership authority this design refuses
        // to create. It matches exams.ts's own pool rule, so a picker filtered on it cannot 400.
        const is_mine =
          (row.owner_type === 'doctor' && row.doctor_id === userId)
          || (row.owner_type === 'ta_shared' && row.added_by_ta_id === userId);
        const { owner, added_by_ta, doctor_id: _doctorId, added_by_ta_id: _addedByTaId, ...question } = row;
        return {
          ...question,
          author: row.owner_type === 'doctor' ? owner : added_by_ta,
          can_edit,
          is_mine,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

questionBankRouter.get('/export', requirePermission('question_bank.export'), async (req, res, next) => {
  try {
    const query: unknown = req.query;
    const parsed = z.object({ subject_id: z.string().uuid() }).safeParse(query);
    // A malformed id is not "missing", so it does not get the missing-parameter message.
    if (!parsed.success) {
      const given = (req.query as { subject_id?: unknown }).subject_id;
      if (given === undefined) return res.status(400).json({ error: 'subject_id is required' });
      return res.status(404).json({ error: 'Subject not found' });
    }
    const subjectId = parsed.data.subject_id;
    const subject = await prisma.subject.findUnique({
      where: { id: subjectId },
      select: { code: true },
    });
    if (!subject) return res.status(404).json({ error: 'Subject not found' });

    const { userId, role } = req.auth!;
    const canManage = await canManageBank(userId, role, subjectId);
    if (!canManage) return res.status(403).json({ error: 'You do not manage this subject' });

    const workbook = await buildQuestionBankWorkbook(subjectId, userId, role);
    const filenameCode = subject.code.replace(/[^a-zA-Z0-9_-]/g, '_');
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="question-bank-${filenameCode}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
});

questionBankRouter.post('/', async (req, res, next) => {
  try {
    const parsed = questionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid question payload', details: parsed.error.flatten() });
    }
    const { subject_id, question_type, options, correct_answer, ...rest } = parsed.data;

    const answer = normalizeQuestionAnswer({ question_type, options, correct_answer });
    if (!answer.ok) {
      return res.status(400).json({ error: answer.error });
    }

    const image = normalizeImageUrl(rest.image_url);
    if (!image.ok) {
      return res.status(400).json({ error: image.error });
    }

    const ok = await canManageBank(req.auth!.userId, req.auth!.role, subject_id);
    if (!ok) {
      return res.status(403).json({ error: 'You do not manage this subject' });
    }

    const isDoctor = req.auth!.role === 'doctor';
    const question = await prisma.question.create({
      data: {
        subject_id,
        owner_type: isDoctor ? 'doctor' : 'ta_shared',
        doctor_id: isDoctor ? req.auth!.userId : null,
        added_by_ta_id: isDoctor ? null : req.auth!.userId,
        question_type,
        text: rest.text,
        options: options ?? [],
        correct_answer: answer.correct_answer,
        grade: rest.grade,
        difficulty: rest.difficulty,
        image_url: image.image_url,
      },
      select: { id: true, text: true, question_type: true, difficulty: true },
    });

    res.status(201).json({ question });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Patch / Delete (ownership enforced)
// ---------------------------------------------------------------------------

const patchQuestionSchema = questionSchema.partial().omit({ subject_id: true });

questionBankRouter.patch(
  '/:id',
  requireUuidParam('id', 'Question not found'),
  async (req, res, next) => {
  try {
    const existing = await prisma.question.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Question not found' });
    if (!canEditQuestion(existing, req.auth!.userId, req.auth!.role)) {
      return res.status(403).json({ error: 'You cannot edit this question' });
    }

    const parsed = patchQuestionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid question payload' });
    }

    const { question_type, options, correct_answer, ...rest } = parsed.data;
    const data: Record<string, unknown> = { ...rest };
    if (question_type) {
      data.question_type = question_type;
      data.options = undefined;
    }
    if (options) data.options = options;

    // Validate against the state the question will actually end up in, not against
    // just the fields this request sent. Only a patch that can change whether the
    // question is answerable needs checking, so a text-only edit on a legacy bad row
    // still goes through instead of being blocked.
    if (question_type || options || correct_answer) {
      const storedOptions = Array.isArray(existing.options)
        ? existing.options.filter((o): o is string => typeof o === 'string')
        : [];
      const answer = normalizeQuestionAnswer({
        question_type: question_type ?? existing.question_type,
        options: options ?? storedOptions,
        correct_answer: correct_answer ?? existing.correct_answer,
      });
      if (!answer.ok) {
        return res.status(400).json({ error: answer.error });
      }
      if (correct_answer) data.correct_answer = answer.correct_answer;
    }

    // Same allowlist as create. Only a patch that actually carries image_url is checked,
    // so a text-only edit to a question whose image was set by an older version still
    // goes through rather than being blocked on a field the author is not touching.
    if (parsed.data.image_url !== undefined) {
      const image = normalizeImageUrl(parsed.data.image_url);
      if (!image.ok) {
        return res.status(400).json({ error: image.error });
      }
      data.image_url = image.image_url;
    }

    const question = await prisma.question.update({
      where: { id: existing.id },
      data,
      select: { id: true, text: true, question_type: true, difficulty: true },
    });
    res.json({ question });
  } catch (err) {
    next(err);
  }
});

questionBankRouter.delete(
  '/:id',
  requireUuidParam('id', 'Question not found'),
  async (req, res, next) => {
  try {
    const existing = await prisma.question.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Question not found' });
    if (!canEditQuestion(existing, req.auth!.userId, req.auth!.role)) {
      return res.status(403).json({ error: 'You cannot delete this question' });
    }
    await prisma.question.update({
      where: { id: existing.id },
      data: { is_archived: true },
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Excel import (questions)
// ---------------------------------------------------------------------------

questionBankRouter.post('/import/dry-run', requirePermission('question_bank.import'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Excel file is required' });
    const report = await dryRunQuestionImport(req.file.buffer);
    res.json(report);
  } catch (err) {
    next(err);
  }
});

questionBankRouter.post('/import/commit', requirePermission('question_bank.import'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Excel file is required' });
    const body: unknown = req.body;
    const parsedBody = z.object({ subject_id: z.string().optional() }).safeParse(body);
    const subjectId = parsedBody.success ? parsedBody.data.subject_id ?? '' : '';
    if (!subjectId) return res.status(400).json({ error: 'subject_id is required' });

    const ok = await canManageBank(req.auth!.userId, req.auth!.role, subjectId);
    if (!ok) return res.status(403).json({ error: 'You do not manage this subject' });

    const isDoctor = req.auth!.role === 'doctor';
    const report = await commitQuestionImport({
      buffer: req.file.buffer,
      subjectId,
      doctorId: isDoctor ? req.auth!.userId : null,
      addedByTaId: isDoctor ? null : req.auth!.userId,
      ownerType: isDoctor ? 'doctor' : 'ta_shared',
      uploadedBy: req.auth!.userId,
      filename: req.file.originalname,
    });
    res.json(report);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Image attachment (manual question images)
// ---------------------------------------------------------------------------

questionBankRouter.post('/images', upload.single('image'), (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'image file is required' });

    // The bytes decide, never the client's declared type or filename. uploads/images is
    // served by an unauthenticated express.static mount, so a stored .html would be
    // text/html on the API origin and a stored .svg would execute script when navigated
    // to -- stored XSS reachable with no token.
    const sniffed = sniffImage(req.file.buffer);
    if (!sniffed) {
      return res.status(400).json({ error: 'Only PNG/JPEG/WEBP/GIF images are allowed' });
    }

    const name = `${crypto.randomUUID()}${sniffed.extension}`;
    fs.writeFileSync(path.join(uploadDir, name), req.file.buffer);

    res.status(201).json({ imageUrl: `/uploads/images/${name}` });
  } catch (err) {
    next(err);
  }
});
