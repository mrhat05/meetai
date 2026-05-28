'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import api from '@/lib/api';
import useGroupMeetingAlert from '@/hooks/useGroupMeetingAlert';
import GroupCard from '@/components/GroupCard';

type DashboardOverview = {
  totalRooms: number;
  activeRooms: number;
  completedRooms: number;
  totalParticipants: number;
  totalMessages: number;
  averageDurationMinutes: number;
  longestDurationMinutes: number;
};

type RecentMeeting = {
  id: string;
  roomCode: string;
  name: string | null;
  createdAt: string;
  endedAt: string | null;
  isActive: boolean;
  participantCount: number;
  messageCount: number;
  durationMinutes: number;
  hostName: string;
};

type DashboardSummaryResponse = {
  overview: DashboardOverview;
  latestMeeting: {
    roomCode: string;
    createdAt: string;
    endedAt: string | null;
    isActive: boolean;
  } | null;
  recentMeetings: RecentMeeting[];
};

type GroupListItem = {
  id: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  created_by: string | null;
  created_at: string;
  is_active: boolean;
  active_room_code: string | null;
  role: 'owner' | 'admin' | 'member';
  member_count: number;
  is_meeting_active: boolean;
};

function formatDateTime(value: string) {
  return new Date(value).toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function formatDuration(minutes: number) {
  if (!minutes) return '0m';

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours === 0) return `${remainingMinutes}m`;
  if (remainingMinutes === 0) return `${hours}h`;
  return `${hours}h ${remainingMinutes}m`;
}

