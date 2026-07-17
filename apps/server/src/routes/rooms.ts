import { Router } from 'express';
import multer from 'multer';
import type { Request, Response } from 'express';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import db from '../../db.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { emitToRoom } from '../socket/presence.ts';
import { processMeetingMinutes, type UploadedTrack } from '../services/minutesPipeline.ts';
import { enqueueMinutesJob } from '../queue/minutesQueue.ts';
import { answerMinutesQuestion, type QaHistoryTurn } from '../services/minutesQaService.ts';
import type { ActionItem } from '../services/actionItemsService.ts';

const router = Router();
export const AUDIO_UPLOAD_DIR =
  process.env.AUDIO_UPLOAD_DIR?.trim() || path.resolve(process.cwd(), 'tmp', 'audio-uploads');

mkdirSync(AUDIO_UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      callback(null, AUDIO_UPLOAD_DIR);
    },
    filename: (_req, _file, callback) => {
      callback(null, `${randomUUID()}.webm`);
    },
  }),
  limits: {
    fileSize: 50 * 1024 * 1024,
  },
});

const ROOM_CODE_LENGTH = 8;
const ROOM_CODE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function generateRoomCode() {
  const bytes = randomBytes(ROOM_CODE_LENGTH);
  let code = '';

  for (const byte of bytes) {
    code += ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length];
  }

  return code;
}

function formatDurationMinutes(createdAt: Date, endedAt: Date | null) {
  const endTime = endedAt ?? new Date();
  return Math.max(1, Math.round((endTime.getTime() - createdAt.getTime()) / 60000));
}

router.get('/dashboard/summary', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;

    const rooms = await db.room.findMany({
      where: { hostId: userId },
      orderBy: { createdAt: 'desc' },
      include: {
        host: {
          select: { id: true, displayName: true, email: true },
        },
        _count: {
          select: {
            participants: true,
            messages: true,
          },
        },
      },
    });

    const totalRooms = rooms.length;
    const activeRooms = rooms.filter((room) => room.isActive).length;
    const endedRooms = rooms.filter((room) => !room.isActive && room.endedAt);
    const totalParticipants = rooms.reduce((sum, room) => sum + room._count.participants, 0);
    const totalMessages = rooms.reduce((sum, room) => sum + room._count.messages, 0);
    const durations = endedRooms.map((room) => formatDurationMinutes(room.createdAt, room.endedAt));
    const averageDurationMinutes = durations.length
      ? Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length)
      : 0;
    const longestDurationMinutes = durations.length ? Math.max(...durations) : 0;

    const recentMeetings = rooms.slice(0, 8).map((room) => ({
      id: room.id,
      roomCode: room.roomCode,
      name: room.name,
      createdAt: room.createdAt,
      endedAt: room.endedAt,
      isActive: room.isActive,
      participantCount: room._count.participants,
      messageCount: room._count.messages,
      durationMinutes: room.isActive ? formatDurationMinutes(room.createdAt, null) : room.endedAt ? formatDurationMinutes(room.createdAt, room.endedAt) : 0,
      hostName: room.host?.displayName ?? 'You',
    }));

    const latestMeeting = rooms[0]
      ? {
          roomCode: rooms[0].roomCode,
          createdAt: rooms[0].createdAt,
          endedAt: rooms[0].endedAt,
          isActive: rooms[0].isActive,
        }
      : null;

    // Minutes for meetings this user hosted (group + normal), newest first —
    // powers the dashboard "Your meeting minutes" list, each opening
    // /room/:roomCode/minutes.
    const myMinutes = await db.$queryRaw<
      Array<{ room_code: string; title: string; created_at: Date; minutes_id: string; is_group: boolean }>
    >`
      SELECT r."room_code", mm."title", mm."created_at", mm."id" AS minutes_id,
             (mm."group_id" IS NOT NULL) AS is_group
      FROM "meeting_minutes" mm
      INNER JOIN "rooms" r ON r."id" = mm."room_id"
      WHERE mm."created_by" = ${userId}::uuid
      ORDER BY mm."created_at" DESC
      LIMIT 10
    `;

    return res.json({
      overview: {
        totalRooms,
        activeRooms,
        completedRooms: endedRooms.length,
        totalParticipants,
        totalMessages,
        averageDurationMinutes,
        longestDurationMinutes,
      },
      latestMeeting,
      recentMeetings,
      myMinutes: myMinutes.map((row) => ({
        roomCode: row.room_code,
        title: row.title,
        createdAt: row.created_at,
        minutesId: row.minutes_id,
        isGroup: row.is_group,
      })),
    });
  } catch (error) {
    console.error('Error fetching dashboard summary:', error);
    return res.status(500).json({ error: 'Failed to fetch dashboard summary' });
  }
});

