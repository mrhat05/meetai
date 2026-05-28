import { Router } from 'express';
import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import db from '../../db.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';

const router = Router();

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
    });
  } catch (error) {
    console.error('Error fetching dashboard summary:', error);
    return res.status(500).json({ error: 'Failed to fetch dashboard summary' });
  }
});

// POST /rooms/create — Generate room code, create room with host_id from auth
router.post('/create', authMiddleware, async (req: Request, res: Response) => {
  try {
    const roomCode = generateRoomCode();

    const room = await db.room.create({
      data: {
        roomCode,
        hostId: req.user!.userId,
        isActive: true,
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

// GET /rooms/:roomCode — Fetch active room with host info
router.get('/:roomCode', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { roomCode } = req.params as { roomCode: string };

    const room = await db.room.findUnique({
      where: { roomCode },
      include: {
        group: {
          select: {
            name: true,
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
    });
  } catch (error) {
    console.error('Error fetching room:', error);
    return res.status(500).json({ error: 'Failed to fetch room' });
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

    return res.json(updatedRoom); 
  } catch (error) {
    console.error('Error ending room:', error);
    return res.status(500).json({ error: 'Failed to end room' });
  }
});

export default router;
