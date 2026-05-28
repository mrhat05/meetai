"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
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
    <div className="min-h-screen flex items-center justify-center px-6 py-12 app-root">
      <div className="w-full max-w-md card p-6">
        <h2 className="text-2xl font-semibold mb-4" style={{ color: 'var(--foreground)' }}>Forgot password</h2>
        {error ? <div className="mb-4 text-sm" style={{ color: 'var(--danger)' }}>{error}</div> : null}
        {notice ? <div className="mb-4 text-sm" style={{ color: 'var(--accent)' }}>{notice}</div> : null}

        {step === 'request' && (
          <form onSubmit={handleRequest} className="space-y-4">
            <label className="block">
              <span className="text-sm font-medium">Email</span>
              <input value={email} onChange={(e) => setEmail(e.target.value)} required type="email" className="auth-input mt-1" />
            </label>

            <button type="submit" className="btn-primary w-full">Send code</button>
          </form>
        )}

        {step === 'verify' && (
          <form onSubmit={handleReset} className="space-y-4">
            <label className="block">
              <span className="text-sm font-medium">Verification code</span>
              <input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0,6))} required type="text" inputMode="numeric" className="auth-input mt-1" />
            </label>

            <label className="block">
              <span className="text-sm font-medium">New password</span>
              <input value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required type="password" className="auth-input mt-1" />
            </label>

            <div className="flex gap-2">
              <button type="submit" className="btn-primary flex-1">Reset password</button>
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
              }} className="btn">Resend</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