// POST /rooms/create — Generate room code, create room with host_id from auth.
// Optional { summarizerEnabled, name }: a normal (non-group) meeting can opt in
// to AI minutes here, since there's no group summarizer flag to inherit.
router.post('/create', authMiddleware, async (req: Request, res: Response) => {
  try {
    const roomCode = generateRoomCode();
    const body = req.body as { summarizerEnabled?: unknown; name?: unknown };
    const summarizerEnabled = body?.summarizerEnabled === true;
    const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 120) : null;

    const room = await db.room.create({
      data: {
        roomCode,
        hostId: req.user!.userId,
        isActive: true,
        summarizerEnabled,
        name,
      },
    });

    return res.json({
      room,
      joinUrl: `${process.env.CLIENT_URL}/room/${room.roomCode}`,
    });
  } catch (error) {
    console.error('Error creating room:', error);
    return res.status(500).json({ error: 'Failed to create room' });
  }
});

// PATCH /rooms/:roomCode — host-only room settings. Powers the lobby's AI-minutes
// toggle for a normal meeting (group meetings inherit their group's flag).
router.patch('/:roomCode', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { roomCode } = req.params as { roomCode: string };
    const { summarizerEnabled } = req.body as { summarizerEnabled?: unknown };

    const room = await (db as any).room.findUnique({
      where: { roomCode },
      include: { group: { select: { summarizerEnabled: true } } },
    });
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    if (room.hostId !== req.user!.userId) {
      return res.status(403).json({ error: 'Only the host can change meeting settings' });
    }

    const data: { summarizerEnabled?: boolean } = {};
    if (typeof summarizerEnabled === 'boolean') {
      data.summarizerEnabled = summarizerEnabled;
    }
    const updated = Object.keys(data).length
      ? await (db as any).room.update({ where: { id: room.id }, data })
      : room;

    return res.json({
      summarizer_enabled: Boolean(updated.summarizerEnabled || room.group?.summarizerEnabled),
    });
  } catch (error) {
    console.error('Error updating room settings:', error);
    return res.status(500).json({ error: 'Failed to update room settings' });
  }
});

// GET /rooms/:roomCode — Fetch active room with host info
router.get('/:roomCode', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { roomCode } = req.params as { roomCode: string };

    const room = await (db as any).room.findUnique({
      where: { roomCode },
      include: {
        group: {
          select: {
            name: true,
            summarizerEnabled: true,
          },
        },
        host: {
          select: {
            id: true,
            email: true,
            displayName: true,
            avatarUrl: true,
          },
        },
      },
    });

    if (!room || !room.isActive) {
      return res.status(404).json({ error: 'Room not found or is inactive' });
    }

    return res.json({
      ...room,
      group_name: room.group?.name ?? null,
      // Effective flag the client keys off: a group room inherits the group's
      // setting; a normal room uses its own opt-in.
      summarizer_enabled: Boolean(room.summarizerEnabled || room.group?.summarizerEnabled),
      group: room.group
        ? {
            summarizer_enabled: room.group.summarizerEnabled,
          }
        : null,
    });
  } catch (error) {
    console.error('Error fetching room:', error);
    return res.status(500).json({ error: 'Failed to fetch room' });
  }
});

type ManifestTrackEntry = {
  index?: number;
  speaker?: string;
  offsetMs?: number;
};

/**
 * Pairs the uploaded audio files with the client manifest describing who each
 * track belongs to. Backward compatible: a single file without a manifest is
 * treated as one host-voiced track starting at offset 0.
 */
