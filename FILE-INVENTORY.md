# قائمة كل ملف في المشروع — غرضه من اسمه

**197 ملف متتبَّع في git** (منهم `.agents` و`.superpowers` و`docs`)، `node_modules` متجاهَل.
`git ls-files` — مش `find` — فالملفات اللي `git ls-files` مش بيلاقيها غير متتبَّعة أصلاً.

---

## الجذر — الإعداد والوثائق (19)

| الملف | الغرض |
|---|---|
| `package.json` | حزم الـ monorepo الستات، والسكربتات (`dev` / `build` / `lint` / `typecheck`) |
| `pnpm-workspace.yaml` | تصريح إن المشروع workspaces (وإنه بيستخدم pnpm مش npm) |
| `package-lock.json` |Versions مقفولة لكل dependency — reproducibility |
| `tsconfig.base.json` | إعدادات TypeScript المشتركة قبل أي package يورّث منها |
| `docker-compose.yml` | يشغّل PostgreSQL و Redis في بيئة التطوير — **بديل مش مستخدم على هذا الجهاز** |
| `.gitignore` | اللي ما بيتcommitش: `.env` ، `node_modules` ، مخرجات البناء |
| `.prettierrc.json` | قواعد تنسيق الكود |
| `.prettierignore` | الملفات اللي Prettier ما يلمسش (`.sql` ، `package-lock.json`) |
| `README.md` | صفحة المشروع على GitHub |
| `AGENTS.md` | **دليل الـ AI في هذا الريبو** — الـ business rules + الحالة الحالية |
| `MODELS.md` | نموذج الـ AI المستخدم + استراتيجية الميزانية (يُقرأ عند اختيار الموديل فقط) |
| `exam-platform-spec.md` | المواصفة التقنية الكاملة، مرقّمة بـ § |
| `exam-platform-prd.md` | متطلبات المنتج، مرقّمة بـ FR |
| `opencode.json` | إعدادات OpenCode (استيراد MCP، مش فيه API key) |
| `skills-lock.json` |_versions مثبّتة للـ skills المثبّتة |
| `scripts/dev-db-up.ps1` | **نقطة تشغيل Postgres الوحيدة**: تشغيل + انتظار + migrate status + فحص الصحة |
| `infra/DEPLOYMENT.md` | runbook النشر: عدد الـ processes، sizing، فخّ `max_connections` |
| `.agents/skills/agent-browser/SKILL.md` | نسخة `agent-browser` المكرّرة جوّه الريبو (**لا تستخدم** — الـ harness عنده `browser.*`) |
| `docs/superpowers/plans/2026-09-27-permission-system.md` | خطة نظام الـ permissions |
| `.superpowers/sdd/2026-09-27-permission-system/progress.md` | تقدّم تنفيذ تلك الخطة |

---

## `packages/shared` — الكود المشترك (3)

| الملف | الغرض |
|---|---|
| `package.json` | تعريف الحزمة `@exam/shared` (مصدر بدون build) |
| `tsconfig.json` | إعدادات TS للحزمة |
| `src/index.ts` | **مصدر الحقيقة الوحيد**: الأدوار، الـ enums، ومصفوفة الـ 18 صلاحية |

---

## `apps/api` — الـ backend (99)

### التشغيل والإعداد
| الملف | الغرض |
|---|---|
| `package.json` | تبعيات الـ API + سكربتات (`dev`, `test`, `exams:auto-submit-sweep`) |
| `.env.example` | نموذج متغيرات البيئة — **مفتاح تشفير access code كان ناقصًا فيه واتصلّح** |
| `eslint.config.js` | إعدادات ESLint للـ API (type-aware) |
| `tsconfig.json` / `tsconfig.build.json` | إعدادات TS؛ التانية **بتستثني ملفات الـ test** من الـ build |
| `vitest.config.ts` | إعداد Vitest |
| `prisma.config.ts` | إعداد Prisma 7 (قراءة `.env`، **مفيش مفتاح `prisma` في package.json**) |

