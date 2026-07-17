import { Router } from 'express';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import db from '../../db.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { sendMeetingStartedEmail } from '../../lib/mailer.js';
import { emitToUser } from '../socket/presence.ts';
import { answerMinutesQuestion, type QaHistoryTurn } from '../services/minutesQaService.ts';
import { minutesQueue } from '../queue/minutesQueue.ts';

const router = Router();

type CreateGroupBody = {
  name?: string;
  description?: string;
};

type UpdateGroupBody = {
  name?: string;
  description?: string | null;
  summarizer_enabled?: boolean;
};

type GroupResponse = {
  id: string;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  createdBy: string | null;
  createdAt: Date;
  isActive: boolean;
};

type GroupListItem = {
  id: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  created_by: string | null;
  created_at: Date;
  is_active: boolean;
  active_room_code: string | null;
  role: 'owner' | 'admin' | 'member';
  member_count: number;
  is_meeting_active: boolean;
};

type GroupDetails = {
  id: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  created_by: string | null;
  created_at: Date;
  is_active: boolean;
  summarizer_enabled: boolean;
  // Present on GET /:groupId (derived from the active room); omitted by PATCH.
  active_room_code?: string | null;
  is_meeting_active?: boolean;
};

type GroupMemberItem = {
  id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member';
  joined_at: Date;
  display_name: string;
  avatar_url: string | null;
};

type GroupMinuteListItem = {
  id: string;
  title: string;
  created_at: Date;
  duration_seconds: number;
  participant_count: number;
};

type ActionItem = {
  id: string;
  task: string;
  assignee: string | null;
  due: string | null;
  done: boolean;
};

type GroupMinuteDetail = {
  id: string;
  room_id: string;
  group_id: string;
  created_by: string | null;
  title: string;
  raw_transcript: string;
  summary_markdown: string;
  duration_seconds: number;
  participant_count: number;
  action_items: ActionItem[];
  created_at: Date;
};

type AddGroupMemberBody = {
  email?: string;
};

type GroupMemberInsertResult = {
  id: string;
  group_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member';
  joined_at: Date;
};

type UserLookupResult = {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
};

type UpdateGroupMemberRoleBody = {
  role?: 'admin' | 'member';
};

type GroupMeetingRoom = {
  id: string;
  host_id: string | null;
  group_id: string | null;
  room_code: string;
  name: string | null;
  is_active: boolean;
  created_at: Date;
  ended_at: Date | null;
};

type GroupMemberOnlineStatus = {
  user_id: string;
  is_online: boolean;
};

type GroupMemberUserId = {
  user_id: string;
};

type MeetingNotificationRecipient = {
  id: string;
  email: string;
  display_name: string;
};

type MeetingAnnouncementContext = {
  group_name: string;
  display_name: string;
};

function generateGroupMeetingRoomCode() {
  return randomUUID().replace(/-/g, '').slice(0, 10);
}

// GET /groups — Fetch groups for current user with role, member count, and meeting state
router.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;

    const groups = await db.$queryRaw<GroupListItem[]>`
      SELECT
        g."id",
        g."name",
        g."description",
        g."avatar_url",
        g."created_by",
        g."created_at",
        g."is_active",
        active_room."room_code" AS "active_room_code",
        gm."role",
        COUNT(gm_all."id")::int AS "member_count",
        active_room."room_code" IS NOT NULL AS "is_meeting_active"
      FROM "groups" g
      INNER JOIN "group_members" gm
        ON gm."group_id" = g."id"
       AND gm."user_id" = ${userId}::uuid
      LEFT JOIN "group_members" gm_all
        ON gm_all."group_id" = g."id"
      LEFT JOIN LATERAL (
        SELECT r."room_code"
        FROM "rooms" r
        WHERE r."group_id" = g."id"
          AND r."is_active" = true
        ORDER BY r."created_at" DESC
        LIMIT 1
      ) active_room ON true
      GROUP BY
        g."id",
        g."name",
        g."description",
        g."avatar_url",
        g."created_by",
        g."created_at",
        g."is_active",
        active_room."room_code",
        gm."role"
      ORDER BY g."created_at" DESC
    `;

    return res.json(groups);
  } catch (error) {
    console.error('Error fetching groups:', error);
    return res.status(500).json({ error: 'Failed to fetch groups' });
  }
});

