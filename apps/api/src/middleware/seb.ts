import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';

function computeRequestUrl(req: Request): string {
  const host = req.get('host') ?? '';
  return `${req.protocol}://${host}${req.originalUrl}`;
}

function hashMatches(url: string, header: string): boolean {
  return env.sebKeys.some((key) => {
    const expected = crypto.createHash('sha256').update(url + key).digest('hex');
    return expected === header;
  });
}

export async function requireSeb(req: Request, res: Response, next: NextFunction) {
  try {
    const examId = req.params.examId;
    if (examId) {
      const exam = await prisma.exam.findUnique({
        where: { id: examId },
        select: { type: true },
      });
      if (exam && exam.type !== 'doctor_exam') {
        return next();
      }
    }

    if (env.sebKeys.length === 0) {
      if (env.nodeEnv === 'production') {
        return res.status(500).json({ error: 'SEB_KEYS is not configured' });
      }
      return next();
    }

    const header = req.header('X-SafeExamBrowser-RequestHash');
    if (!header) {
      return res.status(403).json({
        error: 'SEB_REQUIRED',
        message: 'Please open this exam from Safe Exam Browser',
      });
    }

    const url = computeRequestUrl(req);
    if (!hashMatches(url, header)) {
      return res.status(403).json({
        error: 'SEB_REQUIRED',
        message: 'Please open this exam from Safe Exam Browser',
      });
    }

    next();
  } catch (err) {
    next(err);
  }
}