### Prisma
| الملف | الغرض |
|---|---|
| `schema.prisma` | **مخطط الداتابيز كله**: 16 model + enums + `LoginThrottle` + `PasswordResetAudit` |
| `seed.ts` | البيانات الأولية: الأدوار الخمسة + الـ 72 صف صلاحيات |
| `migrations/migration_lock.toml` | نوع الـ provider — **نقص بعد إضافة migration يدوي** واتصلّح |
| `migrations/20260924000000_init/migration.sql` | الجداول الأساسية |
| `migrations/20260924010000_exams_module/migration.sql` | جداول الامتحانات والـ pool |
| `migrations/20260927000000_grade_adjustment_per_student/migration.sql` | تعويض الدرجات على مستوى الطالب الواحد |
| `migrations/20260928000000_student_exam_session/migration.sql` | جلسة الجهاز المرتبطة بمحاولة واحدة |
| `migrations/20260928083856_grade_adjustment_match_schema/migration.sql` | تصحيح انحراف نوع العمود (`TIMESTAMPTZ` → `TIMESTAMP(3)`) |
| `migrations/20260929000000_access_codes/migration.sql` | hash + ciphertext + انتهاء access code |
| `migrations/20260930000000_term_reset_permission/migration.sql` | صلاحية `term.reset` |
| `migrations/20260930010000_permission_matrix/migration.sql` | الـ 72 صف من مصفوفة الصلاحيات |
| `migrations/20260930020000_rate_limit_audit/migration.sql` | عدّادات الـ throttle + سجل تدقيق إعادة التعيين |

### نقطة الدخول والتهيئة
| الملف | الغرض |
|---|---|
| `src/index.ts` | نقطة تشغيل الـ HTTP server |
| `src/app.ts` | تركيب Express: middlewares + routers + 404 JSON + error handler |
| `src/config/env.ts` | قراءةEnv + **guards ما قبل الإنتاج** (JWT secret، مفتاح التشفير، trusted proxies) |
| `src/config/env.test.ts` | اختبارات الـ guards على مستوى الإقلاع الحقيقي |

### `lib` — أدوات صغيرة مشتركة
| الملف | الغرض |
|---|---|
| `lib/prisma.ts` | **singleton** عميل Prisma — كل الـ mocks في الاختبارات بتصيّب ده |
| `lib/jwt.ts` | توقيع وتحقق JWT |
| `lib/http-error.ts` | ترجمة أخطاء الـ service/Multer لـ status + رسالة (مفيش 500 كاذب) |
| `lib/cidr.ts` | تحليل ومقارنة شبكات CIDR (IPv4 + IPv6) |
| `lib/timing-safe.ts` | `safeEquals` بمقارنة ثابتة الزمن |
| `lib/uuid-param.ts` | حارس الـ `:id` غير(UUID) → 404 بدل 500 |

### `middleware`
| الملف | الغرض |
|---|---|
| `middleware/auth.ts` | `requireAuth` + `requireRoles` + `requirePermission` (وإعادة قراءة `is_active`/`role` كل طلب) |
| `middleware/lab-network.ts` | منع الامتحان خارج شبكة المعمل، مع احترام `X-Forwarded-For` للـ proxies الموثوقة |
| `middleware/seb.ts` | التحقق من hash تneseب الآمن — **اختباره مش متنفّذ لجهاز حقيقي (§6.2)** |

### `routes` — الـ HTTP
| الملف | الغرض |
|---|---|
| `routes/health.ts` | `GET /health` مع فحص اتصال حقيقي بالداتابيز |
| `routes/auth.ts` | تسجيل الدخول، `/me`، تغيير كلمة المرور، **والـ throttle** |
| `routes/admin.ts` | إدارة المستخدمين والمواد والأقسام والتسجيلات والصلاحيات و term reset |
| `routes/admin-exams.ts` | موافقة/رفض الامتحانات + تجديد access code (Admin) |
| `routes/exams.ts` | دورة حياة الامتحان للمالك: إنشاء، تعديل، حذف، القائمة، الـ live، الـ release، **resubmit** |
| `routes/student-exams.ts` | مسار الطالب: القائمة، البدء، الإجابة، العلامة، heartbeat، التسليم |
| `routes/questions.ts` | question bank + رفع الصور + استيراد/تصدير Excel |
| `routes/subjects.ts` | قائمة المواد + roster الأقسام والطلاب لكل مادة |
| `routes/sections.ts` | قائمة المقاطع محسوبة النطاق |
| `routes/results.ts` | النتائج لكل امتحان ولكل مادة |
| `routes/grade-adjustments.ts` | تعويض الدرجات + سجل التدقيق |

