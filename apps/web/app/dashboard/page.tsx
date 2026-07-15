'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  LuUsers,
  LuPlus,
  LuArrowRight,
  LuArrowUpRight,
  LuCalendarClock,
  LuSparkles,
  LuX,
} from 'react-icons/lu';
import api from '@/lib/api';
import useGroupMeetingAlert from '@/hooks/useGroupMeetingAlert';
import AppHeader from '@/components/AppHeader';
import QuickMeetingPanel from '@/components/QuickMeetingPanel';
import MeetingsList from '@/components/MeetingsList';
import CreateGroupModal from '@/components/CreateGroupModal';
import RoleBadge from '@/components/RoleBadge';
import type { DashboardSummaryResponse, GroupListItem } from '@/lib/types';

function getGroupInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'G';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export default function DashboardPage() {
  const router = useRouter();
  // Live "meeting started" alerts are handled app-wide by <GlobalMeetingAlert/>
  // in the root layout, so the dashboard only surfaces the minutes-ready banner.
  const { minutesReadyAlert } = useGroupMeetingAlert();
  const [dismissedMinutesId, setDismissedMinutesId] = useState<string | null>(null);
  const [summary, setSummary] = useState<DashboardSummaryResponse | null>(null);
  const [isSummaryLoading, setIsSummaryLoading] = useState(true);
  const [groups, setGroups] = useState<GroupListItem[]>([]);
  const [isGroupsLoading, setIsGroupsLoading] = useState(true);
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  const [greetingName, setGreetingName] = useState('');

  useEffect(() => {
    const accessToken = window.localStorage.getItem('accessToken');
    if (!accessToken) {
      router.replace('/login');
      return;
    }

    const storedName =
      window.localStorage.getItem('displayName') || window.localStorage.getItem('userName') || '';
    setGreetingName(storedName.split(' ')[0] ?? '');

    const loadSummary = async () => {
      try {
        setIsSummaryLoading(true);
        const { data } = await api.get<DashboardSummaryResponse>('/rooms/dashboard/summary');
        setSummary(data);
      } catch (summaryError) {
        console.error('Failed to load dashboard summary:', summaryError);
      } finally {
        setIsSummaryLoading(false);
      }
    };

    const loadGroups = async () => {
      try {
        setIsGroupsLoading(true);
        const { data } = await api.get<GroupListItem[]>('/groups');
        setGroups(data);
      } catch (groupsError) {
        console.error('Failed to load groups:', groupsError);
      } finally {
        setIsGroupsLoading(false);
      }
    };

    void loadSummary();
    void loadGroups();
  }, [router]);

  const reloadGroups = async () => {
    const { data } = await api.get<GroupListItem[]>('/groups');
    setGroups(data);
  };

  const totalMeetings = summary?.overview.totalRooms ?? 0;
  const activeMeetings = summary?.overview.activeRooms ?? 0;

  return (
    <main className="min-h-screen app-root px-5 pb-16 pt-6 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <AppHeader />

        {minutesReadyAlert && minutesReadyAlert.minutesId !== dismissedMinutesId && (
          <div className="animate-fade-up mb-6 flex w-full flex-wrap items-center justify-between gap-4 rounded-2xl border border-emerald-400/25 bg-emerald-400/10 px-5 py-4 text-emerald-50">
            <p className="inline-flex min-w-0 items-center gap-2.5 text-sm sm:text-base">
              <LuSparkles aria-hidden="true" className="shrink-0 text-emerald-300" />
              <span>AI meeting minutes are ready</span>
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <Link
                href={`/groups/${minutesReadyAlert.groupId}?minutes=${minutesReadyAlert.minutesId}`}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-950 shadow-sm transition hover:-translate-y-px hover:bg-white"
              >
                View minutes <LuArrowRight aria-hidden="true" />
              </Link>
              <button
                type="button"
                onClick={() => setDismissedMinutesId(minutesReadyAlert.minutesId)}
                className="rounded-full p-2 text-emerald-100 transition hover:bg-emerald-300/20 hover:text-white"
                aria-label="Dismiss minutes alert"
              >
                <LuX aria-hidden="true" />
              </button>
            </div>
          </div>
        )}

        {/* Greeting */}
        <header className="animate-fade-up mb-6">
          <p className="eyebrow">Dashboard</p>
          <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Welcome back{greetingName ? ', ' : ' '}
            <span className="gradient-text">{greetingName || 'to MeetAI'}</span>
          </h1>
        </header>

        {/* Fast action: new meeting */}
        <div className="animate-fade-up mb-6">
          <QuickMeetingPanel />
        </div>

        {/* Two-column: meetings preview + groups preview */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Recent meetings */}
          <section className="card p-5 md:p-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border)] bg-white/5 text-[var(--accent)]">
                  <LuCalendarClock aria-hidden="true" />
                </span>
                <div>
                  <h2 className="font-display text-lg font-semibold">Recent meetings</h2>
                  <p className="text-xs muted">{isSummaryLoading ? 'Loading…' : `${totalMeetings} total · ${activeMeetings} live`}</p>
                </div>
              </div>
              <Link href="/meetings" className="inline-flex items-center gap-1 text-sm font-medium text-[var(--muted)] transition hover:text-white">
                View all <LuArrowUpRight aria-hidden="true" />
              </Link>
            </div>

            <div className="mt-5">
              <MeetingsList meetings={summary?.recentMeetings ?? []} isLoading={isSummaryLoading} variant="preview" limit={4} />
            </div>
          </section>

          {/* Groups */}
          <section className="card p-5 md:p-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border)] bg-white/5 text-[var(--primary)]">
                  <LuUsers aria-hidden="true" />
                </span>
                <div>
                  <h2 className="font-display text-lg font-semibold">Groups</h2>
                  <p className="text-xs muted">{isGroupsLoading ? 'Loading…' : `${groups.length} group${groups.length === 1 ? '' : 's'}`}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setIsCreateGroupOpen(true)} className="btn btn-ghost px-3 py-1.5 text-sm" aria-label="New group">
                  <LuPlus aria-hidden="true" />
                  <span className="hidden sm:inline">New</span>
                </button>
                <Link href="/groups" className="inline-flex items-center gap-1 text-sm font-medium text-[var(--muted)] transition hover:text-white">
                  View all <LuArrowUpRight aria-hidden="true" />
                </Link>
              </div>
            </div>

            <div className="mt-5">
              {isGroupsLoading ? (
                <div className="space-y-2.5">
                  {[0, 1, 2, 3].map((n) => (
                    <div key={n} className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-white/[0.02] px-3 py-3">
                      <div className="skeleton h-9 w-9 rounded-xl" />
                      <div className="flex-1 space-y-2"><div className="skeleton h-3.5 w-28" /><div className="skeleton h-3 w-16" /></div>
                    </div>
                  ))}
                </div>
              ) : groups.length ? (
                <div className="space-y-2">
                  {groups.slice(0, 4).map((group) => (
                    <Link
                      key={group.id}
                      href={`/groups/${group.id}`}
                      className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-white/[0.02] px-3 py-2.5 transition hover:border-[var(--border-strong)] hover:bg-white/[0.05]"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--border)] bg-white/5 font-display text-xs font-semibold text-white/80">
                        {group.avatar_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={group.avatar_url} alt="" className="h-full w-full object-cover" />
                        ) : (
                          getGroupInitials(group.name)
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-white">{group.name}</p>
                        <p className="truncate text-xs text-faint">{group.member_count} member{group.member_count === 1 ? '' : 's'}</p>
                      </div>
                      {group.is_meeting_active ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 text-xs font-semibold text-emerald-200">
                          <span className="dot-live" /> Live
                        </span>
                      ) : (
                        <RoleBadge role={group.role} />
                      )}
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed px-4 py-10 text-center" style={{ borderColor: 'var(--border-strong)' }}>
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[var(--border)] bg-white/5 text-lg text-[var(--primary)]">
                    <LuUsers aria-hidden="true" />
                  </span>
                  <p className="text-sm muted">No groups yet.</p>
                  <button type="button" onClick={() => setIsCreateGroupOpen(true)} className="btn btn-ghost mt-1">
                    <LuPlus aria-hidden="true" /> Create a group
                  </button>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      <CreateGroupModal
        open={isCreateGroupOpen}
        onClose={() => setIsCreateGroupOpen(false)}
        onCreated={reloadGroups}
      />
    </main>
  );
}
