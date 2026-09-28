import { readFirstSheet } from './excel.js';
import bcrypt from 'bcryptjs';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import type { Role } from '@exam/shared';

interface ParsedUserRow {
  username: string;
  password: string;
  fullName: string;
  role: Role;
  studentCode: string | null;
  subjectCodes: string[];
  taAssignments: { subjectCode: string; sectionNames: string[] }[];
  rawRow: number;
}

export type ImportRowError = {
  row: number;
  reason: string;
};

export interface UserImportReport {
  total: number;
  valid: number;
  errorCount: number;
  errors: ImportRowError[];
}

type SubjectsByCode = Map<string, string>;

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseTaAssignments(raw: string): { subjectCode: string; sectionNames: string[] }[] {
  return raw
    .split(';')
    .map((group) => group.trim())
    .filter(Boolean)
    .map((group) => {
      const [code, namesPart] = group.split(':').map((s) => s.trim());
      return {
        subjectCode: code ?? '',
        sectionNames: splitList(namesPart ?? ''),
      };
    })
    .filter((a) => a.subjectCode && a.sectionNames.length > 0);
}

function parseRows(
  raw: { cells: Record<string, string>; rowNumber: number }[],
  subjects: SubjectsByCode,
): { rows: ParsedUserRow[]; errors: ImportRowError[]; seen: Set<string> } {
  const rows: ParsedUserRow[] = [];
  const errors: ImportRowError[] = [];
  const seen = new Set<string>();

  for (const rawRow of raw) {
    const reason = validateRow(rawRow.cells, subjects, seen);
    const username = rawRow.cells.Username ?? '';
    seen.add(username.toLowerCase());

    if (reason) {
      errors.push({ row: rawRow.rowNumber, reason });
      continue;
    }

    const role = (rawRow.cells.Role ?? '').toLowerCase() as Role;
    const subjectsRaw = rawRow.cells.Subjects ?? '';

    rows.push({
      username,
      password: rawRow.cells.Password ?? '',
      fullName: rawRow.cells['Full Name'] ?? rawRow.cells.full_name ?? '',
      role,
      studentCode: rawRow.cells['Student Code'] ?? rawRow.cells.student_code ?? null,
      subjectCodes: splitList(subjectsRaw),
      taAssignments:
        role === 'ta' ? parseTaAssignments(rawRow.cells.Sections ?? '') : [],
      rawRow: rawRow.rowNumber,
    });
  }

  return { rows, errors, seen };
}

function validateRow(
  cells: Record<string, string>,
  subjects: SubjectsByCode,
  seen: Set<string>,
): string | null {
  const username = cells.Username ?? cells.username ?? '';
  const password = cells.Password ?? cells.password ?? '';
  const fullName = cells['Full Name'] ?? cells.full_name ?? '';
  const roleRaw = (cells.Role ?? cells.role ?? '').toLowerCase();
  const studentCode = cells['Student Code'] ?? cells.student_code ?? '';

  if (!username) return 'Missing username';
  if (seen.has(username.toLowerCase())) return 'Duplicate username within file';
  if (username.length < 3) return 'Username too short';
  if (!password) return 'Missing password';
  if (password.length < 6) return 'Password too short (min 6)';
  if (!fullName) return 'Missing full name';
  if (!['doctor', 'ta', 'student'].includes(roleRaw)) {
    return `Invalid role: "${roleRaw}" (expected doctor, ta, or student)`;
  }
  if (roleRaw === 'student' && !studentCode) return 'Missing student code for student';

  const subjectCodes = splitList(cells.Subjects ?? cells.subjects ?? '');
  if (subjectCodes.length === 0) {
    return 'No subjects listed';
  }
  for (const code of subjectCodes) {
    if (!subjects.has(code)) {
      return `Unknown subject code: "${code}"`;
    }
  }

  if (roleRaw === 'ta') {
    const assignments = parseTaAssignments(cells.Sections ?? cells.sections ?? '');
    if (assignments.length === 0) return 'Missing section assignments for TA';
    for (const a of assignments) {
      if (!subjects.has(a.subjectCode)) {
        return `Unknown subject code in Sections: "${a.subjectCode}"`;
      }
    }
  }

  return null;
}