// GET /groups/:groupId — Fetch one group and all members if requester is a member
router.get('/:groupId', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { groupId } = req.params as { groupId: string };
    const userId = req.user!.userId;

    const memberships = await db.$queryRaw<Array<{ id: string }>>`
      SELECT gm."id"
      FROM "group_members" gm
      WHERE gm."group_id"::text = ${groupId}
        AND gm."user_id"::text = ${userId}
      LIMIT 1
    `;

    if (!memberships[0]) {
      return res.status(403).json({ error: 'Forbidden: you are not a member of this group' });
    }

    const groups = await db.$queryRaw<GroupDetails[]>`
      SELECT
        g."id",
        g."name",
        g."description",
        g."avatar_url",
        g."created_by",
        g."created_at",
        g."is_active",
        g."summarizer_enabled",
        active_room."room_code" AS "active_room_code",
        active_room."room_code" IS NOT NULL AS "is_meeting_active"
      FROM "groups" g
      LEFT JOIN LATERAL (
        SELECT r."room_code"
        FROM "rooms" r
        WHERE r."group_id" = g."id"
          AND r."is_active" = true
        ORDER BY r."created_at" DESC
        LIMIT 1
      ) active_room ON true
      WHERE g."id"::text = ${groupId}
      LIMIT 1
    `;

    const group = groups[0];
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const members = await db.$queryRaw<GroupMemberItem[]>`
      SELECT
        gm."id",
        gm."user_id",
        gm."role",
        gm."joined_at",
        u."display_name",
        u."avatar_url"
      FROM "group_members" gm
      INNER JOIN "users" u ON u."id" = gm."user_id"
      WHERE gm."group_id"::text = ${groupId}
      ORDER BY
        CASE gm."role"
          WHEN 'owner' THEN 1
          WHEN 'admin' THEN 2
          ELSE 3
        END,
        gm."joined_at" ASC
    `;

    return res.json({
      ...group,
      members,
    });
  } catch (error) {
    console.error('Error fetching group details:', error);
    return res.status(500).json({ error: 'Failed to fetch group details' });
  }
});

// PATCH /groups/:groupId — Update group settings (owner/admin only)
router.patch('/:groupId', authMiddleware, async (req: Request<{ groupId: string }, {}, UpdateGroupBody>, res: Response) => {
  try {
    const { groupId } = req.params;
    const requesterId = req.user!.userId;
    const hasName = Object.prototype.hasOwnProperty.call(req.body, 'name');
    const hasDescription = Object.prototype.hasOwnProperty.call(req.body, 'description');
    const hasSummarizerEnabled = Object.prototype.hasOwnProperty.call(req.body, 'summarizer_enabled');
    const { name, description, summarizer_enabled: summarizerEnabled } = req.body;

    if (!hasName && !hasDescription && !hasSummarizerEnabled) {
      return res.status(400).json({ error: 'At least one field must be provided' });
    }

    if (hasName && (typeof name !== 'string' || !name.trim())) {
      return res.status(400).json({ error: 'name must be a non-empty string' });
    }

    if (hasDescription && description !== null && typeof description !== 'string') {
      return res.status(400).json({ error: 'description must be a string or null' });
    }

    if (hasSummarizerEnabled && typeof summarizerEnabled !== 'boolean') {
      return res.status(400).json({ error: 'summarizer_enabled must be a boolean' });
    }

    const requesterRoleRows = await db.$queryRaw<Array<{ role: 'owner' | 'admin' }>>`
      SELECT gm."role"
      FROM "group_members" gm
      WHERE gm."group_id"::text = ${groupId}
        AND gm."user_id"::text = ${requesterId}
        AND gm."role" IN ('owner', 'admin')
      LIMIT 1
    `;

    if (!requesterRoleRows[0]) {
      return res.status(403).json({ error: 'Forbidden: only owner or admin can update group settings' });
    }

    const updatedRows = await db.$queryRaw<GroupDetails[]>`
      UPDATE "groups"
      SET
        "name" = CASE WHEN ${hasName} THEN ${name?.trim() ?? ''} ELSE "name" END,
        "description" = CASE WHEN ${hasDescription} THEN ${description ?? null} ELSE "description" END,
        "summarizer_enabled" = CASE WHEN ${hasSummarizerEnabled} THEN ${summarizerEnabled ?? false} ELSE "summarizer_enabled" END
      WHERE "id"::text = ${groupId}
      RETURNING
        "id",
        "name",
        "description",
        "avatar_url",
        "created_by",
        "created_at",
        "is_active",
        "summarizer_enabled"
    `;

    const updatedGroup = updatedRows[0];
    if (!updatedGroup) {
      return res.status(404).json({ error: 'Group not found' });
    }

    return res.json(updatedGroup);
  } catch (error: any) {
    console.error('Error updating group settings:', error);
    if (error?.code === '22P02') {
      return res.status(400).json({ error: 'Invalid group id' });
    }
    return res.status(500).json({ error: 'Failed to update group settings' });
  }
});

