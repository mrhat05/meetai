'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import RoomShell from '@/components/RoomShell';
import PreJoinLobby from '@/components/PreJoinLobby';
import type { JoinSettings } from '@/lib/joinSettings';

export default function RoomPage() {
  const router = useRouter();
  const params = useParams<{ roomCode?: string | string[] }>();
  const routeRoomCode = Array.isArray(params.roomCode) ? params.roomCode[0] : params.roomCode;
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // null → still in the pre-join lobby; set once the user clicks "Join now".
  const [joinSettings, setJoinSettings] = useState<JoinSettings | null>(null);

  useEffect(() => {
    const initializeRoom = () => {
      try {
        if (!routeRoomCode) {
          setError('Room not found');
          setIsLoading(false);
          return;
        }

        setRoomCode(routeRoomCode);

        const accessToken = localStorage.getItem('accessToken');
        if (!accessToken) {
          router.push(`/login?redirect=/room/${routeRoomCode}`);
          return;
        }

        setIsLoading(false);
      } catch {
        setError('An error occurred');
        setIsLoading(false);
      }
    };

    initializeRoom();
  }, [routeRoomCode, router]);

  if (isLoading) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 app-root">
        <span className="brand-mark animate-pop-in text-lg" style={{ width: '3rem', height: '3rem' }}>M</span>
        <div className="flex items-center gap-2 text-sm muted">
          <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--primary)] [animation-delay:-0.3s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--primary)] [animation-delay:-0.15s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--primary)]" />
          <span className="ml-1">Preparing your room…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center px-4 app-root">
        <div className="card card-hero animate-pop-in max-w-sm p-8 text-center">
          <p className="mb-1 font-display text-xl font-semibold">Something went wrong</p>
          <p className="mb-6 text-sm text-rose-300">{error}</p>
          <button onClick={() => router.push('/dashboard')} className="btn btn-primary mx-auto">Back to dashboard</button>
        </div>
      </div>
    );
  }

  if (!roomCode) {
    return null;
  }

  // Green room first — pick devices / mute state — then enter the call.
  if (!joinSettings) {
    return <PreJoinLobby roomCode={roomCode} onJoin={setJoinSettings} />;
  }

  return <RoomShell roomCode={roomCode} joinSettings={joinSettings} />;
}
