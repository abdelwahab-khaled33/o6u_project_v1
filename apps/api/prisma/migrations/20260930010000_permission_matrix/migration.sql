INSERT INTO "Permission" ("id", "role", "permission_key", "allowed")
SELECT gen_random_uuid(), roles.role, permissions.permission_key, roles.role = ANY (permissions.default_roles)
FROM (
  VALUES
    ('admin'::"Role"),
    ('doctor'::"Role"),
    ('ta'::"Role"),
    ('student'::"Role")
) AS roles(role)
CROSS JOIN (
  VALUES
    ('users.manage', ARRAY['admin'::"Role"]),
    ('subjects.manage', ARRAY['admin'::"Role"]),
    ('permissions.manage', ARRAY['admin'::"Role"]),
    ('exams.approve', ARRAY['admin'::"Role"]),
    ('exams.manage_all', ARRAY['admin'::"Role"]),
    ('exams.access_code.regenerate', ARRAY['admin'::"Role"]),
    ('term.reset', ARRAY['admin'::"Role"]),
    ('question_bank.manage', ARRAY['doctor'::"Role", 'ta'::"Role"]),
    ('question_bank.import', ARRAY['doctor'::"Role", 'ta'::"Role"]),
    ('question_bank.export', ARRAY['doctor'::"Role", 'ta'::"Role"]),
    ('exam.create', ARRAY['doctor'::"Role"]),
    ('quiz.create', ARRAY['ta'::"Role"]),
    ('results.view', ARRAY['admin'::"Role", 'doctor'::"Role", 'ta'::"Role"]),
    ('results.export', ARRAY['admin'::"Role", 'doctor'::"Role", 'ta'::"Role"]),
    ('grades.adjust', ARRAY['admin'::"Role", 'doctor'::"Role"]),
    ('sessions.release', ARRAY['admin'::"Role", 'doctor'::"Role", 'ta'::"Role"]),
    ('exam.take', ARRAY['student'::"Role"]),
    ('password.change_own', ARRAY['admin'::"Role", 'doctor'::"Role", 'ta'::"Role"])
) AS permissions(permission_key, default_roles)
ON CONFLICT ("role", "permission_key") DO UPDATE SET "allowed" = EXCLUDED."allowed";