// GET /groups/:groupId/minutes — Fetch lightweight minutes list for group members
router.get('/:groupId/minutes', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { groupId } = req.params as { groupId: string };
    const userId = req.user!.userId;

    const memberships = await db.$queryRaw<Array<{ id: string }>>`
      SELECT gm."id"
      FROM "group_members" gm
      WHERE gm."group_id"::text = ${groupId}
        AND gm."user_id"::text = ${userId}
      LIMIT 1
    `;

    if (!memberships[0]) {
      return res.status(403).json({ error: 'Forbidden: you are not a member of this group' });
    }

    const minutes = await db.$queryRaw<GroupMinuteListItem[]>`
      SELECT
        mm."id",
        mm."title",
        mm."created_at",
        mm."duration_seconds",
        mm."participant_count"
      FROM "meeting_minutes" mm
      WHERE mm."group_id"::text = ${groupId}
      ORDER BY mm."created_at" DESC
    `;

    return res.json(minutes);
  } catch (error: any) {
    console.error('Error fetching group minutes:', error);
    if (error?.code === '22P02') {
      return res.status(400).json({ error: 'Invalid group id' });
    }
    return res.status(500).json({ error: 'Failed to fetch group minutes' });
  }
});

// GET /groups/:groupId/minutes-status — Generation status of the group's most
// recently ended meeting: idle | queued | processing | completed | failed.
// Truth is layered: the DB row is authoritative for "completed"; otherwise the
// BullMQ job (jobId = roomId) is asked for its state. A room that ended
// without a summary job (plain /end, summarizer off) reads as idle.
router.get('/:groupId/minutes-status', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { groupId } = req.params as { groupId: string };
    const userId = req.user!.userId;

    const memberships = await db.$queryRaw<Array<{ id: string }>>`
      SELECT gm."id"
      FROM "group_members" gm
      WHERE gm."group_id"::text = ${groupId}
        AND gm."user_id"::text = ${userId}
      LIMIT 1
    `;

    if (!memberships[0]) {
      return res.status(403).json({ error: 'Forbidden: you are not a member of this group' });
    }

    const recentRooms = await db.$queryRaw<Array<{ id: string; room_code: string }>>`
      SELECT r."id", r."room_code"
      FROM "rooms" r
      WHERE r."group_id"::text = ${groupId}
        AND r."ended_at" IS NOT NULL
        AND r."ended_at" > NOW() - INTERVAL '24 hours'
      ORDER BY r."ended_at" DESC
      LIMIT 1
    `;

    const recentRoom = recentRooms[0];
    if (!recentRoom) {
      return res.json({ status: 'idle' });
    }

    const minutesRows = await db.$queryRaw<Array<{ id: string }>>`
      SELECT mm."id" FROM "meeting_minutes" mm WHERE mm."room_id" = ${recentRoom.id}::uuid LIMIT 1
    `;
    if (minutesRows[0]) {
      return res.json({ status: 'completed', roomCode: recentRoom.room_code, minutesId: minutesRows[0].id });
    }

    const job = await minutesQueue.getJob(recentRoom.id);
    if (!job) {
      return res.json({ status: 'idle' });
    }

    const state = await job.getState();
    const status =
      state === 'active'
        ? 'processing'
        : state === 'failed'
          ? 'failed'
          : state === 'completed'
            ? 'processing' // job done but row not visible yet — next poll resolves it
            : 'queued'; // waiting | delayed (between backoff retries) | prioritized

    return res.json({ status, roomCode: recentRoom.room_code });
  } catch (error: any) {
    console.error('Error fetching group minutes status:', error);
    if (error?.code === '22P02') {
      return res.status(400).json({ error: 'Invalid group id' });
    }
    return res.status(500).json({ error: 'Failed to fetch minutes status' });
  }
});

