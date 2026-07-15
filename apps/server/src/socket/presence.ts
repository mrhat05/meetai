import type { Server as SocketIOServer } from 'socket.io';

export const userSocketMap = new Map<string, string>();
export const roomSocketMap = new Map<string, Set<string>>();
const roomEndTimers = new Map<string, ReturnType<typeof setTimeout>>();

let socketServer: SocketIOServer | null = null;

export function registerSocketServer(io: SocketIOServer) {
  socketServer = io;
}

export function markUserOnline(userId: string, socketId: string) {
  userSocketMap.set(userId, socketId);
}

export function markUserOffline(userId: string, socketId?: string) {
  const currentSocketId = userSocketMap.get(userId);
  if (!socketId || currentSocketId === socketId) {
    userSocketMap.delete(userId);
  }
}

export function addSocketToRoom(roomCode: string, socketId: string) {
  const socketIds = roomSocketMap.get(roomCode) ?? new Set<string>();
  socketIds.add(socketId);
  roomSocketMap.set(roomCode, socketIds);
}

export function removeSocketFromRoom(roomCode: string, socketId: string) {
  const socketIds = roomSocketMap.get(roomCode);
  if (!socketIds) return 0;

  socketIds.delete(socketId);
  if (socketIds.size === 0) {
    roomSocketMap.delete(roomCode);
    return 0;
  }

  roomSocketMap.set(roomCode, socketIds);
  return socketIds.size;
}

export function cancelPendingRoomEnd(roomCode: string) {
  const timeoutId = roomEndTimers.get(roomCode);
  if (timeoutId) {
    clearTimeout(timeoutId);
    roomEndTimers.delete(roomCode);
  }
}

export function scheduleRoomEnd(roomCode: string, onExpire: () => void, delayMs = 15000) {
  cancelPendingRoomEnd(roomCode);

  const timeoutId = setTimeout(() => {
    roomEndTimers.delete(roomCode);
    onExpire();
  }, delayMs);

  roomEndTimers.set(roomCode, timeoutId);
}

export function getRoomSocketCount(roomCode: string) {
  return roomSocketMap.get(roomCode)?.size ?? 0;
}

export function getSocketIdByUserId(userId: string) {
  return userSocketMap.get(userId);
}

export function emitToUser<TPayload>(userId: string, eventName: string, payload: TPayload) {
  const socketId = getSocketIdByUserId(userId);
  if (!socketId || !socketServer) {
    return false;
  }

  socketServer.to(socketId).emit(eventName, payload);
  return true;
}

export function emitToRoom<TPayload>(roomCode: string, eventName: string, payload: TPayload) {
  if (!socketServer) {
    return false;
  }

  socketServer.to(roomCode).emit(eventName, payload);
  return true;
}