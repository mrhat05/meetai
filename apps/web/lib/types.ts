export type DashboardOverview = {
  totalRooms: number;
  activeRooms: number;
  completedRooms: number;
  totalParticipants: number;
  totalMessages: number;
  averageDurationMinutes: number;
  longestDurationMinutes: number;
};

export type RecentMeeting = {
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

export type MyMinutesItem = {
  roomCode: string;
  title: string;
  createdAt: string;
  minutesId: string;
  isGroup: boolean;
};

export type DashboardSummaryResponse = {
  overview: DashboardOverview;
  latestMeeting: {
    roomCode: string;
    createdAt: string;
    endedAt: string | null;
    isActive: boolean;
  } | null;
  recentMeetings: RecentMeeting[];
  myMinutes?: MyMinutesItem[];
};

export type GroupListItem = {
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