// GET /groups/:groupId/minutes/:minutesId — Fetch full minutes details for group members
router.get('/:groupId/minutes/:minutesId', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { groupId, minutesId } = req.params as { groupId: string; minutesId: string };
    const userId = req.user!.userId;

    const memberships = await db.$queryRaw<Array<{ id: string }>>`
      SELECT gm."id"
      FROM "group_members" gm
      WHERE gm."group_id"::text = ${groupId}
        AND gm."user_id"::text = ${userId}
      LIMIT 1
    `;

    if (!memberships[0]) {
      return res.status(403).json({ error: 'Forbidden: you are not a member of this group' });
    }

    const minutesRows = await db.$queryRaw<GroupMinuteDetail[]>`
      SELECT
        mm."id",
        mm."room_id",
        mm."group_id",
        mm."created_by",
        mm."title",
        mm."raw_transcript",
        mm."summary_markdown",
        mm."duration_seconds",
        mm."participant_count",
        mm."action_items",
        mm."created_at"
      FROM "meeting_minutes" mm
      WHERE mm."group_id"::text = ${groupId}
        AND mm."id"::text = ${minutesId}
      LIMIT 1
    `;

    const minutes = minutesRows[0];
    if (!minutes) {
      return res.status(404).json({ error: 'Minutes not found' });
    }

    return res.json(minutes);
  } catch (error: any) {
    console.error('Error fetching group minutes detail:', error);
    if (error?.code === '22P02') {
      return res.status(400).json({ error: 'Invalid group or minutes id' });
    }
    return res.status(500).json({ error: 'Failed to fetch group minutes detail' });
  }
});

// POST /groups/:groupId/minutes/:minutesId/ask — Ask-AI grounded in one meeting's minutes
router.post('/:groupId/minutes/:minutesId/ask', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { groupId, minutesId } = req.params as { groupId: string; minutesId: string };
    const userId = req.user!.userId;
    const body = req.body as { question?: unknown; history?: unknown };

    const question = typeof body.question === 'string' ? body.question.trim() : '';
    if (!question || question.length > 2000) {
      return res.status(400).json({ error: 'question is required (max 2000 characters)' });
    }

    const history: QaHistoryTurn[] = Array.isArray(body.history)
      ? (body.history as Array<{ role?: unknown; content?: unknown }>)
          .filter(
            (turn) =>
              (turn?.role === 'user' || turn?.role === 'assistant') &&
              typeof turn?.content === 'string' &&
              turn.content.trim().length > 0,
          )
          .slice(-8)
          .map((turn) => ({ role: turn.role as 'user' | 'assistant', content: (turn.content as string).slice(0, 2000) }))
      : [];

    const memberships = await db.$queryRaw<Array<{ id: string }>>`
      SELECT gm."id"
      FROM "group_members" gm
      WHERE gm."group_id"::text = ${groupId}
        AND gm."user_id"::text = ${userId}
      LIMIT 1
    `;

    if (!memberships[0]) {
      return res.status(403).json({ error: 'Forbidden: you are not a member of this group' });
    }

    const minutesRows = await db.$queryRaw<Array<{ title: string; raw_transcript: string; summary_markdown: string }>>`
      SELECT mm."title", mm."raw_transcript", mm."summary_markdown"
      FROM "meeting_minutes" mm
      WHERE mm."group_id"::text = ${groupId}
        AND mm."id"::text = ${minutesId}
      LIMIT 1
    `;

    const minutes = minutesRows[0];
    if (!minutes) {
      return res.status(404).json({ error: 'Minutes not found' });
    }

    try {
      const answer = await answerMinutesQuestion({
        title: minutes.title,
        transcript: minutes.raw_transcript,
        summaryMarkdown: minutes.summary_markdown,
        question,
        history,
      });

      return res.json({ answer });
    } catch (aiError) {
      console.error('Ask-AI failed:', aiError);
      return res.status(502).json({ error: 'AI is unavailable right now' });
    }
  } catch (error: any) {
    console.error('Error answering minutes question:', error);
    if (error?.code === '22P02') {
      return res.status(400).json({ error: 'Invalid group or minutes id' });
    }
    return res.status(500).json({ error: 'Failed to answer question' });
  }
});

