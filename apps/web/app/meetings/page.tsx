'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  LuVideo,
  LuActivity,
  LuCircleCheck,
  LuUsers,
  LuMessageSquare,
  LuTimer,
  LuTrophy,
} from 'react-icons/lu';
import api from '@/lib/api';
import AppHeader from '@/components/AppHeader';
import MeetingsList from '@/components/MeetingsList';
import { formatDuration } from '@/lib/format';
import type { DashboardSummaryResponse } from '@/lib/types';

export default function MeetingsPage() {
  const router = useRouter();
  const [summary, setSummary] = useState<DashboardSummaryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const accessToken = window.localStorage.getItem('accessToken');
    if (!accessToken) {
      router.replace('/login');
      return;
    }

    const load = async () => {
      try {
        setIsLoading(true);
        const { data } = await api.get<DashboardSummaryResponse>('/rooms/dashboard/summary');
        setSummary(data);
      } catch (error) {
        console.error('Failed to load meetings:', error);
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, [router]);

  const metricCards = useMemo(() => {
    const overview = summary?.overview;
    return [
      { label: 'Total meetings', value: overview?.totalRooms ?? 0, Icon: LuVideo },
      { label: 'Active now', value: overview?.activeRooms ?? 0, Icon: LuActivity },
      { label: 'Completed', value: overview?.completedRooms ?? 0, Icon: LuCircleCheck },
      { label: 'Participants', value: overview?.totalParticipants ?? 0, Icon: LuUsers },
      { label: 'Messages sent', value: overview?.totalMessages ?? 0, Icon: LuMessageSquare },
      { label: 'Avg duration', value: formatDuration(overview?.averageDurationMinutes ?? 0), Icon: LuTimer },
      { label: 'Longest meeting', value: formatDuration(overview?.longestDurationMinutes ?? 0), Icon: LuTrophy },
    ];
  }, [summary]);

  return (
    <main className="min-h-screen app-root px-5 pb-16 pt-6 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <AppHeader />

        <header className="animate-fade-up mb-8">
          <p className="eyebrow">Meetings</p>
          <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">Your meeting history</h1>
          <p className="mt-2 max-w-2xl text-base leading-7 muted">
            Every room you&apos;ve hosted, with duration, participation, and live status.
          </p>
        </header>

        {/* Stats */}
        <div className="stagger mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {metricCards.map((metric) => {
            const Icon = metric.Icon;
            return (
              <div key={metric.label} className="card hover-lift rounded-2xl p-5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm muted">{metric.label}</p>
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border)] bg-white/5 text-[var(--accent)]">
                    <Icon aria-hidden="true" className="text-base" />
                  </span>
                </div>
                {isLoading ? (
                  <div className="skeleton mt-4 h-8 w-20" />
                ) : (
                  <p className="mt-3 font-display text-3xl font-semibold tracking-tight">{metric.value}</p>
                )}
              </div>
            );
          })}
        </div>

        {/* Full list */}
        <section className="card p-6 md:p-8">
          <h2 className="font-display text-xl font-semibold">All meetings</h2>
          <p className="mt-1 text-sm muted">Showing your most recent sessions, newest first.</p>
          <div className="mt-6">
            <MeetingsList meetings={summary?.recentMeetings ?? []} isLoading={isLoading} variant="table" />
          </div>
        </section>
      </div>
    </main>
  );
}
