'use client';

import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

type GroupMeetingAlert = {
  groupName: string;
  roomCode: string;
};

type ServerToClientEvents = {
  'group-meeting-started': (payload: GroupMeetingAlert) => void;
};

type ClientToServerEvents = Record<string, never>;

function getWsUrl() {
  const wsUrl = process.env.NEXT_PUBLIC_WS_URL;
  if (!wsUrl) {
    throw new Error('NEXT_PUBLIC_WS_URL is required');
  }
  return wsUrl;
}

function getAccessToken() {
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
    const payloadJson = window.atob(normalizedPayload.padEnd(normalizedPayload.length + ((4 - (normalizedPayload.length % 4)) % 4), '='));
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

export default function useGroupMeetingAlert() {
  const [activeMeetingAlert, setActiveMeetingAlert] = useState<GroupMeetingAlert | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const accessToken = getAccessToken();
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(getWsUrl(), {
      auth: accessToken ? { token: accessToken } : undefined,
    });

    const handleGroupMeetingStarted = (payload: GroupMeetingAlert) => {
      setActiveMeetingAlert(payload);
    };

    socket.on('group-meeting-started', handleGroupMeetingStarted);

    return () => {
      socket.off('group-meeting-started', handleGroupMeetingStarted);
      socket.disconnect();
    };
  }, []);

  const dismissAlert = () => {
    setActiveMeetingAlert(null);
  };

  return { activeMeetingAlert, dismissAlert };
}