// PATCH /groups/:groupId/minutes/:minutesId/action-items/:itemId — toggle an action item's done state
router.patch('/:groupId/minutes/:minutesId/action-items/:itemId', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { groupId, minutesId, itemId } = req.params as { groupId: string; minutesId: string; itemId: string };
    const userId = req.user!.userId;
    const done = (req.body as { done?: unknown }).done;

    if (typeof done !== 'boolean') {
      return res.status(400).json({ error: 'done (boolean) is required' });
    }

    const memberships = await db.$queryRaw<Array<{ id: string }>>`
      SELECT gm."id"
      FROM "group_members" gm
      WHERE gm."group_id"::text = ${groupId}
        AND gm."user_id"::text = ${userId}
      LIMIT 1
    `;

    if (!memberships[0]) {
      return res.status(403).json({ error: 'Forbidden: you are not a member of this group' });
    }

    const rows = await db.$queryRaw<Array<{ action_items: ActionItem[] }>>`
      SELECT mm."action_items"
      FROM "meeting_minutes" mm
      WHERE mm."group_id"::text = ${groupId}
        AND mm."id"::text = ${minutesId}
      LIMIT 1
    `;

    const current = rows[0];
    if (!current) {
      return res.status(404).json({ error: 'Minutes not found' });
    }

    const items = Array.isArray(current.action_items) ? current.action_items : [];
    if (!items.some((item) => item.id === itemId)) {
      return res.status(404).json({ error: 'Action item not found' });
    }

    const updatedItems = items.map((item) => (item.id === itemId ? { ...item, done } : item));

    await db.$executeRaw`
      UPDATE "meeting_minutes"
      SET "action_items" = ${JSON.stringify(updatedItems)}::jsonb
      WHERE "id"::text = ${minutesId}
    `;

    return res.json({ actionItems: updatedItems });
  } catch (error: any) {
    console.error('Error updating action item:', error);
    if (error?.code === '22P02') {
      return res.status(400).json({ error: 'Invalid group or minutes id' });
    }
    return res.status(500).json({ error: 'Failed to update action item' });
  }
});

