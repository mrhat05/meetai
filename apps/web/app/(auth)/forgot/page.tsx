"use client";

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LuKeyRound, LuArrowLeft, LuArrowRight } from 'react-icons/lu';
import api from '@/lib/api';

export default function ForgotPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [step, setStep] = useState<'request' | 'verify'>('request');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  async function handleRequest(event: React.FormEvent) {
    event.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const { data } = await api.post('/auth/password/request-otp', { email });
      setNotice(data.message || `We sent a 6-digit code to ${email}.`);
      setStep('verify');
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Could not send code');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleReset(event: React.FormEvent) {
    event.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      await api.post('/auth/password/reset', { email, otp, new_password: newPassword });
      router.push('/login');
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Could not reset password');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12 app-root sm:px-6">
      <div className="animate-fade-up w-full max-w-md">
        <div className="card card-hero p-7 sm:p-8">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--border)] bg-[rgba(124,108,246,0.14)] text-2xl text-[var(--primary)]">
            <LuKeyRound aria-hidden="true" />
          </span>
          <h2 className="mt-5 font-display text-2xl font-semibold tracking-tight">Reset your password</h2>
          <p className="mt-2 text-sm leading-6 muted">
            {step === 'request'
              ? 'Enter your email and we’ll send you a 6-digit verification code.'
              : 'Enter the code we sent, then choose a new password.'}
          </p>

          {error ? (
            <div className="mt-5 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
          ) : null}
          {notice ? (
            <div className="mt-5 rounded-xl border px-4 py-3 text-sm" style={{ background: 'rgba(52,211,193,0.08)', borderColor: 'rgba(52,211,193,0.2)', color: 'var(--accent)' }}>{notice}</div>
          ) : null}

          {step === 'request' && (
            <form onSubmit={handleRequest} className="mt-6 space-y-4">
              <label className="block">
                <span className="mb-2 block text-sm font-medium muted">Email</span>
                <input value={email} onChange={(e) => setEmail(e.target.value)} required type="email" placeholder="you@example.com" className="auth-input" />
              </label>

              <button type="submit" disabled={isLoading} className="btn btn-primary h-12 w-full">
                {isLoading ? 'Sending…' : (<>Send code <LuArrowRight aria-hidden="true" /></>)}
              </button>
            </form>
          )}

          {step === 'verify' && (
            <form onSubmit={handleReset} className="mt-6 space-y-4">
              <label className="block">
                <span className="mb-2 block text-sm font-medium muted">Verification code</span>
                <input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0,6))} required type="text" inputMode="numeric" placeholder="123456" maxLength={6} className="auth-input text-center font-mono text-lg tracking-[0.5em]" />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium muted">New password</span>
                <input value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required type="password" placeholder="••••••••" className="auth-input" />
              </label>

              <div className="flex gap-3">
                <button type="submit" disabled={isLoading} className="btn btn-primary h-12 flex-1">Reset password</button>
                <button type="button" onClick={async () => {
                  setIsLoading(true);
                  setError('');
                  try {
                    const { data } = await api.post('/auth/password/request-otp', { email });
                    setNotice(data.message || `We sent a fresh code to ${email}.`);
                  } catch (err: any) {
                    setError(err?.response?.data?.error ?? 'Could not resend code');
                  } finally {
                    setIsLoading(false);
                  }
                }} disabled={isLoading} className="btn h-12">Resend</button>
              </div>
            </form>
          )}
        </div>

        <div className="mt-5 text-center">
          <Link href="/login" className="inline-flex items-center gap-2 text-sm font-medium muted transition-colors hover:text-white">
            <LuArrowLeft aria-hidden="true" /> Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
