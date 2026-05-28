'use client';

type RoleBadgeProps = {
  role: 'owner' | 'admin' | 'member';
};

export default function RoleBadge({ role }: RoleBadgeProps) {
  if (role === 'owner') {
    return <span className="rounded-full border border-purple-400/25 bg-purple-400/15 px-2 py-0.5 text-xs font-medium text-purple-200">Owner</span>;
  }

  if (role === 'admin') {
    return <span className="rounded-full border border-cyan-400/25 bg-cyan-400/15 px-2 py-0.5 text-xs font-medium text-cyan-200">Admin</span>;
  }

  return <span className="rounded-full border border-white/10 bg-white/10 px-2 py-0.5 text-xs font-medium text-white/75">Member</span>;
}