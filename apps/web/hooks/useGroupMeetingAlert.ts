'use client';

import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

export type GroupMeetingAlert = {
  groupId: string;
  groupName: string;
  roomCode: string;
};

export type MinutesReadyAlert = {
  // null for a normal (non-group) meeting → link to /room/:roomCode/minutes.
  groupId: string | null;
  minutesId: string;
  roomCode?: string;
};

type ServerToClientEvents = {
  'group-meeting-started': (payload: GroupMeetingAlert) => void;
  'minutes-ready': (payload: MinutesReadyAlert) => void;
};

type ClientToServerEvents = Record<string, never>;

type AlertSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

function getWsUrl() {
  const wsUrl = process.env.NEXT_PUBLIC_WS_URL;
  if (!wsUrl) {
    throw new Error('NEXT_PUBLIC_WS_URL is required');
  }
  return wsUrl;
}

function getAccessToken(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const accessToken = window.localStorage.getItem('accessToken');
  if (!accessToken) {
    return null;
  }

  try {
    const payloadBase64 = accessToken.split('.')[1];
    if (!payloadBase64) {
      return accessToken;
    }

    const normalizedPayload = payloadBase64.replace(/-/g, '+').replace(/_/g, '/');
    const payloadJson = window.atob(
      normalizedPayload.padEnd(normalizedPayload.length + ((4 - (normalizedPayload.length % 4)) % 4), '='),
    );
    const payload = JSON.parse(payloadJson) as { exp?: number };

    if (typeof payload.exp === 'number' && Date.now() >= payload.exp * 1000) {
      window.localStorage.removeItem('accessToken');
      return null;
    }
  } catch {
    return null;
  }

  return accessToken;
}

// A single socket connection shared by every consumer of this hook. The server
// tracks one socket per user (userSocketMap), so opening a connection per hook
// instance would make them fight over which socket receives user-targeted
// events. Sharing one connection keeps the "meeting started" notification
// reliable no matter how many pages mount this hook.
let sharedSocket: AlertSocket | null = null;
let authedToken: string | null = null;

function getSharedSocket(): AlertSocket {
  if (!sharedSocket) {
    authedToken = getAccessToken();
    const socket: AlertSocket = io(getWsUrl(), {
      auth: authedToken ? { token: authedToken } : undefined,
    });
    sharedSocket = socket;
  }
  return sharedSocket;
}

// Reconnect with the latest token when auth state changes (e.g. right after
// login), so a socket that first connected anonymously starts receiving the
// user's events without a full page reload.
function refreshSocketAuth() {
  const token = getAccessToken();
  if (token === authedToken) {
    return;
  }
  authedToken = token;

  const socket = getSharedSocket();
  socket.auth = token ? { token } : {};
  if (socket.connected) {
    socket.disconnect();
  }
  socket.connect();
}

export default function useGroupMeetingAlert() {
  const [activeMeetingAlert, setActiveMeetingAlert] = useState<GroupMeetingAlert | null>(null);
  const [minutesReadyAlert, setMinutesReadyAlert] = useState<MinutesReadyAlert | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const socket = getSharedSocket();

    const handleGroupMeetingStarted = (payload: GroupMeetingAlert) => {
      setActiveMeetingAlert(payload);
    };

    const handleMinutesReady = (payload: MinutesReadyAlert) => {
      setMinutesReadyAlert(payload);
    };

    const handleAuthChanged = () => {
      refreshSocketAuth();
    };

    socket.on('group-meeting-started', handleGroupMeetingStarted);
    socket.on('minutes-ready', handleMinutesReady);
    window.addEventListener('meetai:auth', handleAuthChanged);

    // Pick up a token that may have appeared since the shared socket first
    // connected (e.g. this hook mounts on a page loaded right after login).
    refreshSocketAuth();

    return () => {
      socket.off('group-meeting-started', handleGroupMeetingStarted);
      socket.off('minutes-ready', handleMinutesReady);
      window.removeEventListener('meetai:auth', handleAuthChanged);
      // Intentionally do NOT disconnect the shared socket — other mounted
      // consumers (e.g. the app-wide alert) rely on it staying open.
    };
  }, []);

  const dismissAlert = () => {
    setActiveMeetingAlert(null);
  };

  return { activeMeetingAlert, minutesReadyAlert, dismissAlert };
}
