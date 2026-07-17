'use client';

import { useCallback, useEffect, useRef } from 'react';
import api from '@/lib/api';

// Minimal typing for the slice of Google Identity Services we use.
type GoogleCredentialResponse = { credential?: string };
type GoogleIdApi = {
  initialize: (config: { client_id: string; callback: (r: GoogleCredentialResponse) => void }) => void;
  renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
};
declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleIdApi } };
  }
}

const GSI_SRC = 'https://accounts.google.com/gsi/client';
const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

// The auth body shape returned by /auth/google (same as /login).
export type GoogleAuthResponse = {
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

type Props = {
  mode: 'login' | 'register';
  onSuccess: (data: GoogleAuthResponse) => void;
  onError: (message: string) => void;
  onBusyChange?: (busy: boolean) => void;
};

function loadGsiScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Failed to load Google script')));
      return;
    }
    const script = document.createElement('script');
    script.src = GSI_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google script'));
    document.head.appendChild(script);
  });
}

export default function GoogleSignInButton({ mode, onSuccess, onError, onBusyChange }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Keep the latest callbacks/mode without re-initializing GSI on every render.
  const handlersRef = useRef({ mode, onSuccess, onError, onBusyChange });
  handlersRef.current = { mode, onSuccess, onError, onBusyChange };

  const handleCredential = useCallback(async (response: GoogleCredentialResponse) => {
    const { onSuccess: ok, onError: fail, onBusyChange: busy } = handlersRef.current;
    if (!response.credential) {
      fail('Google sign-in was cancelled.');
      return;
    }
    busy?.(true);
    try {
      const { data } = await api.post<GoogleAuthResponse>('/auth/google', { credential: response.credential });
      ok(data);
    } catch (err: any) {
      fail(err?.response?.data?.error ?? 'Could not sign in with Google.');
    } finally {
      busy?.(false);
    }
  }, []);

  const renderButton = useCallback(() => {
    const idApi = window.google?.accounts?.id;
    const el = containerRef.current;
    if (!idApi || !el || !CLIENT_ID) return;
    const width = Math.min(400, Math.max(200, Math.round(el.getBoundingClientRect().width) || 320));
    el.innerHTML = '';
    idApi.renderButton(el, {
      type: 'standard',
      theme: 'filled_black',
      size: 'large',
      shape: 'pill',
      text: handlersRef.current.mode === 'register' ? 'signup_with' : 'continue_with',
      logo_alignment: 'left',
      width,
    });
  }, []);

  useEffect(() => {
    if (!CLIENT_ID) return;
    let cancelled = false;

    loadGsiScript()
      .then(() => {
        if (cancelled) return;
        window.google?.accounts?.id?.initialize({
          client_id: CLIENT_ID,
          callback: (r) => void handleCredential(r),
        });
        renderButton();
      })
      .catch(() => {
        if (!cancelled) handlersRef.current.onError('Google sign-in is unavailable right now.');
      });

    // Re-render the fixed-width Google button to match a resized container.
    const onResize = () => renderButton();
    window.addEventListener('resize', onResize);
    return () => {
      cancelled = true;
      window.removeEventListener('resize', onResize);
    };
  }, [handleCredential, renderButton]);

  if (!CLIENT_ID) return null;

  // Google renders an iframe button into this container; center it.
  return <div ref={containerRef} className="flex w-full justify-center" />;
}