// POST /groups/:groupId/members — Add member by email (owner/admin only)
router.post('/:groupId/members', authMiddleware, async (req: Request<{ groupId: string }, {}, AddGroupMemberBody>, res: Response) => {
  try {
    const { groupId } = req.params;
    const requesterId = req.user!.userId;

    const announcementContextRows = await db.$queryRaw<MeetingAnnouncementContext[]>`
      SELECT
        g."name" AS "group_name",
        u."display_name"
      FROM "groups" g
      INNER JOIN "users" u ON u."id" = ${requesterId}::uuid
      WHERE g."id"::text = ${groupId}
      LIMIT 1
    `;

    const announcementContext = announcementContextRows[0];
    if (!announcementContext) {
      return res.status(404).json({ error: 'Group not found' });
    }
    const normalizedEmail = req.body.email?.trim();

    if (!normalizedEmail) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const requesterRoleRows = await db.$queryRaw<Array<{ role: 'owner' | 'admin' }>>`
      SELECT gm."role"
      FROM "group_members" gm
      WHERE gm."group_id"::text = ${groupId}
        AND gm."user_id"::text = ${requesterId}
        AND gm."role" IN ('owner', 'admin')
      LIMIT 1
    `;

    if (!requesterRoleRows[0]) {
      return res.status(403).json({ error: 'Forbidden: only owner or admin can add members' });
    }

    const users = await db.$queryRaw<UserLookupResult[]>`
      SELECT u."id", u."email", u."display_name", u."avatar_url"
      FROM "users" u
      WHERE u."email" = ${normalizedEmail}
      LIMIT 1
    `;

    const user = users[0];
    if (!user) {
      return res.status(404).json({ message: 'No user with that email' });
    }

    const existingMembershipRows = await db.$queryRaw<Array<{ id: string }>>`
      SELECT gm."id"
      FROM "group_members" gm
      WHERE gm."group_id"::text = ${groupId}
        AND gm."user_id" = ${user.id}::uuid
      LIMIT 1
    `;

    if (existingMembershipRows[0]) {
      return res.status(409).json({ error: 'User is already a member of this group' });
    }

    const insertedRows = await db.$queryRaw<GroupMemberInsertResult[]>`
      INSERT INTO "group_members" ("group_id", "user_id", "role")
      VALUES (${groupId}::uuid, ${user.id}::uuid, 'member')
      RETURNING "id", "group_id", "user_id", "role", "joined_at"
    `;

    const inserted = insertedRows[0];
    if (!inserted) {
      throw new Error('Failed to add member');
    }

    return res.status(201).json({
      ...inserted,
      email: user.email,
      display_name: user.display_name,
      avatar_url: user.avatar_url,
    });
  } catch (error: any) {
    console.error('Error adding group member:', error);
    if (error?.code === '22P02') {
      return res.status(400).json({ error: 'Invalid group id' });
    }
    return res.status(500).json({ error: 'Failed to add group member' });
  }
});

// PATCH /groups/:groupId/members/:userId — Change a member role (owner only)
router.patch(
  '/:groupId/members/:userId',
  authMiddleware,
  async (req: Request<{ groupId: string; userId: string }, {}, UpdateGroupMemberRoleBody>, res: Response) => {
    try {
      const { groupId, userId } = req.params;
      const requesterId = req.user!.userId;
      const { role } = req.body;

      if (role !== 'admin' && role !== 'member') {
        return res.status(400).json({ error: 'Role must be either admin or member' });
      }

      const requesterOwnerRows = await db.$queryRaw<Array<{ id: string }>>`
        SELECT gm."id"
        FROM "group_members" gm
        WHERE gm."group_id"::text = ${groupId}
          AND gm."user_id"::text = ${requesterId}
          AND gm."role" = 'owner'
        LIMIT 1
      `;

      if (!requesterOwnerRows[0]) {
        return res.status(403).json({ error: 'Forbidden: only owner can update member roles' });
      }

      const targetMemberRows = await db.$queryRaw<Array<{ id: string; role: 'owner' | 'admin' | 'member' }>>`
        SELECT gm."id", gm."role"
        FROM "group_members" gm
        WHERE gm."group_id"::text = ${groupId}
          AND gm."user_id"::text = ${userId}
        LIMIT 1
      `;

      const targetMember = targetMemberRows[0];
      if (!targetMember) {
        return res.status(404).json({ error: 'Member not found in this group' });
      }

      if (targetMember.role === 'owner' || requesterId === userId) {
        return res.status(400).json({ error: 'Cannot demote or change the owner role' });
      }

      const updatedRows = await db.$queryRaw<GroupMemberInsertResult[]>`
        UPDATE "group_members"
        SET "role" = ${role}
        WHERE "group_id"::text = ${groupId}
          AND "user_id"::text = ${userId}
        RETURNING "id", "group_id", "user_id", "role", "joined_at"
      `;

      const updatedMember = updatedRows[0];
      if (!updatedMember) {
        return res.status(404).json({ error: 'Member not found in this group' });
      }

      return res.json(updatedMember);
    } catch (error: any) {
      console.error('Error updating group member role:', error);
      if (error?.code === '22P02') {
        return res.status(400).json({ error: 'Invalid group or user id' });
      }
      return res.status(500).json({ error: 'Failed to update group member role' });
    }
  },
);