export default function DashboardPage() {
  const router = useRouter();
  const { activeMeetingAlert, dismissAlert } = useGroupMeetingAlert();
  const [roomCode, setRoomCode] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [createdRoomCode, setCreatedRoomCode] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<DashboardSummaryResponse | null>(null);
  const [isSummaryLoading, setIsSummaryLoading] = useState(true);
  const [groups, setGroups] = useState<GroupListItem[]>([]);
  const [isGroupsLoading, setIsGroupsLoading] = useState(true);
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [groupError, setGroupError] = useState<string | null>(null);

  useEffect(() => {
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
  }, []);

  const metricCards = useMemo(() => {
    const overview = summary?.overview;

    return [
      { label: 'Total meetings', value: overview?.totalRooms ?? 0 },
      { label: 'Active meetings', value: overview?.activeRooms ?? 0 },
      { label: 'Completed meetings', value: overview?.completedRooms ?? 0 },
      { label: 'Participants joined', value: overview?.totalParticipants ?? 0 },
      { label: 'Messages sent', value: overview?.totalMessages ?? 0 },
      { label: 'Avg duration', value: formatDuration(overview?.averageDurationMinutes ?? 0) },
      { label: 'Longest meeting', value: formatDuration(overview?.longestDurationMinutes ?? 0) },
    ];
  }, [summary]);

  const handleCreateRoom = async () => {
    try {
      setIsCreating(true);
      setError(null);
      setCopyStatus(null);

      const response = await api.post('/rooms/create');
      const newRoomCode = response.data.room.roomCode;
      const newInviteLink =
        response.data.joinUrl ??
        `${window.location.origin}/room/${newRoomCode}`;

      setCreatedRoomCode(newRoomCode);
      setInviteLink(newInviteLink);
      setIsCreating(false);
    } catch (err: any) {
      console.error('Error creating room:', err);
      setError(err.response?.data?.error || 'Failed to create room');
      setIsCreating(false);
    }
  };

  const handleCopyInviteLink = async () => {
    if (!inviteLink) return;

    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopyStatus('Invite link copied');
    } catch (err: any) {
      console.error('Failed to copy invite link:', err);
      setCopyStatus('Unable to copy link');
    }
  };

  const handleJoinCreatedRoom = () => {
    if (!createdRoomCode) return;
    router.push(`/room/${createdRoomCode}`);
  };

  const handleOpenProfile = () => {
    router.push('/profile');
  };

  const handleJoinRoom = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!roomCode.trim()) {
      setError('Please enter a room code');
      return;
    }

    try {
      setIsJoining(true);
      setError(null);

      router.push(`/room/${roomCode.trim()}`);
    } catch (err: any) {
      console.error('Error joining room:', err);
      setError('Failed to join room');
      setIsJoining(false);
    }
  };

  const handleLogout = () => {
    window.localStorage.removeItem('accessToken');
    window.localStorage.removeItem('displayName');
    window.localStorage.removeItem('userName');
    window.localStorage.removeItem('userEmail');
    window.localStorage.removeItem('avatarUrl');
    router.push('/login');
  };

  const handleOpenGroupModal = () => {
    setGroupError(null);
    setIsCreateGroupOpen(true);
  };

  const handleCloseGroupModal = () => {
    if (isCreatingGroup) return;
    setIsCreateGroupOpen(false);
    setGroupName('');
    setGroupDescription('');
    setGroupError(null);
  };

  const handleCreateGroup = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const normalizedName = groupName.trim();
    if (!normalizedName) {
      setGroupError('Group name is required');
      return;
    }

    try {
      setIsCreatingGroup(true);
      setGroupError(null);

      await api.post('/groups', {
        name: normalizedName,
        description: groupDescription.trim(),
      });

      const { data } = await api.get<GroupListItem[]>('/groups');
      setGroups(data);
      handleCloseGroupModal();
    } catch (createError: any) {
      console.error('Failed to create group:', createError);
      setGroupError(createError.response?.data?.error || 'Failed to create group');
    } finally {
      setIsCreatingGroup(false);
    }
  };

  return (
    <main className="min-h-screen app-root px-6 py-10">
      <div className="mx-auto max-w-6xl">
        {activeMeetingAlert && (
          <div className="mb-6 flex w-full items-center justify-between gap-4 rounded-2xl border border-amber-300/40 bg-amber-400/20 px-4 py-4 text-amber-50 shadow-lg shadow-amber-950/10">
            <p className="min-w-0 text-sm sm:text-base">
              <span className="font-semibold text-amber-100">{activeMeetingAlert.groupName}</span> meeting is live — join now
            </p>

            <div className="flex shrink-0 items-center gap-3">
              <button
                type="button"
                onClick={() => router.push(`/room/${activeMeetingAlert.roomCode}`)}
                className="rounded-xl bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-950 shadow-sm transition hover:bg-white"
              >
                Join
              </button>
              <button
                type="button"
                onClick={dismissAlert}
                className="rounded-full p-2 text-amber-100 transition hover:bg-amber-300/20 hover:text-white"
                aria-label="Dismiss meeting alert"
              >
                x
              </button>
            </div>
          </div>
        )}

        <div className="mb-10 rounded-3xl card p-6 md:p-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-300/80">
                Dashboard
              </p>
              <h1 className="mt-4 text-4xl font-semibold tracking-tight">Welcome to MeetAI</h1>
              <p className="mt-4 max-w-2xl text-base leading-7 muted">
                See your meeting history, duration, timestamps, and participation metrics in one place.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={handleOpenProfile} className="btn btn-primary">Profile</button>
              <button type="button" onClick={handleLogout} className="btn btn-ghost">Log out</button>
            </div>
          </div>
        </div>

        <div className="mb-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {metricCards.map((metric) => (
            <div key={metric.label} className="card rounded-2xl p-5">
              <p className="text-sm muted">{metric.label}</p>
              <p className="mt-3 text-3xl font-semibold tracking-tight">{isSummaryLoading ? '...' : metric.value}</p>
            </div>
          ))}
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-red-400">
            {error}
          </div>
        )}

        {inviteLink && (
          <div className="mb-6 card p-4">
            <p className="text-sm" style={{ color: 'var(--accent)' }}>Meeting created. Share this link:</p>
            <p className="mt-2 break-all rounded-lg tile px-3 py-2 text-sm" style={{ color: 'var(--accent)' }}>{inviteLink}</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <button type="button" onClick={handleCopyInviteLink} className="btn-primary h-12 w-full rounded-xl px-5">
                Copy Link
              </button>
              <button type="button" onClick={handleJoinCreatedRoom} className="btn h-12 w-full rounded-xl px-5">
                Join Now
              </button>
              {copyStatus && <p className="self-center text-sm" style={{ color: 'var(--accent)' }}>{copyStatus}</p>}
            </div>
          </div>
        )}

        {/* Main Actions */}
        <div className="grid gap-8 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          {/* New Meeting Card */}
          <div className="card p-8">
            <div className="mb-6">
              <div className="inline-block rounded-lg bg-cyan-500/20 p-3">
                <span className="text-2xl">🚀</span>
              </div>
            </div>
            <h2 className="text-2xl font-bold mb-3">New Meeting</h2>
            <p className="muted mb-6">Create a new meeting room and get a unique invite link to share with others.</p>
            <button onClick={handleCreateRoom} disabled={isCreating} className="btn-primary h-12 w-full rounded-xl px-5">
              {isCreating ? 'Creating...' : 'Make'}
            </button>
          </div>

          {/* Join Meeting Card */}
          <div className="card p-8">
            <div className="mb-6">
              <div className="inline-block rounded-lg bg-purple-500/20 p-3">
                <span className="text-2xl">🔗</span>
              </div>
            </div>
            <h2 className="text-2xl font-bold mb-3">Join Meeting</h2>
            <p className="muted mb-6">Enter a room code to join an existing meeting.</p>
            <form onSubmit={handleJoinRoom} className="flex flex-col gap-4">
              <input
                type="text"
                placeholder="Enter room code..."
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toLowerCase())}
                maxLength={10}
                disabled={isJoining}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="auth-input"
              />
              <button type="submit" disabled={isJoining || !roomCode.trim()} className="btn-primary h-12 w-full rounded-xl px-5">
                {isJoining ? 'Joining...' : 'Join Meeting'}
              </button>
            </form>
          </div>
        </div>

        <div className="mt-10 card p-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-xl font-bold">Recent Meetings</h3>
              <p className="mt-2 muted">Timestamp, duration, and participation details from your latest meetings.</p>
            </div>
          </div>

          <div className="mt-6 overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--border)' }}>
            <div className="grid grid-cols-12 gap-4 border-b px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] muted" style={{ borderColor: 'var(--border)' }}>
              <div className="col-span-3">Room</div>
              <div className="col-span-3">Created</div>
              <div className="col-span-2">Duration</div>
              <div className="col-span-2">People</div>
              <div className="col-span-2">State</div>
            </div>

            {isSummaryLoading ? (
              <div className="px-4 py-8 text-sm muted">Loading meeting history...</div>
            ) : summary?.recentMeetings.length ? (
              summary.recentMeetings.map((meeting) => (
                <div key={meeting.id} className="grid grid-cols-12 gap-4 border-b px-4 py-4 text-sm last:border-b-0" style={{ borderColor: 'var(--border)' }}>
                  <div className="col-span-3">
                    <p className="font-medium text-white">{meeting.name || `Room ${meeting.roomCode}`}</p>
                    <p className="text-xs muted">Hosted by {meeting.hostName}</p>
                  </div>
                  <div className="col-span-3 muted">{formatDateTime(meeting.createdAt)}</div>
                  <div className="col-span-2 muted">{meeting.isActive ? 'Active' : formatDuration(meeting.durationMinutes)}</div>
                  <div className="col-span-2 muted">{meeting.participantCount} participants</div>
                  <div className="col-span-2">
                    <span className="rounded-full px-3 py-1 text-xs font-semibold" style={{ background: meeting.isActive ? 'rgba(36,208,198,0.10)' : 'rgba(108,92,231,0.12)', color: meeting.isActive ? 'var(--accent)' : 'var(--foreground)' }}>
                      {meeting.isActive ? 'Live' : 'Ended'}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="px-4 py-8 text-sm muted">No meetings yet. Create or join a meeting to get started.</div>
            )}
          </div>
        </div>

        <div className="mt-10 card p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-xl font-bold">Groups</h3>
              <p className="mt-2 muted">Your groups, member counts, roles, and live meeting status.</p>
            </div>

            <button type="button" onClick={handleOpenGroupModal} className="btn-primary h-11 rounded-xl px-5 font-semibold">
              New group
            </button>
          </div>

          <div className="mt-6">
            {isGroupsLoading ? (
              <div className="px-1 py-8 text-sm muted">Loading groups...</div>
            ) : groups.length ? (
              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {groups.map((group) => (
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
            ) : (
              <div className="rounded-2xl border border-dashed px-5 py-10 text-sm muted" style={{ borderColor: 'var(--border)' }}>
                No groups yet. Create your first group to start organizing meetings.
              </div>
            )}
          </div>
        </div>
      </div>

      {isCreateGroupOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-(--surface) p-6 shadow-2xl shadow-black/40">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-2xl font-semibold tracking-tight">New group</h3>
                <p className="mt-2 text-sm muted">Create a group with a name and short description.</p>
              </div>
              <button
                type="button"
                onClick={handleCloseGroupModal}
                className="rounded-full p-2 text-white/70 transition hover:bg-white/10 hover:text-white"
                aria-label="Close create group modal"
              >
                x
              </button>
            </div>

            <form onSubmit={handleCreateGroup} className="mt-6 space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-white/85" htmlFor="group-name">
                  Name
                </label>
                <input
                  id="group-name"
                  type="text"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="Design team"
                  maxLength={100}
                  className="auth-input"
                  autoFocus
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-white/85" htmlFor="group-description">
                  Description
                </label>
                <textarea
                  id="group-description"
                  value={groupDescription}
                  onChange={(e) => setGroupDescription(e.target.value)}
                  placeholder="Keep your team aligned on weekly meetings and project updates."
                  rows={4}
                  maxLength={500}
                  className="auth-input resize-none"
                />
              </div>

              {groupError && (
                <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                  {groupError}
                </div>
              )}

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button type="button" onClick={handleCloseGroupModal} className="btn h-11 rounded-xl px-5">
                  Cancel
                </button>
                <button type="submit" disabled={isCreatingGroup} className="btn-primary h-11 rounded-xl px-5 font-semibold">
                  {isCreatingGroup ? 'Creating...' : 'Create group'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