### `services` — منطق العمل
| الملف | الغرض |
|---|---|
| `services/permissions.ts` | حل الصلاحيات: override أولاً، والفارغ = false |
| `services/subject-access.ts` | **نطاق** المواد (doctor بالتعيين، TA بأقسامه، الطالب fail-closed) |
| `services/admin-management.ts` | قواعد Admin النقية: التسجيل، تعيين الـ doctor، منع قفل آخر admin |
| `services/exam-sampling.ts` | **عيّنة سؤال فريدة لكل طالب** حسب خليط الصعوبة + ترتيب مشوّش + snapshot |
| `services/exam-eligibility.ts` | مين من الطلاب مؤهَّل لامتحان |
| `services/exam-grading.ts` | التسليم النهائي والحساب التلقائي عند انقضاء الوقت |
| `services/exam-selects.ts` | الـ `select` الصريحة لامتحان — **مصدر تسريب الأسرار الوحيد لو غابت** |
| `services/access-code.ts` | توليد/تحقق/تشفير الـ access code (SHA-256 + AES-256-GCM) |
| `services/device-session.ts` | ربط المحاولة بعنوان IP + token |
| `services/login-throttle.ts` | **العدّادات الثلاثة مكتوبة يدويًا في Postgres** — صفر dependency |
| `services/results.ts` | تركيب النتائج + فحص الصلاحية + بوابة التوقيت |
| `services/results-export.ts` | تصدير xlsx بـ exceljs (ذاكره فقط، ما بيتخزّنش) |
| `services/grade-adjustment.ts` | تطبيق التعويض + الحساب المسبق + التدقيق |
| `services/questions-import.ts` | استيراد بنك الأسئلة من Excel |
| `services/questions-export.ts` | تصدير بنك الأسئلة لـ Excel |
| `services/excel.ts` | قراءة الـ xlsx + حدّ 5000 صف (منع انفجار الذاكرة من ضغط الـ zip) |
| `services/image-sniff.ts` | قرار نوع الصورة من **البايتات نفسها** (magic numbers) — لا filename ولا declared-type |
| `services/users-import.ts` | استيراد المستخدمين من Excel (dry-run + commit في transaction واحدة) |
| `services/random.ts` | مولّد عشوائي (اختيار العيّنة + access code) |
| `services/term-reset.ts` | حذف بيانات الفصل بترتيب يحترم الـ FKs |

### `scripts`
| الملف | الغرض |
|---|---|
| `src/scripts/auto-submit-sweep.ts` | مهمة ops: تسليم كل المحاولات المنتهية — **مفيش UI ليها عن قصد** |

### الاختبارات (36 ملف من الـ 99 `.test.ts`)
كل ملف `<X>.test.ts` جنب `<X>.ts` بيحاكي وحدته بـ Prisma mock — **ما بيحتاجش داتابيز**.
`app.test.ts` · `config/env.test.ts` · `lib/http-error` · `lib/timing-safe` · `middleware/auth` · `middleware/lab-network` · `middleware/seb` · `routes/admin-exams` · `routes/admin-last-admin` · `routes/admin-reset-password` · `routes/auth` · `routes/auth-throttle` · `routes/auth-change-password` · `routes/exams-resubmit` · `routes/grade-adjustments` · `routes/malformed-ids` · `routes/question-bank-list` · `routes/question-image-upload` · `routes/questions` · `routes/subject-roster` · `routes/uuid-params` · `services/access-code` · `services/admin-management` · `services/device-session` · `services/exam-sampling` · `services/exam-sampling-transaction` · `services/exam-selects` · `services/excel` · `services/image-sniff` · `services/login-throttle` · `services/permissions` · `services/questions-export` · `services/results` · `services/subject-access` · `services/term-reset` · `services/users-import`