// DELETE /groups/:groupId/members/:userId — Remove a member (owner/admin) or leave group (self)
router.delete('/:groupId/members/:userId', authMiddleware, async (req: Request<{ groupId: string; userId: string }>, res: Response) => {
  try {
    const { groupId, userId } = req.params;
    const requesterId = req.user!.userId;

    const requesterMembershipRows = await db.$queryRaw<Array<{ role: 'owner' | 'admin' | 'member' }>>`
      SELECT gm."role"
      FROM "group_members" gm
      WHERE gm."group_id"::text = ${groupId}
        AND gm."user_id"::text = ${requesterId}
      LIMIT 1
    `;

    const requesterMembership = requesterMembershipRows[0];
    if (!requesterMembership) {
      return res.status(403).json({ error: 'Forbidden: you are not a member of this group' });
    }

    const targetMembershipRows = await db.$queryRaw<Array<{ role: 'owner' | 'admin' | 'member' }>>`
      SELECT gm."role"
      FROM "group_members" gm
      WHERE gm."group_id"::text = ${groupId}
        AND gm."user_id"::text = ${userId}
      LIMIT 1
    `;

    const targetMembership = targetMembershipRows[0];
    if (!targetMembership) {
      return res.status(404).json({ error: 'Member not found in this group' });
    }

    if (targetMembership.role === 'owner') {
      return res.status(400).json({ error: 'Owner cannot be removed' });
    }

    const isSelfRemoval = requesterId === userId;
    const canRemoveOthers = requesterMembership.role === 'owner' || requesterMembership.role === 'admin';
    if (!isSelfRemoval && !canRemoveOthers) {
      return res.status(403).json({ error: 'Forbidden: only owner or admin can remove other members' });
    }

    await db.$executeRaw`
      DELETE FROM "group_members"
      WHERE "group_id"::text = ${groupId}
        AND "user_id"::text = ${userId}
    `;

    return res.status(204).send();
  } catch (error: any) {
    console.error('Error removing group member:', error);
    if (error?.code === '22P02') {
      return res.status(400).json({ error: 'Invalid group or user id' });
    }
    return res.status(500).json({ error: 'Failed to remove group member' });
  }
});