function resolveUploadedTracks(
  files: Express.Multer.File[],
  manifestRaw: unknown,
  hostDisplayName: string,
): UploadedTrack[] | null {
  if (typeof manifestRaw !== 'string' || !manifestRaw.trim()) {
    if (files.length === 1 && files[0]) {
      return [{ filePath: files[0].path, speaker: hostDisplayName, offsetMs: 0 }];
    }
    return null;
  }

  let entries: ManifestTrackEntry[];
  try {
    const parsed = JSON.parse(manifestRaw) as { tracks?: ManifestTrackEntry[] };
    entries = Array.isArray(parsed?.tracks) ? parsed.tracks : [];
  } catch {
    return null;
  }

  if (entries.length !== files.length) {
    return null;
  }

  const tracks: UploadedTrack[] = [];
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    const entry = entries.find((candidate) => candidate.index === i) ?? entries[i];
    if (!file || !entry) {
      return null;
    }

    const offsetMs = Number(entry.offsetMs);
    if (!Number.isFinite(offsetMs) || offsetMs < 0) {
      return null;
    }

    const speaker = String(entry.speaker ?? '').trim().slice(0, 80) || hostDisplayName;
    tracks.push({ filePath: file.path, speaker, offsetMs });
  }

  return tracks;
}

// POST /rooms/:roomCode/end-with-summary — Host ends room; AI minutes are
// generated by the durable BullMQ pipeline (services/minutesPipeline.ts,
// queue/minutesWorker.ts) — one audio track per speaker + manifest.
router.post('/:roomCode/end-with-summary', authMiddleware, upload.array('audio', 10), async (req: Request, res: Response) => {
  try {
    const { roomCode } = req.params as { roomCode: string };
    const audioFiles = ((req as Request & { files?: Express.Multer.File[] }).files ?? []).filter(
      (file) => Boolean(file?.path),
    );

    if (audioFiles.length === 0) {
      return res.status(400).json({ error: 'audio file is required' });
    }

    const room = await (db as any).room.findUnique({
      where: { roomCode },
      include: {
        group: {
          select: {
            name: true,
            summarizerEnabled: true,
          },
        },
      },
    });

    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    if (room.hostId !== req.user!.userId) {
      return res.status(403).json({ error: 'Only host can end room' });
    }

    // AI minutes must be opted in — either the group's summarizer flag (group
    // room) or the room's own flag (normal meeting). No group is required.
    const summarizerOn = Boolean(room.summarizerEnabled || room.group?.summarizerEnabled);
    if (!summarizerOn) {
      return res.status(400).json({ error: 'AI minutes are not enabled for this meeting' });
    }

    const hostRows = await db.$queryRaw<Array<{ display_name: string }>>`
      SELECT u."display_name" FROM "users" u WHERE u."id" = ${req.user!.userId}::uuid LIMIT 1
    `;
    const hostDisplayName = hostRows[0]?.display_name?.trim() || 'Host';

    const tracks = resolveUploadedTracks(audioFiles, (req.body as { manifest?: unknown })?.manifest, hostDisplayName);
    if (!tracks) {
      return res.status(400).json({ error: 'invalid audio manifest' });
    }

    const endedAt = new Date();
    await (db as any).room.update({
      where: { id: room.id },
      data: {
        isActive: false,
        endedAt,
      },
    });

    // Tell every participant the meeting is over so they leave immediately.
    emitToRoom(roomCode, 'meeting-ended', { roomCode });

    const durationSeconds = Math.max(1, Math.round((endedAt.getTime() - room.createdAt.getTime()) / 1000));
    // Group room → group name; normal meeting → room name or a code-based label.
    const roomLabel = room.group?.name || room.name || `Meeting ${room.roomCode}`;

    const jobPayload = {
      roomId: room.id,
      roomCode,
      groupId: room.groupId ?? null,
      groupName: roomLabel,
      hostUserId: req.user!.userId,
      durationSeconds,
      tracks,
    };

    // Enqueue the minutes job in Redis so it survives crashes/deploys and
    // retries transient AI failures. Members are notified via the
    // 'minutes-ready' socket event and email when the worker finishes.
    try {
      await enqueueMinutesJob(jobPayload);
    } catch (queueError) {
      // Graceful degradation: if Redis is unreachable, the meeting's audio
      // must not be lost — fall back to the legacy in-process fire-and-forget
      // run (no durability/retries, but strictly better than dropping it).
      console.error('Failed to enqueue minutes job — falling back to inline processing:', queueError);
      void processMeetingMinutes(jobPayload).catch((pipelineError) => {
        console.error('Meeting minutes pipeline failed:', pipelineError);
      });
    }

    // 202 Accepted: "work received, result pending" — the honest status for
    // an async pipeline (the response returns before the minutes exist).
    return res.status(202).json({
      success: true,
      processing: true,
    });
  } catch (error) {
    console.error('Error ending room with summary:', error);
    return res.status(500).json({ error: 'Failed to end room with summary' });
  }
});

