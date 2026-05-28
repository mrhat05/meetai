'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import RoomShell from '@/components/RoomShell';

export default function RoomPage() {
  const router = useRouter();
  const params = useParams<{ roomCode?: string | string[] }>();
  const routeRoomCode = Array.isArray(params.roomCode) ? params.roomCode[0] : params.roomCode;
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      <div className="flex items-center justify-center h-screen app-root">
        <p className="text-lg" style={{ color: 'var(--foreground)' }}>Loading room...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen app-root">
        <div className="text-center card p-6">
          <p className="text-lg mb-4" style={{ color: 'var(--danger)' }}>{error}</p>
          <button onClick={() => router.push('/dashboard')} className="btn btn-primary">Back to Dashboard</button>
        </div>
      </div>
    );
  }

  if (!roomCode) {
    return null;
  }

  return <RoomShell roomCode={roomCode} />;
}
