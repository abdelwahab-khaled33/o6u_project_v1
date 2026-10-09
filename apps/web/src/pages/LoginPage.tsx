import { Fragment, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Field, Input } from '../components/ui/Field';
import { CampusArt } from './WelcomePage';

type LoginLang = 'en' | 'ar';

const COPY: Record<LoginLang, {
  title: string;
  langButton: string;
  artHeadline: [string, string];
  footer: string;
  signIn: string;
  tagline: string;
  username: string;
  password: string;
  show: string;
  hide: string;
  submit: string;
  submitting: string;
  forgot: string;
}> = {
  en: {
    title: 'Exam Platform',
    langButton: 'العربية',
    artHeadline: ['Ready when your', 'exam opens.'],
    footer: 'October 6 University',
    signIn: 'Sign in',
    tagline: 'Use the username your university gave you.',
    username: 'Username',
    password: 'Password',
    show: 'Show',
    hide: 'Hide',
    submit: 'Sign in',
    submitting: 'Signing in…',
    forgot: 'Forgot your password? Ask your administrator to reset it.',
  },
  ar: {
    title: 'منصة الامتحانات',
    langButton: 'English',
    artHeadline: ['جاهز عندما يبدأ', 'امتحانك.'],
    footer: 'جامعة 6 أكتوبر',
    signIn: 'تسجيل الدخول',
    tagline: 'استخدم اسم المستخدم الذي منحته لك الجامعة.',
    username: 'اسم المستخدم',
    password: 'كلمة المرور',
    show: 'إظهار',
    hide: 'إخفاء',
    submit: 'تسجيل الدخول',
    submitting: 'جارٍ تسجيل الدخول…',
    forgot: 'نسيت كلمة المرور؟ اطلب من المشرف إعادة تعيينها.',
  },
};

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [lang, setLang] = useState<LoginLang>('en');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const copy = COPY[lang];

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(username, password);
      void navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div dir={lang === 'ar' ? 'rtl' : 'ltr'} className="grid min-h-screen lg:h-screen lg:grid-cols-[42%_58%] lg:overflow-hidden">
      <section className="flex flex-col bg-gradient-to-br from-[#252f63] to-[#161c42] px-8 py-7 text-white max-lg:min-h-[70vh] lg:h-screen lg:overflow-hidden lg:px-12">
        <div className="flex flex-wrap items-center gap-3">
          <img src="/o6u-logo.png" alt="October 6 University logo" className="h-11 w-auto rounded-[10px] bg-white px-2 py-1" />
          <span className="font-bold">{copy.title}</span>
        </div>

        <div className="grid max-w-[460px] content-start gap-7 py-10 lg:my-auto lg:py-6">
          <div className="relative aspect-[2/1] w-full overflow-hidden">
            <CampusArt withBackground={false} />
          </div>
          <p className="text-[1.6rem] font-bold leading-[1.3]">
            {copy.artHeadline.map((line, index) => (
              <Fragment key={line}>
                {line}
                {index < copy.artHeadline.length - 1 && <br />}
              </Fragment>
            ))}
          </p>
        </div>

        <div className="text-[0.85rem] font-semibold text-white/80">{copy.footer}</div>
      </section>

      <section className="relative grid place-items-center bg-[#eef1f7] px-6 py-10 lg:h-screen lg:overflow-hidden">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(420px_300px_at_85%_90%,rgb(242_132_47/14%),transparent_70%)]" />
        <button
          type="button"
          onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}
          className="absolute end-8 top-7 min-h-[40px] rounded-[9px] border border-[#b9c4d8] bg-white px-4 font-semibold text-primary-dark hover:bg-[#eef3fb]"
        >
          {copy.langButton}
        </button>

        <form onSubmit={handleSubmit} autoComplete="off" className="relative grid w-full max-w-[410px] gap-[16px] rounded-2xl border border-[#e8edf3] border-t-4 border-t-accent bg-white p-8 shadow-[0_16px_40px_rgb(36_52_80/12%)]">
          <div className="grid gap-1.5">
            <img src="/o6u-mark.png" alt="October 6 University mark" className="h-12 w-auto" />
            <h1 className="text-[1.4rem] font-bold text-primary-dark">{copy.signIn}</h1>
            <p className="text-[0.9rem] font-normal text-muted">{copy.tagline}</p>
          </div>
          <Field label={copy.username} htmlFor="username">
            <Input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
              required
            />
          </Field>
          <Field label={copy.password} htmlFor="password">
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                className="pe-16"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? copy.hide : copy.show}
                aria-pressed={showPassword}
                className="absolute end-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-[0.85rem] font-semibold text-primary-dark hover:text-primary"
              >
                {showPassword ? copy.hide : copy.show}
              </button>
            </div>
          </Field>
          {error && <Alert>{error}</Alert>}
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? copy.submitting : copy.submit}
          </Button>
          <p className="text-[0.82rem] font-normal leading-relaxed text-muted">{copy.forgot}</p>
        </form>
      </section>
    </div>
  );
}
