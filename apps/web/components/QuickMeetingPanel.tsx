'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LuVideo, LuArrowRight, LuCopy, LuCircleCheck, LuX } from 'react-icons/lu';
import api from '@/lib/api';

export default function QuickMeetingPanel() {
  const router = useRouter();
  const [roomCode, setRoomCode] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [createdRoomCode, setCreatedRoomCode] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCreateRoom = async () => {
    try {
      setIsCreating(true);
      setError(null);
      setCopyStatus(null);

      const response = await api.post('/rooms/create');
      const newRoomCode = response.data.room.roomCode;
      const newInviteLink = response.data.joinUrl ?? `${window.location.origin}/room/${newRoomCode}`;

      setCreatedRoomCode(newRoomCode);
      setInviteLink(newInviteLink);
    } catch (err: any) {
      console.error('Error creating room:', err);
      setError(err.response?.data?.error || 'Failed to create room');
    } finally {
      setIsCreating(false);
    }
  };

  const handleCopyInviteLink = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopyStatus('Copied!');
    } catch (err: any) {
      console.error('Failed to copy invite link:', err);
      setCopyStatus('Unable to copy');
    }
  };

  const handleJoinRoom = (event: React.FormEvent) => {
    event.preventDefault();
    if (!roomCode.trim()) {
      setError('Enter a room code to join');
      return;
    }
    setIsJoining(true);
    setError(null);
    router.push(`/room/${roomCode.trim()}`);
  };

  return (
    <div className="card card-hero p-5 md:p-6">
      <div className="grid gap-5 md:grid-cols-[1fr_auto_1fr] md:items-center">
        {/* Create */}
        <div>
          <p className="text-sm font-medium text-white">Start a new meeting</p>
          <p className="mt-1 text-sm muted">One click — get an instant invite link.</p>
          <button onClick={handleCreateRoom} disabled={isCreating} className="btn btn-primary mt-3 h-12 w-full">
            <LuVideo aria-hidden="true" /> {isCreating ? 'Creating…' : 'Create room'}
          </button>
          <p className="mt-2.5 text-xs text-faint">You can turn on AI minutes in the lobby before joining.</p>
        </div>

        {/* Divider */}
        <div className="flex items-center justify-center md:flex-col md:self-stretch">
          <span className="h-px flex-1 bg-[var(--border-strong)] md:h-full md:w-px" />
          <span className="px-3 text-xs font-semibold uppercase tracking-widest text-faint md:py-3">or</span>
          <span className="h-px flex-1 bg-[var(--border-strong)] md:h-full md:w-px" />
        </div>

        {/* Join */}
        <div>
          <p className="text-sm font-medium text-white">Join with a code</p>
          <p className="mt-1 text-sm muted">Already have a room code? Hop right in.</p>
          <form onSubmit={handleJoinRoom} className="mt-3 flex gap-2">
            <input
              type="text"
              placeholder="room code"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toLowerCase())}
              maxLength={10}
              disabled={isJoining}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="auth-input h-12 flex-1 font-mono tracking-wide"
            />
            <button type="submit" disabled={isJoining || !roomCode.trim()} className="btn h-12 shrink-0 px-4" aria-label="Join meeting">
              <LuArrowRight aria-hidden="true" />
            </button>
          </form>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-200">
          {error}
        </div>
      )}

      {inviteLink && (
        <div className="animate-fade-up mt-4 rounded-2xl border border-[var(--border-strong)] bg-[rgba(52,211,193,0.06)] p-4">
          <div className="flex items-start justify-between gap-3">
            <p className="inline-flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--accent)' }}>
              <LuCircleCheck aria-hidden="true" /> Room ready — share this link
            </p>
            <button
              type="button"
              onClick={() => { setInviteLink(null); setCreatedRoomCode(null); setCopyStatus(null); }}
              className="rounded-full p-1.5 text-white/60 transition hover:bg-white/10 hover:text-white"
              aria-label="Dismiss"
            >
              <LuX aria-hidden="true" />
            </button>
          </div>
          <p className="mt-3 break-all rounded-xl tile px-4 py-3 font-mono text-sm" style={{ color: 'var(--accent)' }}>{inviteLink}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            <button type="button" onClick={handleCopyInviteLink} className="btn">
              <LuCopy aria-hidden="true" /> Copy link
            </button>
            <button
              type="button"
              onClick={() => createdRoomCode && router.push(`/room/${createdRoomCode}`)}
              className="btn btn-primary"
            >
              Join now <LuArrowRight aria-hidden="true" />
            </button>
            {copyStatus && <span className="text-sm" style={{ color: 'var(--accent)' }}>{copyStatus}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
