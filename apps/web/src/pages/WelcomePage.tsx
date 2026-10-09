import { Fragment, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

type WelcomeLang = 'en' | 'ar';

const COPY: Record<WelcomeLang, {
  title: string;
  langButton: string;
  headline: string[];
  intro: string[];
  signIn: string;
  howItWorks: string;
  facts: [string, string, string];
  photoPlaceholder: string;
  roles: [{ title: string; body: string }, { title: string; body: string }, { title: string; body: string }];
}> = {
  en: {
    title: 'Exam Platform',
    langButton: 'العربية',
    headline: ['Exams,', 'quizzes and', 'results in one', 'place.'],
    intro: [
      'Sit the exams your doctors and TAs set, follow your results,',
      'and run your own exams if you teach. Sign in with your',
      'university account.',
    ],
    signIn: 'Sign in',
    howItWorks: 'How exams work',
    facts: ['Open since 1996', '13 undergraduate faculties', '6th of October City, Giza'],
    photoPlaceholder: 'Placeholder: add a campus photo here',
    roles: [
      { title: 'Students', body: 'See the exams open to you, enter your access code and submit before the timer ends.' },
      { title: 'Doctors and TAs', body: 'Build exams and quizzes, then watch them live as students sit them.' },
      { title: 'Admins', body: 'Approve exams, manage accounts and enrollment, and review results.' },
    ],
  },
  ar: {
    title: 'منصة الامتحانات',
    langButton: 'English',
    headline: ['الامتحانات والاختبارات والنتائج', 'في مكان واحد.'],
    intro: [
      'أدِّ الامتحانات التي يضعها أطباؤك ومعيدوك، وتابع نتائجك،',
      'وأنشئ امتحاناتك الخاصة إذا كنت تدرّس.',
      'سجّل الدخول بحسابك الجامعي.',
    ],
    signIn: 'تسجيل الدخول',
    howItWorks: 'كيف تعمل الامتحانات',
    facts: ['جامعة منذ 1996', '13 كلية لمرحلة البكالوريوس', 'مدينة 6 أكتوبر، الجيزة'],
    photoPlaceholder: 'موضع مؤقت: أضف صورة للحرم الجامعي هنا',
    roles: [
      { title: 'الطلاب', body: 'اطّلع على الامتحانات المتاحة لك، وأدخل رمز الدخول، وسلّم إجاباتك قبل انتهاء المؤقت.' },
      { title: 'الأطباء والمعيدون', body: 'أنشئ الامتحانات والاختبارات، ثم تابعها مباشرة أثناء أداء الطلاب لها.' },
      { title: 'المشرفون', body: 'اعتمد الامتحانات، وأدر الحسابات والقيد، وراجع النتائج.' },
    ],
  },
};

export function CampusArt({ withBackground = true }: { withBackground?: boolean }) {
  return (
    <svg viewBox="0 0 600 300" preserveAspectRatio="xMidYMid slice" role="img" aria-label="University illustration" className="absolute inset-0 h-full w-full">
      <defs>
        <linearGradient id="welcome-night" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1c2450" />
          <stop offset="1" stopColor="#3b4a86" />
        </linearGradient>
      </defs>
      {withBackground && <rect x="0" y="0" width="600" height="300" fill="url(#welcome-night)" />}
      <path d="M 230 130 A 70 70 0 0 1 370 130 Z" fill="#f2842f" />
      <path d="M 130 210 L 300 105 L 470 210 Z" fill="#dfe7f5" />
      {Array.from({ length: 13 }, (_, i) => (
        <rect key={i} x={140 + i * 26} y={218} width={16} height={14} fill="#6f8fd0" />
      ))}
    </svg>
  );
}

export function WelcomePage() {
  const [lang, setLang] = useState<WelcomeLang>('en');
  const navigate = useNavigate();
  const copy = COPY[lang];

  function goToHowItWorks() {
    void navigate('/how-it-works');
  }

  return (
    <div dir={lang === 'ar' ? 'rtl' : 'ltr'} className="grid min-h-screen lg:h-screen lg:grid-cols-[42%_58%] lg:overflow-hidden">
      <section className="flex flex-col bg-gradient-to-br from-[#252f63] to-[#161c42] px-8 py-7 text-white max-lg:min-h-[92vh] lg:h-screen lg:overflow-hidden lg:px-12">
        <div className="flex flex-wrap items-center gap-3">
          <img src="/o6u-logo.png" alt="October 6 University logo" className="h-11 w-auto rounded-[10px] bg-white px-2 py-1" />
          <span className="font-bold">{copy.title}</span>
          <button
            type="button"
            onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}
            className="ms-auto min-h-[40px] rounded-[9px] border border-white/50 px-4 font-semibold text-white hover:bg-white/10"
          >
            {copy.langButton}
          </button>
        </div>

        <div className="grid max-w-[540px] content-start gap-6 py-10 lg:my-auto lg:py-6">
          <h1 className="text-[2.6rem] font-extrabold leading-[1.18] lg:text-[3rem]">
            {copy.headline.map((line, index) => (
              <Fragment key={line}>
                {line}
                {index < copy.headline.length - 1 && <br />}
              </Fragment>
            ))}
          </h1>
          <p className="leading-[1.7] text-white/85">
            {copy.intro.map((line, index) => (
              <Fragment key={line}>
                {line}
                {index < copy.intro.length - 1 && <br />}
              </Fragment>
            ))}
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Link
              to="/login"
              className="inline-flex min-h-[48px] items-center rounded-[10px] bg-accent px-7 font-bold text-[#1a2148] hover:bg-accent-dark"
            >
              {copy.signIn}
            </Link>
            <button
              type="button"
              onClick={goToHowItWorks}
              className="inline-flex min-h-[48px] items-center rounded-[10px] border border-white/50 px-7 font-bold text-white hover:bg-white/10"
            >
              {copy.howItWorks}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-x-8 gap-y-2 text-[0.85rem] font-semibold text-white/80">
          {copy.facts.map((fact) => <span key={fact}>{fact}</span>)}
        </div>
      </section>

      <section className="grid content-start gap-4 bg-[#eef1f7] px-6 py-8 lg:h-screen lg:content-center lg:overflow-hidden lg:px-12 lg:py-8">
        <div className="relative h-[280px] overflow-hidden rounded-[18px] shadow-[0_12px_32px_rgb(36_52_80/18%)] lg:h-[min(36vh,330px)]">
          <CampusArt />
          <p className="absolute inset-x-0 bottom-0 px-5 pb-4 text-[0.8rem] font-normal text-white/75">{copy.photoPlaceholder}</p>
        </div>

        <div id="welcome-roles" className="grid gap-4 scroll-mt-6">
          {copy.roles.map((role) => (
            <article key={role.title} className="flex gap-3 rounded-[14px] border border-[#dfe5f0] bg-white px-5 py-3.5 shadow-[0_4px_14px_rgb(36_52_80/7%)]">
              <span aria-hidden="true" className="mt-1.5 h-2.5 w-2.5 flex-none rounded-full bg-accent" />
              <div className="grid gap-1">
                <h2 className="text-[1rem] font-bold text-primary-dark">{role.title}</h2>
                <p className="font-normal leading-relaxed text-muted">{role.body}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
