'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import api from '@/lib/api';
import RoleBadge from '@/components/RoleBadge';
import MinutesCard from '@/components/MinutesCard';
import MinutesModal from '@/components/MinutesModal';
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

export default function GroupDetailPage() {
  const router = useRouter();
  const params = useParams<{ groupId?: string | string[] }>();
  const groupId = Array.isArray(params.groupId) ? params.groupId[0] : params.groupId;
  const { minutesReadyAlert } = useGroupMeetingAlert();
  const [group, setGroup] = useState<GroupDetails | null>(null);
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

  useEffect(() => {
    const accessToken = window.localStorage.getItem('accessToken');
    if (!accessToken) {
      setCurrentUserId(null);
      return;
    }

    const decoded = decodeJwtPayload(accessToken);
    setCurrentUserId(decoded?.userId ?? null);
  }, []);

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
  };

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

      setGroup(data);
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

  const handleOpenMinutes = async (minutesId: string) => {
    if (!groupId) return;

    setIsMinutesModalOpen(true);
    setSelectedMinutes({ id: minutesId });
  };

  return (
    <main className="min-h-screen app-root px-6 py-10 text-white">
      {toastMessage && (
        <div className="fixed left-1/2 top-6 z-50 -translate-x-1/2 rounded-full border border-amber-300/30 bg-amber-400/20 px-4 py-3 text-sm font-medium text-amber-50 shadow-xl shadow-black/25 backdrop-blur-md">
          {toastMessage}
        </div>
      )}

      {minutesReadyToast && (
        <button
          type="button"
          onClick={handleOpenMinutesReadyToast}
          className="fixed bottom-6 right-6 z-50 rounded-2xl border border-emerald-400/30 bg-emerald-500/15 px-4 py-3 text-left text-sm font-medium text-emerald-100 shadow-2xl shadow-black/30 transition hover:-translate-y-0.5 hover:bg-emerald-500/20"
        >
          Meeting summary is ready — view minutes
        </button>
      )}

      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex items-center justify-between gap-4">
          <Link href="/dashboard" className="btn btn-ghost rounded-xl px-4 py-2">
            ← Back
          </Link>
          {canManageGroup && (
            <button
              type="button"
              onClick={handleStartMeeting}
              disabled={isStartingMeeting}
              className="btn-primary rounded-xl px-5 py-3 font-semibold"
            >
              {isStartingMeeting ? 'Starting...' : 'Start meeting'}
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="card rounded-3xl p-8 text-sm muted">Loading group...</div>
        ) : !groupId ? (
          <div className="card rounded-3xl p-8 text-sm text-red-300">Invalid group link</div>
        ) : error || !group ? (
          <div className="card rounded-3xl p-8 text-sm text-red-300">{error || 'Group not found'}</div>
        ) : (
          <div className="grid gap-8 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
            <section className="card rounded-3xl p-6">
              <div className="flex items-start gap-4">
                <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-3xl border border-white/10 bg-white/5">
                  {group.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={group.avatar_url} alt={`${group.name} avatar`} className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-2xl font-semibold">{getInitials(group.name)}</span>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <h1 className="text-3xl font-semibold tracking-tight">{group.name}</h1>
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
                        <p className="font-medium text-white">AI meeting summarizer</p>
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
                      <div className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-3 py-3 text-sm text-amber-100">
                        <p className="font-medium">Warning</p>
                        <p className="mt-1 leading-6">
                          Audio from all meetings will be uploaded to the server and transcribed with Groq Whisper, then summarized there.
                          Audio is not processed fully locally.
                        </p>
                      </div>
                    ) : null}

                    {settingsMessage ? <p className="mt-3 text-sm text-emerald-200">{settingsMessage}</p> : null}
                  </div>
                )}
              </div>

              {canManageGroup && (
                <button
                  type="button"
                  onClick={handleStartMeeting}
                  disabled={isStartingMeeting}
                  className="mt-6 btn-primary h-12 w-full rounded-xl px-5 font-semibold"
                >
                  {isStartingMeeting ? 'Starting...' : 'Start meeting'}
                </button>
              )}
            </section>

            <section className="card rounded-3xl p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight">Group workspace</h2>
                  <p className="mt-2 text-sm muted">Switch between member management and AI-generated meeting minutes.</p>
                </div>
              </div>

              <div className="mt-6 inline-flex rounded-xl border border-white/10 bg-white/5 p-1">
                <button
                  type="button"
                  onClick={() => setActiveTab('members')}
                  className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                    activeTab === 'members' ? 'bg-white text-slate-900' : 'text-white/75 hover:text-white'
                  }`}
                >
                  Members
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('minutes')}
                  className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                    activeTab === 'minutes' ? 'bg-white text-slate-900' : 'text-white/75 hover:text-white'
                  }`}
                >
                  Minutes
                </button>
              </div>

              {activeTab === 'members' ? (
                <>
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
                      <button type="submit" disabled={isInviting} className="btn-primary h-12 rounded-xl px-5 font-semibold">
                        {isInviting ? 'Inviting...' : 'Invite'}
                      </button>
                    </div>
                    {inviteMessage && <p className="mt-3 text-sm text-emerald-200">{inviteMessage}</p>}
                  </form>
                </>
              ) : (
                <div className="mt-6">
                  {isMinutesLoading ? (
                    <p className="text-sm muted">Loading minutes...</p>
                  ) : minutesError ? (
                    <p className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">{minutesError}</p>
                  ) : minutes.length === 0 ? (
                    <p className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm muted">No meeting minutes yet.</p>
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
        groupId={groupId ?? ''}
        minutesId={selectedMinutes?.id ?? null}
        onClose={() => {
          setIsMinutesModalOpen(false);
          setSelectedMinutes(null);
        }}
      />
    </main>
  );
}
