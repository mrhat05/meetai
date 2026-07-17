'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import AppHeader from '@/components/AppHeader';
import MinutesModal from '@/components/MinutesModal';

/**
 * Single-meeting minutes page for a NORMAL (non-group) meeting — reached from
 * the dashboard "Your meeting minutes" list or a minutes-ready notification.
 * Reuses MinutesModal (summary / transcript / tasks / Ask-AI) with a
 * room-scoped source so no group is required.
 */
export default function RoomMinutesPage() {
  const router = useRouter();
  const params = useParams<{ roomCode?: string | string[] }>();
  const roomCode = Array.isArray(params.roomCode) ? params.roomCode[0] : params.roomCode;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const accessToken = window.localStorage.getItem('accessToken');
    if (!accessToken) {
      router.push(`/login?redirect=/room/${roomCode}/minutes`);
      return;
    }
    setReady(true);
  }, [roomCode, router]);

  if (!ready || !roomCode) {
    return null;
  }

  return (
    <main className="min-h-screen app-root px-4 py-6 text-white sm:px-6 sm:py-10">
      <div className="mx-auto max-w-6xl">
        <AppHeader />
      </div>
      <MinutesModal
        isOpen
        source={{ kind: 'room', roomCode }}
        onClose={() => router.push('/dashboard')}
      />
    </main>
  );
}