// POST /groups/:groupId/meetings — Create a group meeting room (owner/admin only)
router.post('/:groupId/meetings', authMiddleware, async (req: Request<{ groupId: string }>, res: Response) => {
  try {
    const { groupId } = req.params;
    const requesterId = req.user!.userId;

    const announcementContextRows = await db.$queryRaw<Array<{ group_name: string; display_name: string }>>`
      SELECT
        g."name" AS "group_name",
        u."display_name"
      FROM "groups" g
      INNER JOIN "users" u ON u."id" = ${requesterId}::uuid
      WHERE g."id"::text = ${groupId}
      LIMIT 1
    `;

    const announcementContext = announcementContextRows[0];
    if (!announcementContext) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const requesterRoleRows = await db.$queryRaw<Array<{ role: 'owner' | 'admin' }>>`
      SELECT gm."role"
      FROM "group_members" gm
      WHERE gm."group_id"::text = ${groupId}
        AND gm."user_id"::text = ${requesterId}
        AND gm."role" IN ('owner', 'admin')
      LIMIT 1
    `;

    if (!requesterRoleRows[0]) {
      return res.status(403).json({ error: 'Forbidden: only owner or admin can create group meetings' });
    }

    const activeRooms = await db.$queryRaw<Array<{ room_code: string }>>`
      SELECT r."room_code"
      FROM "rooms" r
      WHERE r."group_id"::text = ${groupId}
        AND r."is_active" = true
      LIMIT 1
    `;

    const activeRoom = activeRooms[0];
    if (activeRoom) {
      return res.status(409).json({
        message: 'A meeting is already active for this group',
        roomCode: activeRoom.room_code,
      });
    }

    const roomCode = generateGroupMeetingRoomCode();

    const rooms = await db.$queryRaw<GroupMeetingRoom[]>`
      INSERT INTO "rooms" ("group_id", "host_id", "room_code", "is_active")
      VALUES (${groupId}::uuid, ${requesterId}::uuid, ${roomCode}, true)
      RETURNING "id", "host_id", "group_id", "room_code", "name", "is_active", "created_at", "ended_at"
    `;

    const room = rooms[0];
    if (!room) {
      throw new Error('Failed to create meeting room');
    }

    const members = await db.$queryRaw<GroupMemberOnlineStatus[]>`
      SELECT u."id" AS "user_id", u."is_online"
      FROM "group_members" gm
      INNER JOIN "users" u ON u."id" = gm."user_id"
      WHERE gm."group_id"::text = ${groupId}
        AND gm."user_id"::text <> ${requesterId}
    `;

    const groupMemberUserIds = await db.$queryRaw<GroupMemberUserId[]>`
      SELECT gm."user_id"
      FROM "group_members" gm
      WHERE gm."group_id"::text = ${groupId}
    `;

    for (const member of groupMemberUserIds) {
      emitToUser(member.user_id, 'group-meeting-started', {
        groupId,
        groupName: announcementContext.group_name,
        roomCode: room.room_code,
      });
    }

    const offlineMembers = members
      .filter((member) => !member.is_online)
      .map((member) => member.user_id);

    if (offlineMembers.length > 0) {
      const recipients = await db.$queryRaw<MeetingNotificationRecipient[]>`
        SELECT u."id", u."email", u."display_name"
        FROM "users" u
        WHERE u."id" = ANY(${offlineMembers}::uuid[])
      `;

      for (const recipient of recipients) {
        sendMeetingStartedEmail({
          toEmail: recipient.email,
          toName: recipient.display_name,
          groupName: announcementContext.group_name,
          hostName: announcementContext.display_name,
          roomCode: room.room_code,
        }).catch(console.error);
      }
    }

    return res.status(201).json({ room, offlineMembers });
  } catch (error: any) {
    console.error('Error creating group meeting:', error);
    if (error?.code === '22P02') {
      return res.status(400).json({ error: 'Invalid group id' });
    }
    return res.status(500).json({ error: 'Failed to create group meeting' });
  }
});

// POST /groups — Create a group and add creator as owner member
router.post('/', authMiddleware, async (req: Request<{}, {}, CreateGroupBody>, res: Response) => {
  try {
    const { name, description } = req.body;

    const normalizedName = name?.trim();
    if (!normalizedName) {
      return res.status(400).json({ error: 'Group name is required' });
    }

    const normalizedDescription = typeof description === 'string' ? description.trim() : undefined;
    const userId = req.user!.userId;

    const group = await db.$transaction(async (tx) => {
      const createdGroups = await tx.$queryRaw<GroupResponse[]>`
        INSERT INTO "groups" ("name", "description", "created_by")
        VALUES (${normalizedName}, ${normalizedDescription || null}, ${userId}::uuid)
        RETURNING
          "id",
          "name",
          "description",
          "avatar_url" AS "avatarUrl",
          "created_by" AS "createdBy",
          "created_at" AS "createdAt",
          "is_active" AS "isActive"
      `;

      const createdGroup = createdGroups[0];
      if (!createdGroup) {
        throw new Error('Failed to create group');
      }

      await tx.$executeRaw`
        INSERT INTO "group_members" ("group_id", "user_id", "role")
        VALUES (${createdGroup.id}::uuid, ${userId}::uuid, 'owner')
      `;

      return createdGroup;
    });

    return res.status(201).json(group);
  } catch (error) {
    console.error('Error creating group:', error);
    return res.status(500).json({ error: 'Failed to create group' });
  }
});

export default router;