---

## `apps/web` — الـ frontend (62)

### التهيئة
| الملف | الغرض |
|---|---|
| `package.json` | تبعيات React/Vite + سكربت `test` |
| `vite.config.ts` | dev server + **proxy لـ `/api`** (فـ CORS ما بتدخلش أصلاً) |
| `eslint.config.js` | إعدادات ESLint للويب |
| `tsconfig.json` | إعدادات TS |
| `index.html` | صفحة HTML الوحيدة |
| `src/main.tsx` | نقطة تركيب React |
| `src/index.css` | **كل تصميم المشروع**: الألوان `#455B8A`/`#F2842F` + كل الـ component classes |
| `src/App.tsx` | الراوتر: كل المسارات + حرّاس الأدوار |
| `src/lib/api.ts` | عميل `/api/v1` بـ token + `ApiError` (وليه `download` للفيديو مش JSON) |
| `src/lib/download.ts` | `saveBlob` لتنزيل ملف من الـ response |
| `src/hooks/useAuth.tsx` | سياق المصادقة |
| `src/components/Layout.tsx` | الهيكل العام (شريط علوي + محتوى) |
| `src/components/ui/Button.tsx` | زر بثلاثة أنماط |
| `src/components/ui/Card.tsx` | كارت |
| `src/components/ui/Field.tsx` | label + input/textarea/select مرتبطين |
| `src/components/ui/Alert.tsx` | رسالة (info / error / success) |
| `src/components/ui/Spinner.tsx` | مؤقّت تحميل |
| `src/components/ui/Table.tsx` | جدول |

### صفحات المصادقة
| الملف | الغرض |
|---|---|
| `pages/LoginPage.tsx` | تسجيل الدخول |
| `pages/ChangePasswordPage.tsx` | تغيير كلمة المرور (مع حالة "الطالب ما يقدرش") |

### `pages/admin` — 6 شاشات
| الملف | الغرض |
|---|---|
| `AdminLayout.tsx` | هيكل + nav الأدمن |
| `AdminUsersPage.tsx` | مستخدمون: بحث، paging، إنشاء، تفعيل، إعادة تعيين كلمة المرور |
| `AdminImportPage.tsx` | استيراد Excel: dry-run ثم commit لنفس الملف |
| `AdminSubjectsPage.tsx` | مواد |
| `AdminSectionsPage.tsx` | مقاطع |
| `AdminExamsPage.tsx` | موافقة/رفض امتحانات + quiz بتاع الـ TA |
| `AdminPermissionsPage.tsx` | مصفوفة 18 صلاحية × 4 أدوار + overrides |
| `AdminTermResetPage.tsx` | حذف بيانات الفصل (بعبارة تأكيد من السيرفر) |
| `adminShared.tsx` | أدوات مشتركة بين شاشات الأدمن |

### `pages/doctor`
| الملف | الغرض |
|---|---|
| `DoctorLayout.tsx` | هيكل + nav الدكتور |
| `DoctorExamsPage.tsx` | قائمة امتحاناته + الحالات |
| `ExamWizard.tsx` | معالج إنشاء/تعديل امتحان (5 أقسام) |
| `examWizardModel.ts` | منطق المعالج النقي (payload، ملاءمة الـ pool، التحويلات) |
| `doctorExamTypes.ts` | أنواع + نسخ الحالة + التواريخ |
| `DoctorQuestionBankPage.tsx` | بنك الأسئلة: قائمة، فلاتر، حذف، تصدير |
| `DoctorQuestionForm.tsx` | نموذج سؤال (MCQ + صح/خطأ) |

### `pages/ta`
| الملف | الغرض |
|---|---|
| `TaLayout.tsx` | هيكل + nav الـ TA |
| `TaQuizzesPage.tsx` | quizzy + كشف access code + جدول تقدّم |
| `TaQuizWizard.tsx` | معالج إنشاء/تعديل quiz |
| `TaQuestionBankPage.tsx` | البنك المشترك + عمود المؤلف + `can_edit` |
| `taQuizModel.ts` | منطق quiz النقي |

