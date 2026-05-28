"use client";

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';

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
    <div className="relative min-h-screen overflow-hidden app-root px-6 py-12">
      <div className="mx-auto flex min-h-[calc(100vh-6rem)] w-full max-w-6xl items-center justify-center">
        <div className="grid w-full overflow-hidden rounded-3xl card md:grid-cols-[1.1fr_0.9fr]">
            <div className="hidden flex-col justify-between gap-10 px-10 py-12 text-white md:flex" style={{ background: 'linear-gradient(180deg, rgba(124,92,255,0.14), transparent)' }}>
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.3em]" style={{ color: 'var(--accent)' }}>MeetAI</p>
              <h1 className="mt-4 max-w-md text-4xl font-semibold tracking-tight" style={{ color: 'var(--foreground)' }}>
                {isRegister ? 'Create your workspace and start collaborating.' : 'Welcome back. Sign in to continue.'}
              </h1>
              <p className="mt-4 max-w-lg text-base leading-7 muted">Keep your sessions, rooms, and chat in one place with a simple sign-in flow.</p>
            </div>
            <div className="rounded-2xl p-6 tile text-sm leading-6 muted">
              Secure tokens are stored with an access token in localStorage and a refresh token in an httpOnly cookie.
            </div>
          </div>

          <div className="px-6 py-10 sm:px-10 sm:py-12">
            <div className="mx-auto max-w-md">
              <div className="mb-8">
                <p className="text-sm font-semibold uppercase tracking-[0.28em]" style={{ color: 'var(--primary)' }}>
                  {isRegister ? 'Create account' : 'Sign in'}
                </p>
                <h2 className="mt-3 text-3xl font-semibold tracking-tight" style={{ color: 'var(--foreground)' }}>
                  {isRegister ? 'Make a new MeetAI account' : 'Log in to your account'}
                </h2>
                <p className="mt-3 text-sm leading-6 muted">
                  {isRegister
                    ? registrationStep === 'details'
                      ? 'Enter your details and we will send a verification code.'
                      : 'Enter the code we sent to finish creating your account.'
                    : 'Enter your credentials and we will sign you in.'}
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                {isRegister && registrationStep === 'details' && (
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium" style={{ color: 'var(--muted)' }}>Display name</span>
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
                    <span className="mb-2 block text-sm font-medium" style={{ color: 'var(--muted)' }}>Verification code</span>
                    <input
                      value={otp}
                      onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
                      type="text"
                      inputMode="numeric"
                      placeholder="123456"
                      maxLength={6}
                      className="auth-input"
                      required
                    />
                  </label>
                )}

                {! (isRegister && registrationStep === 'otp') && (
                  <>
                    <label className="block">
                      <span className="mb-2 block text-sm font-medium" style={{ color: 'var(--muted)' }}>Email</span>
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
                      <span className="mb-2 block text-sm font-medium" style={{ color: 'var(--muted)' }}>Password</span>
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
                      <div className="mt-2 text-right">
                        <Link href="/forgot" className="text-sm font-semibold" style={{ color: 'var(--accent)' }}>Forgot password?</Link>
                      </div>
                    )}
                  </>
                )}

                {error ? (
                  <p className="rounded-2xl px-4 py-3 text-sm" style={{ background: 'rgba(255,107,107,0.08)', border: '1px solid rgba(255,107,107,0.12)', color: 'var(--danger)' }}>
                    {error}
                  </p>
                ) : null}

                {otpNotice ? (
                  <p className="rounded-2xl px-4 py-3 text-sm" style={{ background: 'rgba(36,208,198,0.06)', border: '1px solid rgba(36,208,198,0.12)', color: 'var(--accent)' }}>
                    {otpNotice}
                  </p>
                ) : null}

                <button type="submit" disabled={isLoading} className="btn btn-primary w-full">
                  {isLoading
                    ? 'Please wait...'
                    : isRegister
                      ? registrationStep === 'details'
                        ? 'Send code'
                        : 'Verify & create account'
                      : 'Sign in'}
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
                  <Link href={isRegister ? '/login' : '/register'} className="font-semibold" style={{ color: 'var(--primary)' }}>
                    {isRegister ? 'Log in' : 'Register'}
                  </Link>
                </p>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
