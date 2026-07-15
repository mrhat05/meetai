'use client';

import { LuFileText, LuChevronRight, LuClock, LuUsers } from 'react-icons/lu';

type MinutesCardProps = {
  title: string;
  createdAt: string;
  durationSeconds: number;
  participantCount: number;
  onClick: () => void;
};

function formatMinutes(durationSeconds: number) {
  return `${Math.max(1, Math.round(durationSeconds / 60))} min`;
}

function formatDate(createdAt: string) {
  return new Date(createdAt).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export default function MinutesCard({ title, createdAt, durationSeconds, participantCount, onClick }: MinutesCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group w-full rounded-2xl border border-[var(--border)] bg-white/[0.03] p-4 text-left transition hover:-translate-y-0.5 hover:border-[var(--border-strong)] hover:bg-white/[0.06]"
    >
      <div className="flex items-center gap-3.5">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[rgba(139,92,246,0.14)] text-xl text-violet-200">
          <LuFileText aria-hidden="true" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <h3 className="truncate text-base font-semibold text-white">{title}</h3>
            <span className="hidden shrink-0 items-center gap-1.5 rounded-full border border-violet-300/30 bg-violet-400/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-violet-100 sm:inline-flex">
              AI
            </span>
          </div>

          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-faint">
            <span>{formatDate(createdAt)}</span>
            <span className="inline-flex items-center gap-1"><LuClock aria-hidden="true" className="text-[0.85rem]" /> {formatMinutes(durationSeconds)}</span>
            <span className="inline-flex items-center gap-1"><LuUsers aria-hidden="true" className="text-[0.85rem]" /> {participantCount}</span>
          </p>
        </div>

        <LuChevronRight aria-hidden="true" className="shrink-0 text-lg text-faint transition group-hover:translate-x-0.5 group-hover:text-white/70" />
      </div>
    </button>
  );
}