export async function dryRunUserImport(
  buffer: Buffer,
): Promise<UserImportReport> {
  const { rows } = await readFirstSheet(buffer);
  const allSubjects = await prisma.subject.findMany({ select: { id: true, code: true } });
  const subjects = new Map(allSubjects.map((s) => [s.code, s.id]));

  const parsed = parseRows(rows, subjects);
  return {
    total: rows.length,
    valid: parsed.rows.length,
    errorCount: parsed.errors.length,
    errors: parsed.errors,
  };
}

export async function commitUserImport(
  buffer: Buffer,
  adminId: string,
  filename: string,
): Promise<UserImportReport> {
  const { rows } = await readFirstSheet(buffer);
  const allSubjects = await prisma.subject.findMany({ select: { id: true, code: true } });
  const subjects = new Map(allSubjects.map((s) => [s.code, s.id]));

  const parsed = parseRows(rows, subjects);

  for (const row of parsed.rows) {
    const passwordHash = await bcrypt.hash(row.password, 10);

    await prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { username: row.username },
        update: {
          password_hash: passwordHash,
          full_name: row.fullName,
          role: row.role,
          is_active: true,
          ...(row.role === 'student' ? { student_code: row.studentCode } : {}),
          ...(row.role === 'student'
            ? {}
            : { student_code: null as string | null }),
        },
        create: {
          username: row.username,
          password_hash: passwordHash,
          full_name: row.fullName,
          role: row.role,
          can_change_password: row.role !== 'student',
          student_code: row.role === 'student' ? row.studentCode : null,
        },
      });

      if (row.role === 'student') {
        const subjectIds = row.subjectCodes.map((c) => subjects.get(c)!);
        const existing = await tx.enrollment.findMany({
          where: { student_id: user.id },
          select: { subject_id: true },
        });
        const existingIds = new Set(existing.map((e) => e.subject_id));
        for (const sid of subjectIds) {
          if (!existingIds.has(sid)) {
            await tx.enrollment.create({ data: { student_id: user.id, subject_id: sid } });
          }
        }
        await tx.sectionMembership.deleteMany({ where: { student_id: user.id } });
      } else if (row.role === 'doctor') {
        const subjectIds = row.subjectCodes.map((c) => subjects.get(c)!);
        const existing = await tx.doctorAssignment.findMany({
          where: { doctor_id: user.id },
          select: { subject_id: true },
        });
        const existingIds = new Set(existing.map((e) => e.subject_id));
        for (const sid of subjectIds) {
          if (!existingIds.has(sid)) {
            await tx.doctorAssignment.create({ data: { doctor_id: user.id, subject_id: sid } });
          }
        }
      } else if (row.role === 'ta') {
        for (const assignment of row.taAssignments) {
          const subjectId = subjects.get(assignment.subjectCode)!;
          for (const name of assignment.sectionNames) {
            await tx.section.upsert({
              where: {
                subject_id_ta_id_name: {
                  subject_id: subjectId,
                  ta_id: user.id,
                  name,
                },
              },
              update: {},
              create: {
                subject_id: subjectId,
                ta_id: user.id,
                name,
              },
            });
          }
        }
      }
    });
  }

  if (parsed.rows.length > 0) {
    const mappedErrors = parsed.errors.map((e) => ({ row: e.row, reason: e.reason }));
    const errorReport: Prisma.InputJsonValue | undefined =
      parsed.errors.length > 0 ? { errors: mappedErrors } : undefined;
    await prisma.excelImportLog.create({
      data: {
        import_type: 'users',
        uploaded_by: adminId,
        filename,
        total_rows: rows.length,
        imported_count: parsed.rows.length,
        error_count: parsed.errors.length,
        error_report: errorReport,
      },
    });
  }

  return {
    total: rows.length,
    valid: parsed.rows.length,
    errorCount: parsed.errors.length,
    errors: parsed.errors,
  };
}