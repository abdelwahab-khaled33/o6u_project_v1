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
    express.static(path.resolve(process.cwd(), 'uploads'), {
      // Question images are read by students during an exam with no token, so the mount
      // itself is the last place a stored file can be neutralised. Only the four sniffed
      // image types may render, none of them may execute or embed, and nothing may be
      // treated as anything other than its own extension.
      setHeaders: (res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        res.setHeader('Content-Disposition', 'inline');
        res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
      },
    }),
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

  // Express's built-in 404 is an HTML page that embeds the requested path. Every other
  // response on this API is JSON, so a client that assumes JSON gets a parse error, and
  // the body reflects attacker-controlled text into whatever renders it. Placed after the
  // routers, so a real route still runs and a protected one still 401s.
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

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