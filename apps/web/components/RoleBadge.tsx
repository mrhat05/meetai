'use client';

import { LuCrown, LuShieldCheck, LuUser } from 'react-icons/lu';

type RoleBadgeProps = {
  role: 'owner' | 'admin' | 'member';
};

export default function RoleBadge({ role }: RoleBadgeProps) {
  if (role === 'owner') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-400/30 bg-violet-400/15 px-2.5 py-1 text-xs font-semibold text-violet-100">
        <LuCrown aria-hidden="true" className="text-[0.8rem]" /> Owner
      </span>
    );
  }

  if (role === 'admin') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/30 bg-cyan-400/15 px-2.5 py-1 text-xs font-semibold text-cyan-100">
        <LuShieldCheck aria-hidden="true" className="text-[0.8rem]" /> Admin
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-white/8 px-2.5 py-1 text-xs font-medium text-white/75">
      <LuUser aria-hidden="true" className="text-[0.8rem]" /> Member
    </span>
  );
}