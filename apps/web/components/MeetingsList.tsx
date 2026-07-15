'use client';

import Link from 'next/link';
import { LuCalendarClock } from 'react-icons/lu';
import type { RecentMeeting } from '@/lib/types';
import { formatDateTime, formatDuration } from '@/lib/format';

type MeetingsListProps = {
  meetings: RecentMeeting[];
  isLoading: boolean;
  variant?: 'table' | 'preview';
  limit?: number;
};

function StateBadge({ isActive }: { isActive: boolean }) {
  return (
    <span
      className="badge"
      style={
        isActive
          ? { background: 'rgba(52,211,153,0.12)', borderColor: 'rgba(52,211,153,0.28)', color: '#6ee7b7' }
          : undefined
      }
    >
      {isActive && <span className="dot-live" />}
      {isActive ? 'Live' : 'Ended'}
    </span>
  );
}

function InitialTile({ label }: { label: string }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-white/5 font-display text-xs font-semibold uppercase text-white/80">
      {label.slice(0, 2)}
    </span>
  );
}

export default function MeetingsList({ meetings, isLoading, variant = 'table', limit }: MeetingsListProps) {
  const rows = typeof limit === 'number' ? meetings.slice(0, limit) : meetings;

  if (variant === 'preview') {
    if (isLoading) {
      return (
        <div className="space-y-2.5">
          {[0, 1, 2, 3].map((n) => (
            <div key={n} className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-white/[0.02] px-3 py-3">
              <div className="skeleton h-9 w-9 rounded-xl" />
              <div className="flex-1 space-y-2"><div className="skeleton h-3.5 w-32" /><div className="skeleton h-3 w-20" /></div>
              <div className="skeleton h-6 w-14 rounded-full" />
            </div>
          ))}
        </div>
      );
    }

    if (!rows.length) {
      return (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed px-4 py-10 text-center" style={{ borderColor: 'var(--border-strong)' }}>
          <LuCalendarClock aria-hidden="true" className="text-2xl text-faint" />
          <p className="text-sm muted">No meetings yet.</p>
        </div>
      );
    }

    return (
      <div className="space-y-2">
        {rows.map((meeting) => (
          <Link
            key={meeting.id}
            href={meeting.isActive ? `/room/${meeting.roomCode}` : '/meetings'}
            className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-white/[0.02] px-3 py-2.5 transition hover:border-[var(--border-strong)] hover:bg-white/[0.05]"
          >
            <InitialTile label={meeting.name || meeting.roomCode} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">{meeting.name || `Room ${meeting.roomCode}`}</p>
              <p className="truncate text-xs text-faint">{formatDateTime(meeting.createdAt)}</p>
            </div>
            <StateBadge isActive={meeting.isActive} />
          </Link>
        ))}
      </div>
    );
  }

  // Full table
  return (
    <div className="overflow-x-auto rounded-2xl border" style={{ borderColor: 'var(--border)' }}>
      <div className="min-w-[640px]">
        <div className="grid grid-cols-12 gap-4 border-b px-5 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-faint" style={{ borderColor: 'var(--border)' }}>
          <div className="col-span-3">Room</div>
          <div className="col-span-3">Created</div>
          <div className="col-span-2">Duration</div>
          <div className="col-span-2">People</div>
          <div className="col-span-2">State</div>
        </div>

        {isLoading ? (
          <div>
            {[0, 1, 2, 3, 4].map((row) => (
              <div key={row} className="grid grid-cols-12 gap-4 border-b px-5 py-4 last:border-0" style={{ borderColor: 'var(--border)' }}>
                <div className="col-span-3 flex items-center gap-3"><div className="skeleton h-9 w-9 rounded-xl" /><div className="space-y-2"><div className="skeleton h-4 w-24" /><div className="skeleton h-3 w-16" /></div></div>
                <div className="col-span-3 self-center"><div className="skeleton h-4 w-32" /></div>
                <div className="col-span-2 self-center"><div className="skeleton h-4 w-14" /></div>
                <div className="col-span-2 self-center"><div className="skeleton h-4 w-16" /></div>
                <div className="col-span-2 self-center"><div className="skeleton h-6 w-16 rounded-full" /></div>
              </div>
            ))}
          </div>
        ) : rows.length ? (
          rows.map((meeting) => (
            <div key={meeting.id} className="grid grid-cols-12 items-center gap-4 border-b px-5 py-4 text-sm transition-colors last:border-0 hover:bg-white/[0.02]" style={{ borderColor: 'var(--border)' }}>
              <div className="col-span-3 flex items-center gap-3">
                <InitialTile label={meeting.name || meeting.roomCode} />
                <div className="min-w-0">
                  <p className="truncate font-medium text-white">{meeting.name || `Room ${meeting.roomCode}`}</p>
                  <p className="truncate text-xs text-faint">Hosted by {meeting.hostName}</p>
                </div>
              </div>
              <div className="col-span-3 muted">{formatDateTime(meeting.createdAt)}</div>
              <div className="col-span-2 muted">{meeting.isActive ? '—' : formatDuration(meeting.durationMinutes)}</div>
              <div className="col-span-2 muted">{meeting.participantCount} {meeting.participantCount === 1 ? 'person' : 'people'}</div>
              <div className="col-span-2">
                {meeting.isActive ? (
                  <Link href={`/room/${meeting.roomCode}`} className="inline-flex"><StateBadge isActive /></Link>
                ) : (
                  <StateBadge isActive={false} />
                )}
              </div>
            </div>
          ))
        ) : (
          <div className="flex flex-col items-center gap-2 px-5 py-14 text-center">
            <LuCalendarClock aria-hidden="true" className="text-2xl text-faint" />
            <p className="text-sm muted">No meetings yet. Create or join a room to get started.</p>
          </div>
        )}
      </div>
    </div>
  );
}
