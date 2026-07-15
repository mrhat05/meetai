'use client';

import Link from 'next/link';
import { LuUsers } from 'react-icons/lu';
import RoleBadge from '@/components/RoleBadge';

type GroupCardProps = {
  href?: string;
  name: string;
  avatarUrl: string | null;
  memberCount: number;
  role: 'owner' | 'admin' | 'member';
  isMeetingActive: boolean;
  activeRoomCode?: string | null;
  description?: string | null;
};

function getGroupInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'G';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export default function GroupCard({ href, name, avatarUrl, memberCount, role, isMeetingActive, activeRoomCode, description }: GroupCardProps) {
  const content = (
    <>
      <div className="flex items-start gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-[var(--border)] bg-white/5 font-display">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt={`${name} avatar`} className="h-full w-full object-cover" />
          ) : (
            <span className="text-lg font-semibold tracking-wide text-white">{getGroupInitials(name)}</span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate text-lg font-semibold tracking-tight text-white">{name}</h3>
              {description ? <p className="mt-1 line-clamp-2 text-sm leading-6 muted">{description}</p> : null}
            </div>

            {isMeetingActive && (
              <div className="flex shrink-0 items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-200">
                <span className="dot-live" />
                {activeRoomCode ? 'Live · Join' : 'Live'}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-2 text-sm">
        <span className="badge">
          <LuUsers aria-hidden="true" className="text-sm" />
          {memberCount} member{memberCount === 1 ? '' : 's'}
        </span>
        <RoleBadge role={role} />
      </div>
    </>
  );

  if (href) {
    return (
      <Link href={href} className="card hover-lift group flex h-full flex-col gap-4 rounded-3xl p-5">
        {content}
      </Link>
    );
  }

  return <article className="card flex h-full flex-col gap-4 rounded-3xl p-5">{content}</article>;
}
