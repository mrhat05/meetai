import type { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import db from '../../db.js';
import type { AuthPayload } from '../../middleware/authMiddleware.js';
import {
  cancelPendingRoomEnd,
  addSocketToRoom,
  getRoomSocketCount,
  markUserOffline,
  markUserOnline,
  removeSocketFromRoom,
  scheduleRoomEnd,
} from './presence.ts';

type JoinRoomPayload = { roomCode: string; displayName: string; videoOn?: boolean };
type MediaStatePayload = { roomCode: string; videoOn: boolean };
type OfferPayload = { to: string; offer: RTCSessionDescriptionInit };
type AnswerPayload = { to: string; answer: RTCSessionDescriptionInit };
type IceCandidatePayload = { to: string; candidate: RTCIceCandidateInit };
type ChatMessagePayload = { roomCode: string; text: string; senderName: string };

type SocketData = {
  joinedRooms?: Set<string>;
  displayName?: string;
  avatarUrl?: string | null;
  videoOn?: boolean;
  userId?: string;
};

type PeerSnapshot = {
  peerId: string;
  displayName: string;
  avatarUrl: string | null;
  videoOn: boolean;
};

function getPeerSnapshot(peerSocket: Socket | undefined, fallbackPeerId: string): PeerSnapshot {
  const peerData = (peerSocket?.data as SocketData | undefined) ?? {};

  return {
    peerId: fallbackPeerId,
    displayName: peerData.displayName || 'User',
    avatarUrl: peerData.avatarUrl ?? null,
    videoOn: peerData.videoOn ?? true,
  };
}

export default function signalingHandler(io: SocketIOServer) {
  return (socket: Socket) => {
    const data = socket.data as SocketData;
    data.joinedRooms = new Set<string>();

    // On initial connection, try to extract userId from a JWT provided in
    // `socket.handshake.auth.token`. If present and valid, mark the user
    // as online and attach `userId` to `socket.data` for later use.
    try {
      const token = (socket.handshake.auth as any)?.token;
      if (typeof token === 'string' && token.length > 0) {
        const secret = process.env.JWT_SECRET;
        if (secret) {
          try {
            const decoded = jwt.verify(token, secret) as AuthPayload | null;
            const userId = decoded?.userId;
            if (userId) {
              data.userId = userId;
              markUserOnline(userId, socket.id);
              void db.user
                .findUnique({
                  where: { id: userId },
                  select: { displayName: true, avatarUrl: true },
                })
                .then((profile) => {
                  if (profile) {
                    data.displayName = profile.displayName;
                    data.avatarUrl = profile.avatarUrl;

                    for (const roomCode of data.joinedRooms ?? new Set<string>()) {
                      socket.to(roomCode).emit('peer-state-changed', {
                        peerId: socket.id,
                        displayName: data.displayName || 'User',
                        avatarUrl: data.avatarUrl ?? null,
                        videoOn: data.videoOn ?? true,
                      });
                    }
                  }
                })
                .catch((err) => console.error('presence profile load error', err));

              void db.user
                .update({ where: { id: userId }, data: { isOnline: true, lastSeenAt: new Date() } })
                .catch((err) => console.error('presence connect update error', err));
            }
          } catch (err) {
            if ((err as { name?: string } | undefined)?.name !== 'TokenExpiredError') {
              console.error('socket auth verify failed', err);
            }
          }
        } else {
          console.error('JWT_SECRET is not set; cannot verify socket token');
        }
      }
    } catch (err) {
      console.error('socket auth extraction error', err);
    }

    socket.on('join-room', async ({ roomCode, displayName, videoOn }: JoinRoomPayload) => {
      try {
        cancelPendingRoomEnd(roomCode);
        data.displayName = displayName;
        data.videoOn = videoOn ?? true;
        await socket.join(roomCode);
        data.joinedRooms?.add(roomCode);
        addSocketToRoom(roomCode, socket.id);

        if (data.avatarUrl || data.displayName) {
          socket.to(roomCode).emit('peer-state-changed', {
            peerId: socket.id,
            displayName: data.displayName || 'User',
            avatarUrl: data.avatarUrl ?? null,
            videoOn: data.videoOn ?? true,
          });
        }

        const socketsInRoom = await io.in(roomCode).allSockets();
        const existingPeers = Array.from(socketsInRoom)
          .filter((socketId) => socketId !== socket.id)
          .map((peerId) => {
            const peerSocket = io.sockets.sockets.get(peerId);
            return getPeerSnapshot(peerSocket, peerId);
          });

        socket.emit('existing-peers', existingPeers);
        socket.to(roomCode).emit('peer-joined', getPeerSnapshot(socket, socket.id));
      } catch (error) {
        console.error('join-room error', error);
        socket.emit('error', { message: 'Failed to join room' });
      }
    });

    socket.on('media-state', ({ roomCode, videoOn }: MediaStatePayload) => {
      if (!roomCode) return;

      data.videoOn = videoOn;
      socket.to(roomCode).emit('peer-state-changed', {
        peerId: socket.id,
        displayName: data.displayName || 'User',
        avatarUrl: data.avatarUrl ?? null,
        videoOn,
      });
    });

    socket.on('join-room-chat', async ({ roomCode }: { roomCode: string }) => {
      try {
        cancelPendingRoomEnd(roomCode);
        await socket.join(roomCode);
        data.joinedRooms?.add(roomCode);
        addSocketToRoom(roomCode, socket.id);
      } catch (error) {
        console.error('join-room-chat error', error);
      }
    });

    socket.on('offer', ({ to, offer }: OfferPayload) => {
      if (!to) return;
      io.to(to).emit('offer', { from: socket.id, offer });
    });

    socket.on('answer', ({ to, answer }: AnswerPayload) => {
      if (!to) return;
      io.to(to).emit('answer', { from: socket.id, answer });
    });

    socket.on('ice-candidate', ({ to, candidate }: IceCandidatePayload) => {
      if (!to) return;
      io.to(to).emit('ice-candidate', { from: socket.id, candidate });
    });

    socket.on('chat-message', ({ roomCode, text, senderName }: ChatMessagePayload) => {
      if (!roomCode || !text?.trim()) return;

      socket.to(roomCode).emit('chat-message', {
        senderId: socket.id,
        senderName,
        text,
        timestamp: Date.now(),
      });
    });

    socket.on('disconnect', () => {
      const rooms = data.joinedRooms ?? new Set<string>();
      for (const roomCode of rooms) {
        socket.to(roomCode).emit('peer-left', socket.id);

        const remainingSocketCount = removeSocketFromRoom(roomCode, socket.id);
        if (remainingSocketCount === 0) {
          scheduleRoomEnd(roomCode, () => {
            void (async () => {
              if (getRoomSocketCount(roomCode) > 0) {
                return;
              }

              const activeRooms = await db.$queryRaw<Array<{ group_id: string | null }>>`
                SELECT r."group_id"
                FROM "rooms" r
                WHERE r."room_code" = ${roomCode}
                  AND r."is_active" = true
                LIMIT 1
              `;

              const activeRoom = activeRooms[0];
              if (!activeRoom?.group_id) {
                return;
              }

              await db.$executeRaw`
                UPDATE "rooms"
                SET "is_active" = false,
                    "ended_at" = now()
                WHERE "room_code" = ${roomCode}
                  AND "is_active" = true
              `;

              io.to(roomCode).emit('meeting-ended', { roomCode });
            })().catch((err) => {
              console.error('meeting end on disconnect error', err);
            });
          });
        }
      }

      // If we stored a userId on the socket, mark them offline and update last_seen_at
      const userId = (socket.data as any)?.userId as string | undefined;
      if (userId) {
        markUserOffline(userId, socket.id);
        db.user
          .update({ where: { id: userId }, data: { isOnline: false, lastSeenAt: new Date() } })
          .catch((err) => console.error('presence disconnect update error', err));
      }
    });
  };
}
