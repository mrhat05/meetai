'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { LuArrowLeft, LuVideo, LuUserPlus, LuSparkles, LuTriangleAlert, LuFileText } from 'react-icons/lu';
import api from '@/lib/api';
import AppHeader from '@/components/AppHeader';
import RoleBadge from '@/components/RoleBadge';
import MinutesCard from '@/components/MinutesCard';
import MinutesModal from '@/components/MinutesModal';
import GroupAskCard from '@/components/GroupAskCard';
import useGroupMeetingAlert from '@/hooks/useGroupMeetingAlert';

type GroupMember = {
  id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member';
  joined_at: string;
  display_name: string;
  avatar_url: string | null;
};

type GroupDetails = {
  id: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  created_by: string | null;
  created_at: string;
  is_active: boolean;
  summarizer_enabled: boolean;
  active_room_code?: string | null;
  is_meeting_active?: boolean;
  members: GroupMember[];
};

type MeetingResponse = {
  room: {
    room_code: string;
  };
  offlineMembers: string[];
};

type GroupMinutesListItem = {
  id: string;
  title: string;
  created_at: string;
  duration_seconds: number;
  participant_count: number;
};

type GroupMinutesDetail = {
  id: string;
};

type InviteFormState = {
  email: string;
};

type JwtPayload = {
  userId?: string;
  displayName?: string;
  email?: string;
};

function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const [, payload] = token.split('.');
    if (!payload) return null;

    const normalizedPayload = payload.replace(/-/g, '+').replace(/_/g, '/');
    const paddedPayload = normalizedPayload.padEnd(Math.ceil(normalizedPayload.length / 4) * 4, '=');

    return JSON.parse(window.atob(paddedPayload)) as JwtPayload;
  } catch {
    return null;
  }
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'G';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

// Mirrors the server's GET /groups/:groupId/minutes-status — the BullMQ job
// state for the group's most recently ended meeting.
type MinutesGenerationStatus = 'idle' | 'queued' | 'processing' | 'completed' | 'failed';