// --- Single-meeting minutes (works for group AND normal meetings) ---------
// These power the standalone /room/:roomCode/minutes page. Unlike the
// group-scoped routes, access is by relationship to the ROOM (host, a
// participant, or — for a group room — a member), so a normal meeting's host
// can read minutes without any group.

type RoomMinutesAuth =
  | { ok: true; roomId: string; minutesId: string }
  | { ok: false; status: number; error: string };

async function authorizeRoomMinutes(roomCode: string, userId: string): Promise<RoomMinutesAuth> {
  const rows = await db.$queryRaw<Array<{ room_id: string; host_id: string | null; group_id: string | null; minutes_id: string | null }>>`
    SELECT r."id" AS room_id, r."host_id", r."group_id", mm."id" AS minutes_id
    FROM "rooms" r
    LEFT JOIN "meeting_minutes" mm ON mm."room_id" = r."id"
    WHERE r."room_code" = ${roomCode}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) {
    return { ok: false, status: 404, error: 'Room not found' };
  }
  if (!row.minutes_id) {
    return { ok: false, status: 404, error: 'Minutes not found' };
  }

  // Host of the meeting.
  if (row.host_id && row.host_id === userId) {
    return { ok: true, roomId: row.room_id, minutesId: row.minutes_id };
  }
  // Member of the group, if this was a group meeting.
  if (row.group_id) {
    const member = await db.$queryRaw<Array<{ id: string }>>`
      SELECT gm."id" FROM "group_members" gm
      WHERE gm."group_id" = ${row.group_id}::uuid AND gm."user_id" = ${userId}::uuid LIMIT 1
    `;
    if (member[0]) {
      return { ok: true, roomId: row.room_id, minutesId: row.minutes_id };
    }
  }
  // Anyone who joined the room as a participant.
  const participant = await db.$queryRaw<Array<{ id: string }>>`
    SELECT p."id" FROM "participants" p
    WHERE p."room_id" = ${row.room_id}::uuid AND p."user_id" = ${userId}::uuid LIMIT 1
  `;
  if (participant[0]) {
    return { ok: true, roomId: row.room_id, minutesId: row.minutes_id };
  }

  return { ok: false, status: 403, error: 'Forbidden: you do not have access to this meeting' };
}

// GET /rooms/:roomCode/minutes — full minutes for a single meeting.
router.get('/:roomCode/minutes', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { roomCode } = req.params as { roomCode: string };
    const auth = await authorizeRoomMinutes(roomCode, req.user!.userId);
    if (!auth.ok) {
      return res.status(auth.status).json({ error: auth.error });
    }

    const rows = await db.$queryRaw<Array<Record<string, unknown>>>`
      SELECT
        mm."id", mm."room_id", mm."group_id", mm."created_by", mm."title",
        mm."raw_transcript", mm."summary_markdown", mm."duration_seconds",
        mm."participant_count", mm."action_items", mm."created_at"
      FROM "meeting_minutes" mm
      WHERE mm."id" = ${auth.minutesId}::uuid
      LIMIT 1
    `;
    return res.json(rows[0]);
  } catch (error: any) {
    console.error('Error fetching room minutes:', error);
    if (error?.code === '22P02') {
      return res.status(400).json({ error: 'Invalid room code' });
    }
    return res.status(500).json({ error: 'Failed to fetch minutes' });
  }
});

// POST /rooms/:roomCode/minutes/ask — Ask-AI grounded in this one meeting.
router.post('/:roomCode/minutes/ask', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { roomCode } = req.params as { roomCode: string };
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

    const auth = await authorizeRoomMinutes(roomCode, req.user!.userId);
    if (!auth.ok) {
      return res.status(auth.status).json({ error: auth.error });
    }

    const rows = await db.$queryRaw<Array<{ title: string; raw_transcript: string; summary_markdown: string }>>`
      SELECT mm."title", mm."raw_transcript", mm."summary_markdown"
      FROM "meeting_minutes" mm WHERE mm."id" = ${auth.minutesId}::uuid LIMIT 1
    `;
    const minutes = rows[0];
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
    console.error('Error answering room minutes question:', error);
    if (error?.code === '22P02') {
      return res.status(400).json({ error: 'Invalid room code' });
    }
    return res.status(500).json({ error: 'Failed to answer question' });
  }
});

// PATCH /rooms/:roomCode/minutes/action-items/:itemId — toggle an item's done state.
router.patch('/:roomCode/minutes/action-items/:itemId', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { roomCode, itemId } = req.params as { roomCode: string; itemId: string };
    const done = (req.body as { done?: unknown }).done;
    if (typeof done !== 'boolean') {
      return res.status(400).json({ error: 'done (boolean) is required' });
    }

    const auth = await authorizeRoomMinutes(roomCode, req.user!.userId);
    if (!auth.ok) {
      return res.status(auth.status).json({ error: auth.error });
    }

    const rows = await db.$queryRaw<Array<{ action_items: ActionItem[] }>>`
      SELECT mm."action_items" FROM "meeting_minutes" mm WHERE mm."id" = ${auth.minutesId}::uuid LIMIT 1
    `;
    const items = Array.isArray(rows[0]?.action_items) ? rows[0]!.action_items : [];
    if (!items.some((item) => item.id === itemId)) {
      return res.status(404).json({ error: 'Action item not found' });
    }

    const updatedItems = items.map((item) => (item.id === itemId ? { ...item, done } : item));
    await db.$executeRaw`
      UPDATE "meeting_minutes" SET "action_items" = ${JSON.stringify(updatedItems)}::jsonb
      WHERE "id" = ${auth.minutesId}::uuid
    `;

    return res.json({ actionItems: updatedItems });
  } catch (error: any) {
    console.error('Error updating room action item:', error);
    if (error?.code === '22P02') {
      return res.status(400).json({ error: 'Invalid room code' });
    }
    return res.status(500).json({ error: 'Failed to update action item' });
  }
});

// POST /rooms/:roomCode/join — Add user to participants
router.post('/:roomCode/join', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { roomCode } = req.params as { roomCode: string };

    const room = await db.room.findUnique({
      where: { roomCode },
    });

    if (!room || !room.isActive) {
      return res.status(404).json({ error: 'Room not found or is inactive' });
    }

    // Create participant entry
    await db.participant.create({
      data: {
        roomId: room.id,
        userId: req.user!.userId,
      },
    });

    // Fetch all participants in room
    const participants = await db.participant.findMany({
      where: { roomId: room.id },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            displayName: true,
            avatarUrl: true,
          },
        },
      },
    });

    return res.json({
      room,
      participants,
    });
  } catch (error: any) {
    console.error('Error joining room:', error);
    // Handle duplicate participant
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'Already joined this room' });
    }
    return res.status(500).json({ error: 'Failed to join room' });
  }
});

// POST /rooms/:roomCode/end — Host ends room
router.post('/:roomCode/end', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { roomCode } = req.params as { roomCode: string };

    const room = await db.room.findUnique({
      where: { roomCode },
    });

    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    // Only host can end room
    if (room.hostId !== req.user!.userId) {
      return res.status(403).json({ error: 'Only host can end room' });
    }

    const updatedRoom = await db.room.update({
      where: { id: room.id },
      data: {
        isActive: false,
        endedAt: new Date(),
      },
    });

    // Notify everyone still in the room so they are dropped back to the dashboard.
    emitToRoom(roomCode, 'meeting-ended', { roomCode });

    return res.json(updatedRoom);
  } catch (error) {
    console.error('Error ending room:', error);
    return res.status(500).json({ error: 'Failed to end room' });
  }
});

export default router;
