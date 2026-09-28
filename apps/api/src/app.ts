import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'node:path';
import { env } from './config/env.js';
import { resolveErrorResponse } from './lib/http-error.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { adminRouter } from './routes/admin.js';
import { adminExamsRouter } from './routes/admin-exams.js';
import { questionBankRouter } from './routes/questions.js';
import { subjectsRouter } from './routes/subjects.js';
import { sectionsRouter } from './routes/sections.js';
import { examsRouter } from './routes/exams.js';
import { studentExamsRouter } from './routes/student-exams.js';
import { resultsRouter } from './routes/results.js';
import { gradeAdjustmentsRouter } from './routes/grade-adjustments.js';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: env.corsOrigin.split(',').map((o) => o.trim()),
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  app.use(
    '/uploads',
    express.static(path.resolve(process.cwd(), 'uploads')),
  );

  app.use('/api/v1/health', healthRouter);
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/admin', adminRouter);
  app.use('/api/v1/admin', adminExamsRouter);
  app.use('/api/v1/question-bank', questionBankRouter);
  app.use('/api/v1/subjects', subjectsRouter);
  app.use('/api/v1/sections', sectionsRouter);
  app.use('/api/v1/exams', examsRouter);
  app.use('/api/v1/student/exams', studentExamsRouter);
  app.use('/api/v1/results', resultsRouter);
  app.use('/api/v1/grade-adjustments', gradeAdjustmentsRouter);

  app.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const { status, body } = resolveErrorResponse(err);
      if (status >= 500) {
        console.error('Unhandled error:', err);
      }
      res.status(status).json(body);
    },
  );

  return app;
}