### `pages/student` — آخر ما في المنتج للمستخدم النهائي
| الملف | الغرض |
|---|---|
| `StudentExamsPage.tsx` | قائمة امتحانات الطالب + بوابة الـ access code |
| `StudentExamRunner.tsx` | **مشغّل الامتحان**: العدّاد، heartbeat، إجابة، علامات، تسليم |
| `studentExamModel.ts` | منطق المشغّل النقي (تصحيح الساعة، حالات الانتهاء) |

### `pages/results` / `compensation` / `monitoring`
| الملف | الغرض |
|---|---|
| `pages/results/ExamResultsPage.tsx` | نتائج امتحان واحد + تصدير |
| `pages/results/SubjectResultsPage.tsx` | النتائج مجمّعة لكل مادة |
| `pages/results/resultsModel.ts` / `resultsTypes.ts` | منطق + أنواع النتائج |
| `pages/compensation/ExamCompensationPage.tsx` | تعويض درجات بنطاق (الكل / محدد) |
| `pages/compensation/compensationModel.ts` / `compensationTypes.ts` | منطق + أنواع التعويض |
| `pages/monitoring/ExamAccessCodePage.tsx` | كشف الـ access code للمالك |
| `pages/monitoring/ExamLivePage.tsx` | مراقبة حيّة + **تحرير جلسة** طالب |
| `pages/monitoring/monitoringModel.ts` / `monitoringTypes.ts` | منطق + أنواع المراقبة |

### اختبارات الويب (7 من الـ 62)
`compensationModel.test.ts` · `doctorExamTypes.test.ts` · `examWizardModel.test.ts` · `monitoringModel.test.ts` · `resultsModel.test.ts` · `studentExamModel.test.ts` · `taQuizModel.test.ts`
> **الاصطلاح:** كل `*Model.ts` = منطق نقي بلا React، والاختبار جنبه بنفس الاسم. مفيش component tests — والسبب إن حكم الـ React بيحصل في browser حقيقي، مش في Vitest.

---

## `infra` — اختبار الحِمل والنشر (14)

| الملف | الغرض |
|---|---|
| `k6/README.md` | توثيق الـ suite + **اشتقاق الميزانيات من أرشيف التشغيلات** |
| `k6/lib/config.js` | إعدادات مشتركة (عدد الـ VUs، المهل، إعدادات SEB) |
| `k6/student-exam-path.js` | أي طالب (VU) بيمثّل |
| `k6/run.ps1` | تشغيل load test + **pre-flight للـ cohort window** (يرفض في ثانيتين) |
| `k6/run-cluster.ps1` | تشغيل عدة processes متوازية |
| `k6/start-api.ps1` | تشغيل نسخة API للاختبار |
| `k6/list-only.diagnostic.js` | **probe العزل**: بيسمع `exam_list` لوحده — ده اللي بProve إنه مش bottleneck |
| `k6/mint-tokens.mjs` | توقيع JWT بسر التطبيق عشان تشيل bcrypt من المسار المقيس |
| `k6/seed/seed.ps1` | زرع الـ fixture (3200 طالب) |
| `k6/seed/01-fixture.sql` | نفس الـ fixture بـ SQL |
| `k6/seed/reset-window.ps1` | إعادة تهيئة cohort منتهٍ (بترتيب FKs) |
| `k6/seed/fixture.json` | بيانات الـ fixture ( exam id + كود اصطناعي + كلمة مرور اصطناعية) |
| `k6/results/README.md` | سجل كل تشغيل + تصحيح ادّعاء خاطئ سابق |

---

## ملاحظتان

- **`.agents/skills/agent-browser/SKILL.md`** — نسخة من skill جوّه الريبو، بينما الـ harness عنده `browser.*` و`playwright.*` أصلاً. **متستخدموش.**
- **docs/superpowers/plans/** و**.superpowers/sdd/** — ناتج جلسة العمل عن الـ permissions، مش كود منتج.
