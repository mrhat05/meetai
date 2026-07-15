'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LuPlus, LuSearch, LuUsers } from 'react-icons/lu';
import api from '@/lib/api';
import AppHeader from '@/components/AppHeader';
import GroupCard from '@/components/GroupCard';
import CreateGroupModal from '@/components/CreateGroupModal';
import type { GroupListItem } from '@/lib/types';

export default function GroupsPage() {
  const router = useRouter();
  const [groups, setGroups] = useState<GroupListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const accessToken = window.localStorage.getItem('accessToken');
    if (!accessToken) {
      router.replace('/login');
      return;
    }

    void loadGroups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const loadGroups = async () => {
    try {
      setIsLoading(true);
      const { data } = await api.get<GroupListItem[]>('/groups');
      setGroups(data);
    } catch (error) {
      console.error('Failed to load groups:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(
      (g) => g.name.toLowerCase().includes(q) || (g.description ?? '').toLowerCase().includes(q),
    );
  }, [groups, query]);

  const liveCount = groups.filter((g) => g.is_meeting_active).length;

  return (
    <main className="min-h-screen app-root px-5 pb-16 pt-6 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <AppHeader />

        <header className="animate-fade-up mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Groups</p>
            <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">Your groups</h1>
            <p className="mt-2 text-base leading-7 muted">
              {isLoading ? 'Loading…' : `${groups.length} group${groups.length === 1 ? '' : 's'}${liveCount ? ` · ${liveCount} live now` : ''}`}
            </p>
          </div>
          <button type="button" onClick={() => setIsCreateOpen(true)} className="btn btn-primary">
            <LuPlus aria-hidden="true" /> New group
          </button>
        </header>

        {/* Search */}
        <div className="animate-fade-up relative mb-8">
          <LuSearch aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search groups…"
            className="auth-input pl-11"
          />
        </div>

        {isLoading ? (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <div key={n} className="card rounded-3xl p-5">
                <div className="flex items-start gap-4">
                  <div className="skeleton h-14 w-14 rounded-2xl" />
                  <div className="flex-1 space-y-2"><div className="skeleton h-5 w-28" /><div className="skeleton h-3 w-40" /></div>
                </div>
                <div className="mt-5 flex gap-2"><div className="skeleton h-7 w-24 rounded-full" /><div className="skeleton h-7 w-16 rounded-full" /></div>
              </div>
            ))}
          </div>
        ) : filtered.length ? (
          <div className="stagger grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((group) => (
              <GroupCard
                key={group.id}
                href={`/groups/${group.id}`}
                name={group.name}
                avatarUrl={group.avatar_url}
                memberCount={group.member_count}
                role={group.role}
                isMeetingActive={group.is_meeting_active}
                activeRoomCode={group.active_room_code}
                description={group.description}
              />
            ))}
          </div>
        ) : groups.length ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed px-5 py-16 text-center" style={{ borderColor: 'var(--border-strong)' }}>
            <LuSearch aria-hidden="true" className="text-2xl text-faint" />
            <p className="text-sm muted">No groups match “{query}”.</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed px-5 py-16 text-center" style={{ borderColor: 'var(--border-strong)' }}>
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--border)] bg-white/5 text-xl text-[var(--primary)]">
              <LuUsers aria-hidden="true" />
            </span>
            <p className="text-sm muted">No groups yet. Create your first group to start organizing meetings.</p>
            <button type="button" onClick={() => setIsCreateOpen(true)} className="btn btn-ghost mt-1">
              <LuPlus aria-hidden="true" /> Create a group
            </button>
          </div>
        )}
      </div>

      <CreateGroupModal open={isCreateOpen} onClose={() => setIsCreateOpen(false)} onCreated={loadGroups} />
    </main>
  );
}
