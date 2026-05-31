'use client';

import { TiDocumentText } from 'react-icons/ti';

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
      className="w-full rounded-2xl border border-white/10 bg-white/5 p-4 text-left transition hover:border-white/20 hover:bg-white/10"
    >
      <div className="flex items-start gap-3">
        <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-xl text-white/80">
          <TiDocumentText aria-hidden="true" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <h3 className="truncate text-base font-semibold text-white">{title}</h3>
            <span className="rounded-full border border-violet-300/40 bg-violet-400/20 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-violet-100">
              AI generated
            </span>
          </div>

          <p className="mt-2 text-sm text-white/60">
            {formatDate(createdAt)} · {formatMinutes(durationSeconds)} · {participantCount} participant{participantCount === 1 ? '' : 's'}
          </p>
        </div>
      </div>
    </button>
  );
}