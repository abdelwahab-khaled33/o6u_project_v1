export const ROLES = ['admin', 'doctor', 'ta', 'student'] as const;
export type Role = (typeof ROLES)[number];

export const QUESTION_TYPES = ['mcq', 'true_false'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const OWNER_TYPES = ['doctor', 'ta_shared'] as const;
export type OwnerType = (typeof OWNER_TYPES)[number];

export const EXAM_TYPES = ['doctor_exam', 'ta_quiz'] as const;
export type ExamType = (typeof EXAM_TYPES)[number];

export const EXAM_STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'rejected',
  'locked',
  'closed',
] as const;
export type ExamStatus = (typeof EXAM_STATUSES)[number];

export const TARGET_SCOPES = ['subject', 'sections', 'student_list'] as const;
export type TargetScope = (typeof TARGET_SCOPES)[number];

export const QUIZ_SOURCES = ['shared_bank', 'own_questions'] as const;
export type QuizSource = (typeof QUIZ_SOURCES)[number];

export const STUDENT_EXAM_STATUSES = [
  'not_started',
  'in_progress',
  'submitted',
  'auto_submitted',
] as const;
export type StudentExamStatus = (typeof STUDENT_EXAM_STATUSES)[number];

export const IMPORT_TYPES = ['users', 'questions'] as const;
export type ImportType = (typeof IMPORT_TYPES)[number];

export type DifficultyMix = Record<Difficulty, number>;

export const PERMISSION_KEYS = [
  'users.manage',
  'subjects.manage',
  'permissions.manage',
  'exams.approve',
  'exams.manage_all',
  'exams.access_code.regenerate',
  'term.reset',
  'question_bank.manage',
  'question_bank.import',
  'question_bank.export',
  'exam.create',
  'quiz.create',
  'results.view',
  'results.export',
  'grades.adjust',
  'sessions.release',
  'exam.take',
  'password.change_own',
] as const;
export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export const ROLE_APPLICABLE_PERMISSIONS: Record<Role, readonly PermissionKey[]> = {
  admin: [
    'users.manage',
    'subjects.manage',
    'permissions.manage',
    'exams.approve',
    'exams.manage_all',
    'exams.access_code.regenerate',
    'term.reset',
    'results.view',
    'results.export',
    'grades.adjust',
    'sessions.release',
    'password.change_own',
  ],
  doctor: [
    'question_bank.manage',
    'question_bank.import',
    'question_bank.export',
    'exam.create',
    'results.view',
    'results.export',
    'grades.adjust',
    'sessions.release',
    'password.change_own',
  ],
  ta: [
    'question_bank.manage',
    'question_bank.import',
    'question_bank.export',
    'quiz.create',
    'results.view',
    'results.export',
    'sessions.release',
    'password.change_own',
  ],
  student: ['exam.take'],
};

export const DEFAULT_PERMISSIONS: Record<PermissionKey, readonly Role[]> = {
  'users.manage': ['admin'],
  'subjects.manage': ['admin'],
  'permissions.manage': ['admin'],
  'exams.approve': ['admin'],
  'exams.manage_all': ['admin'],
  'exams.access_code.regenerate': ['admin'],
  'term.reset': ['admin'],
  'question_bank.manage': ['doctor', 'ta'],
  'question_bank.import': ['doctor', 'ta'],
  'question_bank.export': ['doctor', 'ta'],
  'exam.create': ['doctor'],
  'quiz.create': ['ta'],
  'results.view': ['admin', 'doctor', 'ta'],
  'results.export': ['admin', 'doctor', 'ta'],
  'grades.adjust': ['admin', 'doctor'],
  'sessions.release': ['admin', 'doctor', 'ta'],
  'exam.take': ['student'],
  'password.change_own': ['admin', 'doctor', 'ta'],
};

export const ADJUSTMENT_TYPES = ['full_credit', 'set_points'] as const;
export type AdjustmentType = (typeof ADJUSTMENT_TYPES)[number];
