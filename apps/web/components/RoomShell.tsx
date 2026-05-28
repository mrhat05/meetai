'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import useLocalStream from '@/hooks/useLocalStream';
import useWebRTC from '@/hooks/useWebRTC';
import VideoTile from '@/components/VideoTile';

type RoomShellProps = {
  roomCode: string;
};

type RoomDetails = {
  hostId: string | null;
  group_name: string | null;
};

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const [, payload] = token.split('.');
    if (!payload) return null;

    const normalizedPayload = payload.replace(/-/g, '+').replace(/_/g, '/');
    const paddedPayload = normalizedPayload.padEnd(Math.ceil(normalizedPayload.length / 4) * 4, '=');

    return JSON.parse(window.atob(paddedPayload)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export default function RoomShell({ roomCode }: RoomShellProps) {
  const router = useRouter();
  const { stream: localStream, isVideoOn, isAudioOn, mediaError, toggleVideo, toggleAudio } = useLocalStream();
  const { peers, peerPresence, connectedPeerIds, messages, sendMessage } = useWebRTC(roomCode, localStream, isVideoOn);
  const [isHost, setIsHost] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isEndingCall, setIsEndingCall] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [userDisplayName, setUserDisplayName] = useState('You');
  const [userAvatarUrl, setUserAvatarUrl] = useState<string | null>(null);
  const [groupName, setGroupName] = useState<string | null>(null);
  const [tilePage, setTilePage] = useState(0);

  const peerEntries = useMemo(() => Array.from(peers.entries()), [peers]);
  const peersWithoutMedia = useMemo(() => connectedPeerIds.filter((peerId) => !peers.has(peerId)), [connectedPeerIds, peers]);

  const meetingTiles = useMemo(
    () => [
      {
        key: 'local',
        label: userDisplayName,
        stream: localStream,
        muted: true,
        avatarUrl: userAvatarUrl,
        videoOn: isVideoOn,
        kind: 'stream' as const,
      },
      ...peerEntries.map(([peerId, stream]) => ({
        key: peerId,
        label: peerPresence.get(peerId)?.displayName || peerId,
        stream,
        muted: false,
        avatarUrl: peerPresence.get(peerId)?.avatarUrl ?? null,
        videoOn: peerPresence.get(peerId)?.videoOn ?? true,
        kind: 'stream' as const,
      })),
      ...peersWithoutMedia.map((peerId) => ({
        key: `${peerId}-pending`,
        label: peerPresence.get(peerId)?.displayName || peerId,
        stream: null as MediaStream | null,
        muted: false,
        avatarUrl: peerPresence.get(peerId)?.avatarUrl ?? null,
        videoOn: peerPresence.get(peerId)?.videoOn ?? false,
        kind: 'pending' as const,
      })),
    ],
    [isVideoOn, localStream, peerEntries, peerPresence, peersWithoutMedia, userAvatarUrl, userDisplayName]
  );

  const pageSize = 2;
  const pageCount = Math.max(1, Math.ceil(meetingTiles.length / pageSize));
  const visibleTiles = useMemo(() => meetingTiles.slice(tilePage * pageSize, tilePage * pageSize + pageSize), [meetingTiles, tilePage]);

  useEffect(() => {
    if (tilePage > pageCount - 1) {
      setTilePage(pageCount - 1);
    }
  }, [pageCount, tilePage]);

  useEffect(() => {
    const getUserInfoFromToken = () => {
      const token = window.localStorage.getItem('accessToken');
      const storedDisplayName = window.localStorage.getItem('displayName') || window.localStorage.getItem('userName');
      const storedEmail = window.localStorage.getItem('userEmail');
      const storedAvatarUrl = window.localStorage.getItem('avatarUrl');

      if (!token) {
        return {
          userId: null,
          displayName: storedDisplayName || storedEmail?.split('@')[0] || 'You',
          avatarUrl: storedAvatarUrl,
        };
      }

      try {
        const decodedPayload = decodeJwtPayload(token);
        if (!decodedPayload) {
          return {
            userId: null,
            displayName: storedDisplayName || storedEmail?.split('@')[0] || 'You',
            avatarUrl: storedAvatarUrl,
          };
        }

        const tokenDisplayName =
          (typeof decodedPayload.displayName === 'string' && decodedPayload.displayName.trim()) ||
          (typeof decodedPayload.email === 'string' ? decodedPayload.email.split('@')[0] : '') ||
          'You';

        return {
          userId: (decodedPayload.userId as string | undefined) ?? null,
          displayName: storedDisplayName || tokenDisplayName,
          avatarUrl: storedAvatarUrl,
        };
      } catch {
        return {
          userId: null,
          displayName: storedDisplayName || storedEmail?.split('@')[0] || 'You',
          avatarUrl: storedAvatarUrl,
        };
      }
    };

    const loadRoomRole = async () => {
      try {
        const { userId, displayName, avatarUrl } = getUserInfoFromToken();
        setUserDisplayName(displayName);
        setUserAvatarUrl(avatarUrl || null);

        if (!userId) {
          setIsHost(false);
          return;
        }

        let lastError: unknown = null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            const response = await api.get<RoomDetails>(`/rooms/${roomCode}`);
            setIsHost(response.data?.hostId === userId);
            setGroupName(response.data?.group_name ?? null);
            return;
          } catch (lookupError: any) {
            lastError = lookupError;
            if (lookupError?.response?.status !== 404 || attempt === 2) {
              throw lookupError;
            }

            await new Promise((resolve) => window.setTimeout(resolve, 500));
          }
        }

        throw lastError ?? new Error('Failed to load room details');
      } catch (error) {
        console.error('Failed to determine host role', error);
        setIsHost(false);
      }
    };

    void loadRoomRole();
  }, [roomCode]);

  const handleEndCall = async () => {
    setIsEndingCall(true);

    try {
      await api.post(`/rooms/${roomCode}/end`);
      router.push('/dashboard');
    } catch (error) {
      console.error('Failed to end call', error);
      setIsEndingCall(false);
    }
  };

  const handleSendMessage = () => {
    const text = chatInput.trim();
    if (!text) return;

    sendMessage(text);
    setChatInput('');
  };

  const handleLeaveCall = () => {
    router.push('/dashboard');
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden app-root text-white">
      <header className="border-b px-6 py-4" style={{ borderColor: 'var(--border)', background: 'linear-gradient(180deg, rgba(255,255,255,0.02), transparent)' }}>
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 rounded-2xl border px-5 py-4" style={{ borderColor: 'var(--border)', background: 'rgba(255,255,255,0.012)' }}>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Room {roomCode}</h1>
            {groupName && (
              <p className="mt-1 inline-flex items-center gap-2 text-xs font-medium text-white/60">
                <span aria-hidden="true" className="text-white/50">◦</span>
                <span>{groupName}</span>
              </p>
            )}
            <p className="text-sm muted">Connected peers: {connectedPeerIds.length}</p>
          </div>
        </div>
      </header>

      <main className={`${isChatOpen ? 'grid min-h-0 flex-1 gap-6 px-6 py-5 lg:grid-cols-[minmax(0,1fr)_24rem]' : 'flex min-h-0 flex-1 gap-6 px-6 py-5 items-start'} overflow-hidden`}>
        <section className="min-h-0 flex-1 rounded-3xl card p-5 overflow-hidden">
          {mediaError && (
            <div className="mb-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
              {mediaError}
            </div>
          )}

          {meetingTiles.length > 1 ? (
            <div className="flex h-full min-h-0 items-center gap-4">
              <button
                type="button"
                onClick={() => setTilePage((current) => Math.max(0, current - 1))}
                disabled={tilePage === 0 || meetingTiles.length <= 2}
                className="btn flex h-14 w-14 self-center items-center justify-center rounded-full text-lg font-semibold disabled:opacity-40"
                aria-label="Previous tiles"
              >
                ←
              </button>

              <div className={`grid flex-1 gap-5 self-stretch ${visibleTiles.length === 1 ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2'}`}>
                {visibleTiles.map((tile) =>
                  tile.kind === 'stream' ? (
                    <VideoTile
                      key={tile.key}
                      stream={tile.stream}
                      label={tile.label}
                      muted={tile.muted}
                      avatarUrl={tile.key === 'local' ? userAvatarUrl : tile.avatarUrl}
                      videoOn={tile.key === 'local' ? isVideoOn : tile.videoOn}
                    />
                  ) : (
                    <VideoTile
                      key={tile.key}
                      stream={null}
                      label={tile.label}
                      muted={false}
                      avatarUrl={tile.avatarUrl}
                      videoOn={tile.videoOn}
                    />
                  )
                )}
              </div>

              <button
                type="button"
                onClick={() => setTilePage((current) => Math.min(pageCount - 1, current + 1))}
                disabled={tilePage >= pageCount - 1 || meetingTiles.length <= 2}
                className="btn flex h-14 w-14 self-center items-center justify-center rounded-full text-lg font-semibold disabled:opacity-40"
                aria-label="Next tiles"
              >
                →
              </button>
            </div>
          ) : (
            <div className="mx-auto flex h-full max-w-5xl items-center">
              <div className="grid grid-cols-1 gap-5">
                {visibleTiles.map((tile) =>
                  tile.kind === 'stream' ? (
                    <VideoTile
                      key={tile.key}
                      stream={tile.stream}
                      label={tile.label}
                      muted={tile.muted}
                      avatarUrl={tile.key === 'local' ? userAvatarUrl : tile.avatarUrl}
                      videoOn={tile.key === 'local' ? isVideoOn : tile.videoOn}
                    />
                  ) : (
                    <VideoTile
                      key={tile.key}
                      stream={null}
                      label={tile.label}
                      muted={false}
                      avatarUrl={tile.avatarUrl}
                      videoOn={tile.videoOn}
                    />
                  )
                )}
              </div>
            </div>
          )}

          {!localStream && (
            <div className="mt-4 rounded-2xl tile p-6 text-center text-sm text-muted">
              Local media not available. You can still connect and receive peer streams.
            </div>
          )}
        </section>

        {isChatOpen && (
          <aside className="w-full self-start rounded-3xl card p-4 shadow-2xl shadow-black/30 lg:sticky lg:top-6 lg:max-h-[calc(100vh-10rem)] lg:flex-none">
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: 'var(--border)' }}>
                <div>
                  <h2 className="text-base font-semibold">Chat</h2>
                  <p className="text-sm muted">In-call messages</p>
                </div>
              </div>

              <div className="flex-1 space-y-3 overflow-auto py-4 text-sm">
                {messages.length === 0 ? (
                  <p className="muted">No messages yet.</p>
                ) : (
                  messages.map((message, index) => (
                    <div key={`${message.senderId}-${message.timestamp}-${index}`} className="rounded-xl tile px-3 py-2">
                      <p className="text-xs muted">{message.senderName}</p>
                      <p className="text-sm">{message.text}</p>
                    </div>
                  ))
                )}
              </div>

              <div className="mt-3 flex gap-2 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
                <input
                  type="text"
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  placeholder="Type a message"
                  className="auth-input flex-1"
                />
                <button type="button" onClick={handleSendMessage} className="btn px-3 py-2">
                  Send
                </button>
              </div>
            </div>
          </aside>
        )}
      </main>

      <footer className="fixed bottom-0 left-0 right-0 z-40 border-t px-6 py-4 backdrop-blur" style={{ borderColor: 'var(--border)', background: 'rgba(15, 23, 36, 0.9)' }}>
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-4">
          <button
            type="button"
            onClick={toggleAudio}
            className={`rounded-full px-5 py-3 text-sm font-medium transition ${isAudioOn ? 'btn' : 'btn-danger'}`}
          >
            {isAudioOn ? '🎤 Mute' : '🔇 Unmute'}
          </button>

          <button
            type="button"
            onClick={toggleVideo}
            className={`rounded-full px-5 py-3 text-sm font-medium transition ${isVideoOn ? 'btn' : 'btn-danger'}`}
          >
            {isVideoOn ? '📹 Camera On' : '📹 Camera Off'}
          </button>

          {isHost ? (
            <button type="button" onClick={handleEndCall} disabled={isEndingCall} className="rounded-full btn-danger px-5 py-3 text-sm font-medium">
              {isEndingCall ? 'Ending call...' : 'End call'}
            </button>
          ) : (
            <button type="button" onClick={handleLeaveCall} className="rounded-full btn px-5 py-3 text-sm font-medium">
              Leave call
            </button>
          )}

          <button type="button" onClick={() => setIsChatOpen((current) => !current)} className="rounded-full btn-ghost px-5 py-3 text-sm font-medium">
            {isChatOpen ? 'Hide chat' : 'Chat'}
          </button>
        </div>
      </footer>
    </div>
  );
}
