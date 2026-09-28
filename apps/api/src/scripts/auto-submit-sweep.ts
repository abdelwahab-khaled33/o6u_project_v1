import '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { autoSubmitExpiredExams } from '../services/exam-grading.js';

autoSubmitExpiredExams()
  .then((result) => {
    console.log(`Auto-submitted ${result.finalized} expired exam attempt(s).`);
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
