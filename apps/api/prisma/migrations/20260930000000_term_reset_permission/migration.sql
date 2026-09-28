INSERT INTO "Permission" ("id", "role", "permission_key", "allowed")
VALUES
  ('a01a11f1-6fd7-43e3-9af7-6af339451f01', 'admin', 'term.reset', true),
  ('a01a11f1-6fd7-43e3-9af7-6af339451f02', 'doctor', 'term.reset', true),
  ('a01a11f1-6fd7-43e3-9af7-6af339451f03', 'ta', 'term.reset', true),
  ('a01a11f1-6fd7-43e3-9af7-6af339451f04', 'student', 'term.reset', true)
ON CONFLICT ("role", "permission_key") DO UPDATE SET "allowed" = true;