export default function GroupDetailPage() {
  const router = useRouter();
  const params = useParams<{ groupId?: string | string[] }>();
  const searchParams = useSearchParams();
  const groupId = Array.isArray(params.groupId) ? params.groupId[0] : params.groupId;
  const deepLinkHandledRef = useRef(false);
  const { activeMeetingAlert, minutesReadyAlert } = useGroupMeetingAlert();
  const [group, setGroup] = useState<GroupDetails | null>(null);
  const [activeRoomCode, setActiveRoomCode] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isActionPending, setIsActionPending] = useState(false);
  const [inviteForm, setInviteForm] = useState<InviteFormState>({ email: '' });
  const [isInviting, setIsInviting] = useState(false);
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isStartingMeeting, setIsStartingMeeting] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'members' | 'minutes'>('members');
  const [minutes, setMinutes] = useState<GroupMinutesListItem[]>([]);
  const [isMinutesLoading, setIsMinutesLoading] = useState(false);
  const [hasLoadedMinutes, setHasLoadedMinutes] = useState(false);
  const [minutesError, setMinutesError] = useState<string | null>(null);
  const [isMinutesModalOpen, setIsMinutesModalOpen] = useState(false);
  const [selectedMinutes, setSelectedMinutes] = useState<GroupMinutesDetail | null>(null);
  const [minutesReadyToast, setMinutesReadyToast] = useState<string | null>(null);
  const [minutesStatus, setMinutesStatus] = useState<MinutesGenerationStatus>('idle');
  const lastMinutesStatusRef = useRef<MinutesGenerationStatus>('idle');

  useEffect(() => {
    const accessToken = window.localStorage.getItem('accessToken');
    if (!accessToken) {
      setCurrentUserId(null);
      return;
    }

    const decoded = decodeJwtPayload(accessToken);
    setCurrentUserId(decoded?.userId ?? null);
  }, []);

  // Deep link from minutes-ready emails/banners: /groups/:id?minutes=<minutesId>
  // opens the Minutes tab with that entry's modal, then cleans the URL.
  useEffect(() => {
    if (deepLinkHandledRef.current || !groupId) return;

    const minutesParam = searchParams.get('minutes');
    if (!minutesParam) return;

    deepLinkHandledRef.current = true;
    setActiveTab('minutes');
    setSelectedMinutes({ id: minutesParam });
    setIsMinutesModalOpen(true);
    router.replace(`/groups/${groupId}`, { scroll: false });
  }, [groupId, router, searchParams]);

  useEffect(() => {
    if (!toastMessage) return undefined;

    const timeoutId = window.setTimeout(() => {
      setToastMessage(null);
    }, 1800);

    return () => window.clearTimeout(timeoutId);
  }, [toastMessage]);

  useEffect(() => {
    if (!settingsMessage) return undefined;

    const timeoutId = window.setTimeout(() => {
      setSettingsMessage(null);
    }, 2200);

    return () => window.clearTimeout(timeoutId);
  }, [settingsMessage]);

  useEffect(() => {
    if (!groupId || minutesReadyAlert?.groupId !== groupId) {
      return;
    }

    setMinutesReadyToast(minutesReadyAlert.minutesId);
    // The push means the job completed: clear any pending chip and invalidate
    // the cached minutes list so the new entry appears without a reload.
    setMinutesStatus('completed');
    lastMinutesStatusRef.current = 'completed';
    setHasLoadedMinutes(false);
  }, [groupId, minutesReadyAlert]);

  useEffect(() => {
    if (!minutesReadyToast) return undefined;

    const timeoutId = window.setTimeout(() => {
      setMinutesReadyToast(null);
    }, 3500);

    return () => window.clearTimeout(timeoutId);
  }, [minutesReadyToast]);

  useEffect(() => {
    if (!groupId) {
      setIsLoading(false);
      setError('Invalid group link');
      return;
    }

    const loadGroup = async () => {
      try {
        setIsLoading(true);
        const { data } = await api.get<GroupDetails>(`/groups/${groupId}`);
        setGroup({
          ...data,
          members: data.members ?? [],
        });
        setActiveRoomCode(data.active_room_code ?? null);
      } catch (requestError: any) {
        console.error('Failed to load group details:', requestError);
        setError(requestError.response?.data?.error || 'Failed to load group');
      } finally {
        setIsLoading(false);
      }
    };

    void loadGroup();
  }, [groupId]);

  const currentMember = useMemo(() => {
    if (!currentUserId || !group) return null;
    return group.members?.find((member) => member.user_id === currentUserId) ?? null;
  }, [currentUserId, group]);

  const canManageGroup = currentMember?.role === 'owner' || currentMember?.role === 'admin';
  const isOwner = currentMember?.role === 'owner';

  const refreshGroup = async () => {
    if (!groupId) return;

    const { data } = await api.get<GroupDetails>(`/groups/${groupId}`);
    setGroup({
      ...data,
      members: data.members ?? [],
    });
    setActiveRoomCode(data.active_room_code ?? null);
  };

  // When an owner/admin starts a meeting for THIS group, light up the join
  // affordance immediately for a member already viewing the page.
  useEffect(() => {
    if (!groupId || activeMeetingAlert?.groupId !== groupId) {
      return;
    }
    setActiveRoomCode(activeMeetingAlert.roomCode);
  }, [activeMeetingAlert, groupId]);

  const handleStartMeeting = async () => {
    if (!groupId) return;

    try {
      setIsStartingMeeting(true);
      setActionError(null);
      const { data } = await api.post<MeetingResponse>(`/groups/${groupId}/meetings`);

      if (data.offlineMembers.length > 0) {
        setToastMessage(`Email sent to ${data.offlineMembers.length} offline member${data.offlineMembers.length === 1 ? '' : 's'}`);
        window.setTimeout(() => {
          router.push(`/room/${data.room.room_code}`);
        }, 1200);
        return;
      }

      router.push(`/room/${data.room.room_code}`);
    } catch (requestError: any) {
      console.error('Failed to start group meeting:', requestError);
      setActionError(requestError.response?.data?.error || 'Failed to start meeting');
    } finally {
      setIsStartingMeeting(false);
    }
  };

  const handleInviteMember = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!groupId) return;

    const email = inviteForm.email.trim();
    if (!email) {
      setActionError('Email is required');
      return;
    }

    try {
      setIsInviting(true);
      setActionError(null);
      setInviteMessage(null);

      await api.post(`/groups/${groupId}/members`, { email });
      await refreshGroup();
      setInviteForm({ email: '' });
      setInviteMessage('Member invited');
    } catch (requestError: any) {
      console.error('Failed to invite member:', requestError);
      setActionError(requestError.response?.data?.error || requestError.response?.data?.message || 'Failed to invite member');
    } finally {
      setIsInviting(false);
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    if (!groupId) return;

    try {
      setIsActionPending(true);
      setActionError(null);
      await api.delete(`/groups/${groupId}/members/${memberId}`);
      await refreshGroup();
    } catch (requestError: any) {
      console.error('Failed to remove member:', requestError);
      setActionError(requestError.response?.data?.error || 'Failed to remove member');
    } finally {
      setIsActionPending(false);
    }
  };

  const handleToggleAdmin = async (member: GroupMember) => {
    if (!groupId) return;

    try {
      setIsActionPending(true);
      setActionError(null);
      await api.patch(`/groups/${groupId}/members/${member.user_id}`, {
        role: member.role === 'admin' ? 'member' : 'admin',
      });
      await refreshGroup();
    } catch (requestError: any) {
      console.error('Failed to update member role:', requestError);
      setActionError(requestError.response?.data?.error || 'Failed to update member role');
    } finally {
      setIsActionPending(false);
    }
  };

  const handleSummarizerToggle = async (enabled: boolean) => {
    if (!groupId || !group) return;

    try {
      setIsSavingSettings(true);
      setActionError(null);

      const { data } = await api.patch<GroupDetails>(`/groups/${groupId}`, {
        summarizer_enabled: enabled,
      });

      // PATCH returns the group WITHOUT members (and without active-room fields),
      // so merge onto the current group instead of replacing it — otherwise
      // group.members becomes undefined and the members list crashes on render.
      setGroup((current) => (current ? { ...current, ...data, members: current.members } : current));
      setSettingsMessage(enabled ? 'Meeting summarizer enabled' : 'Meeting summarizer disabled');
    } catch (requestError: any) {
      console.error('Failed to update group settings:', requestError);
      setActionError(requestError.response?.data?.error || 'Failed to update group settings');
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleOpenMinutesReadyToast = () => {
    if (!minutesReadyToast) return;

    setActiveTab('minutes');
    setSelectedMinutes({ id: minutesReadyToast });
    setIsMinutesModalOpen(true);
    setMinutesReadyToast(null);
  };

  useEffect(() => {
    if (!groupId || activeTab !== 'minutes' || hasLoadedMinutes) {
      return;
    }

    const fetchMinutes = async () => {
      try {
        setIsMinutesLoading(true);
        setMinutesError(null);
        const { data } = await api.get<GroupMinutesListItem[]>(`/groups/${groupId}/minutes`);
        setMinutes(data);
        setHasLoadedMinutes(true);
      } catch (requestError: any) {
        console.error('Failed to fetch group minutes:', requestError);
        setMinutesError(requestError.response?.data?.error || 'Failed to load minutes');
      } finally {
        setIsMinutesLoading(false);
      }
    };

    void fetchMinutes();
  }, [activeTab, groupId, hasLoadedMinutes]);

  // Poll the queue-backed generation status while the Minutes tab is open, so
  // members see "being generated… / failed" instead of a silent gap between a
  // meeting ending and the minutes-ready push. Only keeps polling while a job
  // is actually pending (queued/processing); one shot otherwise.
  useEffect(() => {
    if (!groupId || activeTab !== 'minutes') return undefined;

    let cancelled = false;
    let timeoutId: number | undefined;

    const fetchStatus = async () => {
      try {
        const { data } = await api.get<{ status: MinutesGenerationStatus }>(`/groups/${groupId}/minutes-status`);
        if (cancelled) return;

        const wasPending = lastMinutesStatusRef.current === 'queued' || lastMinutesStatusRef.current === 'processing';
        lastMinutesStatusRef.current = data.status;
        setMinutesStatus(data.status);

        if (wasPending && data.status === 'completed') {
          // The job finished while we watched — refresh the minutes list.
          setHasLoadedMinutes(false);
        }
        if (data.status === 'queued' || data.status === 'processing') {
          timeoutId = window.setTimeout(() => void fetchStatus(), 5000);
        }
      } catch {
        // Status is a progressive enhancement — never surface an error for it.
      }
    };

    void fetchStatus();

    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [activeTab, groupId]);

  const handleOpenMinutes = async (minutesId: string) => {
    if (!groupId) return;

    setIsMinutesModalOpen(true);
    setSelectedMinutes({ id: minutesId });
  };

  const workspaceTabRefs = useRef<{ members: HTMLButtonElement | null; minutes: HTMLButtonElement | null }>({
    members: null,
    minutes: null,
  });

  const handleWorkspaceTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;

    event.preventDefault();
    const next =
      event.key === 'Home' ? 'members' : event.key === 'End' ? 'minutes' : activeTab === 'members' ? 'minutes' : 'members';
    setActiveTab(next);
    workspaceTabRefs.current[next]?.focus();
  };

  return (
    <main className="min-h-screen app-root overflow-x-clip px-4 py-6 text-white sm:px-6 sm:py-10">
      {toastMessage && (
        <div className="fixed left-1/2 top-6 z-50 w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-full border border-amber-300/30 bg-amber-400/20 px-4 py-3 text-center text-sm font-medium text-amber-50 shadow-xl shadow-black/25 backdrop-blur-md">
          {toastMessage}
        </div>
      )}

      {minutesReadyToast && (
        <button
          type="button"
          onClick={handleOpenMinutesReadyToast}
          className="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-50 rounded-2xl border border-emerald-400/30 bg-emerald-500/15 px-4 py-3 text-left text-sm font-medium text-emerald-100 shadow-2xl shadow-black/30 transition hover:-translate-y-0.5 hover:bg-emerald-500/20 sm:inset-x-auto sm:bottom-6 sm:right-6"
        >
          Meeting summary is ready — view minutes
        </button>
      )}

      <div className="mx-auto max-w-6xl">
        <AppHeader />

        <div className="mb-6 flex items-center justify-between gap-4">
          <Link href="/groups" className="btn btn-ghost">
            <LuArrowLeft aria-hidden="true" /> All groups
          </Link>
          {activeRoomCode ? (
            <button
              type="button"
              onClick={() => router.push(`/room/${activeRoomCode}`)}
              className="btn btn-primary"
            >
              <LuVideo aria-hidden="true" /> Join meeting
            </button>
          ) : canManageGroup ? (
            <button
              type="button"
              onClick={handleStartMeeting}
              disabled={isStartingMeeting}
              className="btn btn-primary"
            >
              <LuVideo aria-hidden="true" /> {isStartingMeeting ? 'Starting…' : 'Start meeting'}
            </button>
          ) : null}
        </div>

        {isLoading ? (
          <div className="card rounded-3xl p-8 text-sm muted">Loading group...</div>
        ) : !groupId ? (
          <div className="card rounded-3xl p-8 text-sm text-red-300">Invalid group link</div>
        ) : error || !group ? (
          <div className="card rounded-3xl p-8 text-sm text-red-300">{error || 'Group not found'}</div>
        ) : (
          <div className="grid gap-8 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
            <section className="card min-w-0 rounded-3xl p-6">
              <div className="flex items-start gap-4">
                <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-3xl border border-[var(--border)] bg-white/5 font-display">
                  {group.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={group.avatar_url} alt={`${group.name} avatar`} className="h-full w-full object-cover" />
                  ) : (
                    <span className="gradient-text text-2xl font-semibold">{getInitials(group.name)}</span>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <h1 className="font-display text-3xl font-semibold tracking-tight">{group.name}</h1>
                  <p className="mt-3 text-sm leading-6 muted">
                    {group.description || 'No description provided for this group.'}
                  </p>
                </div>
              </div>

              <div className="mt-6 space-y-3 text-sm">
                <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                  <span className="muted">Members</span>
                  <span className="font-medium">{group.members.length}</span>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                  <span className="muted">Status</span>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${group.is_active ? 'bg-emerald-400/10 text-emerald-200' : 'bg-white/10 text-white/70'}`}>
                    {group.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                  <span className="muted">Your role</span>
                  <RoleBadge role={currentMember?.role ?? 'member'} />
                </div>

                {canManageGroup && (
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="inline-flex items-center gap-2 font-medium text-white">
                          <LuSparkles aria-hidden="true" className="text-[var(--accent)]" /> AI meeting summarizer
                        </p>
                        <p className="mt-1 text-sm leading-6 text-white/65">
                          Automatically transcribes and summarizes every meeting in this group
                        </p>
                      </div>

                      <label className="inline-flex cursor-pointer items-center gap-3">
                        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-white/50">
                          {group.summarizer_enabled ? 'On' : 'Off'}
                        </span>
                        <input
                          type="checkbox"
                          checked={group.summarizer_enabled}
                          onChange={(event) => void handleSummarizerToggle(event.target.checked)}
                          disabled={isSavingSettings}
                          className="peer sr-only"
                        />
                        <span
                          className={`relative h-7 w-12 rounded-full border transition ${
                            group.summarizer_enabled ? 'border-emerald-300/40 bg-emerald-400/70' : 'border-white/10 bg-white/10'
                          } ${isSavingSettings ? 'opacity-60' : ''}`}
                        >
                          <span
                            className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${
                              group.summarizer_enabled ? 'translate-x-5' : 'translate-x-0'
                            }`}
                          />
                        </span>
                      </label>
                    </div>

                    {group.summarizer_enabled ? (
                      <div className="mt-4 flex gap-2.5 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-3.5 py-3 text-sm text-amber-100">
                        <LuTriangleAlert aria-hidden="true" className="mt-0.5 shrink-0 text-base" />
                        <p className="leading-6">
                          <span className="font-semibold">Heads up:</span> audio from all meetings is uploaded and transcribed with Groq Whisper, then summarized there — it is not processed fully on-device.
                        </p>
                      </div>
                    ) : null}

                    {settingsMessage ? <p className="mt-3 text-sm text-emerald-200">{settingsMessage}</p> : null}
                  </div>
                )}
              </div>

              {activeRoomCode ? (
                <button
                  type="button"
                  onClick={() => router.push(`/room/${activeRoomCode}`)}
                  className="btn btn-primary mt-6 h-12 w-full"
                >
                  <LuVideo aria-hidden="true" /> Join meeting
                </button>
              ) : canManageGroup ? (
                <button
                  type="button"
                  onClick={handleStartMeeting}
                  disabled={isStartingMeeting}
                  className="btn btn-primary mt-6 h-12 w-full"
                >
                  <LuVideo aria-hidden="true" /> {isStartingMeeting ? 'Starting…' : 'Start meeting'}
                </button>
              ) : null}
            </section>

            <section className="card min-w-0 rounded-3xl p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight">Group workspace</h2>
                  <p className="mt-2 text-sm muted">Switch between member management and AI-generated meeting minutes.</p>
                </div>
              </div>

              <div
                role="tablist"
                aria-label="Group workspace sections"
                onKeyDown={handleWorkspaceTabKeyDown}
                className="mt-6 grid grid-cols-2 rounded-xl border border-white/10 bg-white/5 p-1 sm:inline-flex"
              >
                <button
                  ref={(element) => {
                    workspaceTabRefs.current.members = element;
                  }}
                  type="button"
                  role="tab"
                  id="workspace-tab-members"
                  aria-selected={activeTab === 'members'}
                  aria-controls="workspace-panel-members"
                  tabIndex={activeTab === 'members' ? 0 : -1}
                  onClick={() => setActiveTab('members')}
                  className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                    activeTab === 'members' ? 'bg-white text-slate-900' : 'text-white/75 hover:text-white'
                  }`}
                >
                  Members
                </button>
                <button
                  ref={(element) => {
                    workspaceTabRefs.current.minutes = element;
                  }}
                  type="button"
                  role="tab"
                  id="workspace-tab-minutes"
                  aria-selected={activeTab === 'minutes'}
                  aria-controls="workspace-panel-minutes"
                  tabIndex={activeTab === 'minutes' ? 0 : -1}
                  onClick={() => setActiveTab('minutes')}
                  className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                    activeTab === 'minutes' ? 'bg-white text-slate-900' : 'text-white/75 hover:text-white'
                  }`}
                >
                  Minutes
                </button>
              </div>

              {activeTab === 'members' ? (
                <div role="tabpanel" id="workspace-panel-members" aria-labelledby="workspace-tab-members">
                  <div className="mt-6 space-y-3">
                    {group.members.map((member) => {
                      const isSelf = member.user_id === currentUserId;
                      const isOwnerMember = member.role === 'owner';
                      const canRemove = Boolean(canManageGroup && !isSelf && !isOwnerMember);
                      const canToggleAdmin = Boolean(isOwner && !isSelf && !isOwnerMember);

                      return (
                        <div key={member.id} className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-4 md:flex-row md:items-center md:justify-between">
                          <div className="flex min-w-0 items-center gap-4">
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/5">
                              {member.avatar_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={member.avatar_url} alt={`${member.display_name} avatar`} className="h-full w-full object-cover" />
                              ) : (
                                <span className="text-sm font-semibold">{getInitials(member.display_name)}</span>
                              )}
                            </div>

                            <div className="min-w-0">
                              <p className="truncate font-semibold text-white">{member.display_name}</p>
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <RoleBadge role={member.role} />
                                {isSelf && <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">You</span>}
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-3">
                            {canToggleAdmin && (
                              <button
                                type="button"
                                onClick={() => handleToggleAdmin(member)}
                                disabled={isActionPending}
                                className="btn rounded-xl px-4 py-2 text-sm font-medium"
                              >
                                {member.role === 'admin' ? 'Revoke admin' : 'Make admin'}
                              </button>
                            )}

                            {canRemove && (
                              <button
                                type="button"
                                onClick={() => handleRemoveMember(member.user_id)}
                                disabled={isActionPending}
                                className="btn-danger rounded-xl px-4 py-2 text-sm font-semibold"
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <form onSubmit={handleInviteMember} className="mt-6 border-t border-white/10 pt-6">
                    <label htmlFor="invite-email" className="mb-2 block text-sm font-medium text-white/85">
                      Invite member
                    </label>
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <input
                        id="invite-email"
                        type="email"
                        value={inviteForm.email}
                        onChange={(e) => setInviteForm({ email: e.target.value })}
                        placeholder="search by email"
                        className="auth-input sm:flex-1"
                      />
                      <button type="submit" disabled={isInviting} className="btn btn-primary h-12">
                        <LuUserPlus aria-hidden="true" /> {isInviting ? 'Inviting…' : 'Invite'}
                      </button>
                    </div>
                    {inviteMessage && <p className="mt-3 text-sm text-emerald-200">{inviteMessage}</p>}
                  </form>
                </div>
              ) : (
                <div role="tabpanel" id="workspace-panel-minutes" aria-labelledby="workspace-tab-minutes" className="mt-6">
                  {groupId && <GroupAskCard groupId={groupId} onOpenMinutes={(id) => void handleOpenMinutes(id)} />}
                  {(minutesStatus === 'queued' || minutesStatus === 'processing') && (
                    <div className="mb-4 flex items-center gap-2.5 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm font-medium text-amber-100">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-amber-300" aria-hidden="true" />
                      Minutes for the latest meeting are being generated…
                    </div>
                  )}
                  {minutesStatus === 'failed' && (
                    <div className="mb-4 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                      Minutes generation for the latest meeting failed after multiple retries.
                    </div>
                  )}
                  {isMinutesLoading ? (
                    <div className="space-y-3">
                      {[0, 1].map((n) => (
                        <div key={n} className="flex items-center gap-3.5 rounded-2xl border border-[var(--border)] bg-white/[0.03] p-4">
                          <div className="skeleton h-11 w-11 rounded-xl" />
                          <div className="flex-1 space-y-2"><div className="skeleton h-4 w-40" /><div className="skeleton h-3 w-56" /></div>
                        </div>
                      ))}
                    </div>
                  ) : minutesError ? (
                    <p className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{minutesError}</p>
                  ) : minutes.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed px-5 py-12 text-center" style={{ borderColor: 'var(--border-strong)' }}>
                      <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--border)] bg-white/5 text-xl text-violet-200">
                        <LuFileText aria-hidden="true" />
                      </span>
                      <p className="text-sm muted">No meeting minutes yet. They&apos;ll appear here after a summarized meeting.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {minutes.map((minute) => (
                        <MinutesCard
                          key={minute.id}
                          title={minute.title}
                          createdAt={minute.created_at}
                          durationSeconds={minute.duration_seconds}
                          participantCount={minute.participant_count}
                          onClick={() => void handleOpenMinutes(minute.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>
        )}

        {actionError && (
          <div className="mt-6 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {actionError}
          </div>
        )}
      </div>

      <MinutesModal
        isOpen={isMinutesModalOpen}
        source={groupId && selectedMinutes?.id ? { kind: 'group', groupId, minutesId: selectedMinutes.id } : null}
        onClose={() => {
          setIsMinutesModalOpen(false);
          setSelectedMinutes(null);
        }}
      />
    </main>
  );
}
