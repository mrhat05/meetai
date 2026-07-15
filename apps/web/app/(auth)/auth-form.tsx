"use client";

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LuVideo, LuSparkles, LuUsers, LuShieldCheck, LuArrowRight } from 'react-icons/lu';
import api from '@/lib/api';

const AUTH_HIGHLIGHTS = [
  { Icon: LuVideo, title: 'One-click rooms', body: 'Start HD video meetings and share an invite link instantly.' },
  { Icon: LuSparkles, title: 'AI minutes', body: 'Every meeting is transcribed and summarized automatically.' },
  { Icon: LuUsers, title: 'Organized groups', body: 'Keep your teams, roles, and history neatly in one place.' },
];

type AuthMode = 'login' | 'register';

type AuthFormProps = {
  mode: AuthMode;
};

type AuthResponse = {
  accessToken: string;
  refreshToken: string;
  user?: {
    id: string;
    email: string;
    displayName: string;
    avatarUrl: string | null;
    bio: string | null;
    phoneNumber: string | null;
    location: string | null;
  };
};

type OtpResponse = {
  message: string;
  expiresInSeconds: number;
};

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const [, payload] = token.split('.');
    if (!payload) return null;

    const normalizedPayload = payload.replace(/-/g, '+').replace(/_/g, '/');
    const paddedPayload = normalizedPayload.padEnd(Math.ceil(normalizedPayload.length / 4) * 4, '=');

    return JSON.parse(window.atob(paddedPayload)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export default function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [otp, setOtp] = useState('');
  const [registrationStep, setRegistrationStep] = useState<'details' | 'otp'>('details');
  const [otpNotice, setOtpNotice] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const isRegister = mode === 'register';

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      if (isRegister && registrationStep === 'details') {
        const { data } = await api.post<OtpResponse>('/auth/register/request-otp', {
          email,
          password,
          display_name: displayName || undefined,
        });

        setOtpNotice(data.message || `We sent a 6-digit code to ${email}.`);
        setRegistrationStep('otp');
        return;
      }

      if (isRegister && registrationStep === 'otp') {
        const { data } = await api.post<AuthResponse>('/auth/register/verify-otp', {
          email,
          otp,
        });

        window.localStorage.setItem('accessToken', data.accessToken);
        // Let the shared realtime socket re-connect with the new identity so
        // meeting alerts start arriving without a page reload.
        window.dispatchEvent(new Event('meetai:auth'));

        const decodedPayload = decodeJwtPayload(data.accessToken);
        const resolvedDisplayName =
          (typeof decodedPayload?.displayName === 'string' && decodedPayload.displayName.trim()) ||
          (displayName.trim() || '') ||
          (typeof decodedPayload?.email === 'string' ? decodedPayload.email.split('@')[0] : '') ||
          'You';

        window.localStorage.setItem('displayName', resolvedDisplayName);
        window.localStorage.setItem('userName', resolvedDisplayName);
        if (typeof decodedPayload?.email === 'string' && decodedPayload.email.trim()) {
          window.localStorage.setItem('userEmail', decodedPayload.email);
        }
        if (data.user?.avatarUrl) {
          window.localStorage.setItem('avatarUrl', data.user.avatarUrl);
        }

        router.push('/dashboard');
        return;
      }

      const endpoint = isRegister ? '/auth/register' : '/auth/login';
      const payload = isRegister
        ? { email, password, display_name: displayName || undefined }
        : { email, password };

      const { data } = await api.post<AuthResponse>(endpoint, payload);

      window.localStorage.setItem('accessToken', data.accessToken);
      // Let the shared realtime socket re-connect with the new identity so
      // meeting alerts start arriving without a page reload.
      window.dispatchEvent(new Event('meetai:auth'));

      const decodedPayload = decodeJwtPayload(data.accessToken);
      const resolvedDisplayName =
        (typeof decodedPayload?.displayName === 'string' && decodedPayload.displayName.trim()) ||
        (isRegister ? displayName.trim() : '') ||
        (typeof decodedPayload?.email === 'string' ? decodedPayload.email.split('@')[0] : '') ||
        'You';

      window.localStorage.setItem('displayName', resolvedDisplayName);
      window.localStorage.setItem('userName', resolvedDisplayName);
      if (typeof decodedPayload?.email === 'string' && decodedPayload.email.trim()) {
        window.localStorage.setItem('userEmail', decodedPayload.email);
      }
      if (data.user?.avatarUrl) {
        window.localStorage.setItem('avatarUrl', data.user.avatarUrl);
      }

      router.push('/dashboard');
    } catch (submissionError: any) {
      const status = submissionError?.response?.status;
      const message =
        status === 404 && !isRegister
          ? 'No account found with that email.'
          : submissionError?.response?.data?.error ?? 'Something went wrong';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden app-root px-4 py-10 sm:px-6">
      <div className="mx-auto w-full max-w-5xl">
        <div className="card card-hero animate-fade-up grid w-full overflow-hidden md:grid-cols-[1.05fr_0.95fr]">
          {/* Brand panel */}
          <div className="relative hidden flex-col justify-between gap-10 overflow-hidden p-10 md:flex">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
              style={{ background: 'radial-gradient(30rem 24rem at 0% 0%, rgba(124,108,246,0.22), transparent 60%), radial-gradient(24rem 20rem at 100% 100%, rgba(52,211,193,0.14), transparent 60%)' }}
            />
            <div className="relative">
              <div className="flex items-center gap-3">
                <span className="brand-mark text-lg">M</span>
                <span className="font-display text-lg font-semibold tracking-tight">MeetAI</span>
              </div>
              <h1 className="mt-8 max-w-md font-display text-[2.6rem] font-semibold leading-[1.1] tracking-tight">
                {isRegister ? (
                  <>Create your <span className="gradient-text">workspace</span> and start collaborating.</>
                ) : (
                  <>Welcome back to <span className="gradient-text">MeetAI</span>.</>
                )}
              </h1>
              <p className="mt-4 max-w-sm text-base leading-7 muted">
                Meetings, groups, and AI-generated minutes — calmly organized in one place.
              </p>
            </div>

            <ul className="relative space-y-4">
              {AUTH_HIGHLIGHTS.map(({ Icon, title, body }) => (
                <li key={title} className="flex items-start gap-3.5">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-white/5 text-[var(--accent)]">
                    <Icon aria-hidden="true" />
                  </span>
                  <div>
                    <p className="font-medium text-white">{title}</p>
                    <p className="text-sm leading-6 muted">{body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Form panel */}
          <div className="bg-[rgba(6,9,18,0.35)] px-6 py-10 sm:px-10 sm:py-12">
            <div className="mx-auto max-w-md">
              {/* Mobile brand */}
              <div className="mb-8 flex items-center gap-3 md:hidden">
                <span className="brand-mark text-lg">M</span>
                <span className="font-display text-lg font-semibold tracking-tight">MeetAI</span>
              </div>

              <div className="mb-7">
                <p className="eyebrow" style={{ color: 'var(--primary)' }}>
                  {isRegister ? 'Create account' : 'Sign in'}
                </p>
                <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight">
                  {isRegister ? 'Make a new account' : 'Log in to your account'}
                </h2>
                <p className="mt-3 text-sm leading-6 muted">
                  {isRegister
                    ? registrationStep === 'details'
                      ? 'Enter your details and we’ll send a verification code.'
                      : 'Enter the code we sent to finish creating your account.'
                    : 'Enter your credentials and we’ll sign you in.'}
                </p>
              </div>

              {isRegister && (
                <div className="mb-6 flex items-center gap-2 text-xs font-medium">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${registrationStep === 'details' ? 'bg-[rgba(124,108,246,0.16)] text-[var(--primary)]' : 'text-faint'}`}>
                    <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${registrationStep === 'details' ? 'bg-[var(--primary)] text-white' : 'bg-white/10 text-white/70'}`}>1</span>
                    Details
                  </span>
                  <span className="h-px w-5 bg-[var(--border-strong)]" />
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${registrationStep === 'otp' ? 'bg-[rgba(124,108,246,0.16)] text-[var(--primary)]' : 'text-faint'}`}>
                    <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${registrationStep === 'otp' ? 'bg-[var(--primary)] text-white' : 'bg-white/10 text-white/70'}`}>2</span>
                    Verify
                  </span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">
                {isRegister && registrationStep === 'details' && (
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium muted">Display name</span>
                    <input
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                      type="text"
                      placeholder="Alex Morgan"
                      className="auth-input"
                    />
                  </label>
                )}

                {isRegister && registrationStep === 'otp' && (
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium muted">Verification code</span>
                    <input
                      value={otp}
                      onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
                      type="text"
                      inputMode="numeric"
                      placeholder="123456"
                      maxLength={6}
                      className="auth-input text-center font-mono text-lg tracking-[0.5em]"
                      required
                    />
                  </label>
                )}

                {! (isRegister && registrationStep === 'otp') && (
                  <>
                    <label className="block">
                      <span className="mb-2 block text-sm font-medium muted">Email</span>
                      <input
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        type="email"
                        placeholder="you@example.com"
                        className="auth-input"
                        required
                      />
                    </label>

                    <label className="block">
                      <span className="mb-2 block text-sm font-medium muted">Password</span>
                      <input
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        type="password"
                        placeholder="••••••••"
                        className="auth-input"
                        required
                      />
                    </label>

                    {!isRegister && (
                      <div className="text-right">
                        <Link href="/forgot" className="text-sm font-semibold text-[var(--accent)] hover:underline">Forgot password?</Link>
                      </div>
                    )}
                  </>
                )}

                {error ? (
                  <p className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                    {error}
                  </p>
                ) : null}

                {otpNotice ? (
                  <p className="rounded-xl border px-4 py-3 text-sm" style={{ background: 'rgba(52,211,193,0.08)', borderColor: 'rgba(52,211,193,0.2)', color: 'var(--accent)' }}>
                    {otpNotice}
                  </p>
                ) : null}

                <button type="submit" disabled={isLoading} className="btn btn-primary h-12 w-full">
                  {isLoading ? (
                    'Please wait…'
                  ) : isRegister ? (
                    registrationStep === 'details' ? (
                      <>Send code <LuArrowRight aria-hidden="true" /></>
                    ) : (
                      'Verify & create account'
                    )
                  ) : (
                    'Sign in'
                  )}
                </button>

                {isRegister && registrationStep === 'otp' && (
                  <button
                    type="button"
                    onClick={async () => {
                      setIsLoading(true);
                      setError('');
                      try {
                        const { data } = await api.post<OtpResponse>('/auth/register/request-otp', {
                          email,
                          password,
                          display_name: displayName || undefined,
                        });
                        setOtp('');
                        setOtpNotice(data.message || `We sent a fresh code to ${email}.`);
                      } catch (submissionError: any) {
                        const message = submissionError?.response?.data?.error ?? 'Could not resend code';
                        setError(message);
                      } finally {
                        setIsLoading(false);
                      }
                    }}
                    className="btn w-full"
                    disabled={isLoading}
                  >
                    Resend code
                  </button>
                )}

                <p className="text-center text-sm muted">
                  {isRegister ? 'Already have an account?' : "Don't have an account?"}{' '}
                  <Link href={isRegister ? '/login' : '/register'} className="font-semibold text-[var(--primary)] hover:underline">
                    {isRegister ? 'Log in' : 'Register'}
                  </Link>
                </p>
              </form>

              <p className="mt-8 flex items-center justify-center gap-2 text-xs text-faint">
                <LuShieldCheck aria-hidden="true" /> Secured with encrypted access &amp; refresh tokens
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
