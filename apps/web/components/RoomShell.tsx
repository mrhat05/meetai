'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  LuMic,
  LuMicOff,
  LuVideo,
  LuVideoOff,
  LuPhoneOff,
  LuMessageSquare,
  LuChevronLeft,
  LuChevronRight,
  LuUsers,
  LuSend,
  LuSparkles,
  LuLogOut,
} from 'react-icons/lu';
import api from '@/lib/api';
import useLocalStream from '@/hooks/useLocalStream';
import useWebRTC from '@/hooks/useWebRTC';
import useMeetingRecorder from '@/hooks/useMeetingRecorder';
import VideoTile from '@/components/VideoTile';

type RoomShellProps = {
  roomCode: string;
};

type RoomDetails = {
  hostId: string | null;
  group_name: string | null;
  // Effective opt-in: group meetings inherit the group flag; normal meetings
  // carry their own. The server computes this so the client uses one field.
  summarizer_enabled: boolean;
  group: {
    summarizer_enabled: boolean;
  } | null;
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
  const { peers, peerPresence, connectedPeerIds, messages, sendMessage, meetingEnded } = useWebRTC(roomCode, localStream, isVideoOn);
  const { startSession, addRemoteTrack, removeRemoteTrack, stopSession, isRecording } = useMeetingRecorder();
  const [isHost, setIsHost] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isEndingCall, setIsEndingCall] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [userDisplayName, setUserDisplayName] = useState('You');
  const [userAvatarUrl, setUserAvatarUrl] = useState<string | null>(null);
  const [groupName, setGroupName] = useState<string | null>(null);
  const [summarizerEnabled, setSummarizerEnabled] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [tilePage, setTilePage] = useState(0);
  const summaryUploadPromiseRef = useRef<Promise<boolean> | null>(null);
  const summaryUploadedRef = useRef(false);
  const recordingStartedRef = useRef(false);
  // True only when *this* host explicitly chose "End call" (end for everyone),
  // so that a plain "Leave" (or an unexpected unmount) never ends the meeting.
  const endedByMeRef = useRef(false);

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
    if (!toastMessage) return undefined;

    const timeoutId = window.setTimeout(() => {
      setToastMessage(null);
    }, 2000);

    return () => window.clearTimeout(timeoutId);
  }, [toastMessage]);

  useEffect(() => {
    if (!summarizerEnabled || !isHost || recordingStartedRef.current) {
      return;
    }

    recordingStartedRef.current = true;

    void startSession(userDisplayName).catch((error) => {
      recordingStartedRef.current = false;
      console.error('Failed to start audio recording', error);
    });
  }, [isHost, startSession, summarizerEnabled, userDisplayName]);

  // Keep one audio recorder per remote speaker while the session is running.
  const recordedPeerIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!isRecording) {
      return;
    }

    const currentPeerIds = new Set(peers.keys());

    for (const [peerId, stream] of peers) {
      if (!recordedPeerIdsRef.current.has(peerId)) {
        addRemoteTrack(peerId, stream, peerPresence.get(peerId)?.displayName || 'Guest');
        recordedPeerIdsRef.current.add(peerId);
      }
    }

    for (const peerId of Array.from(recordedPeerIdsRef.current)) {
      if (!currentPeerIds.has(peerId)) {
        removeRemoteTrack(peerId);
        recordedPeerIdsRef.current.delete(peerId);
      }
    }
  }, [addRemoteTrack, isRecording, peerPresence, peers, removeRemoteTrack]);

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
            setSummarizerEnabled(Boolean(response.data?.summarizer_enabled));
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

  const finalizeMeetingSummary = useCallback(
    async ({ showToast }: { showToast: boolean }) => {
      if (!summarizerEnabled || !isHost) {
        return false;
      }

      if (summaryUploadedRef.current) {
        return true;
      }

      if (!summaryUploadPromiseRef.current) {
        summaryUploadPromiseRef.current = (async () => {
          if (showToast) {
            setToastMessage('Ending meeting — minutes will be generated shortly…');
          }

          const tracks = await stopSession();
          if (!tracks || tracks.length === 0) {
            return false;
          }

          const formData = new FormData();
          tracks.forEach((track, index) => {
            formData.append('audio', track.blob, `track-${index}.webm`);
          });
          formData.append(
            'manifest',
            JSON.stringify({
              tracks: tracks.map((track, index) => ({
                index,
                speaker: track.speaker,
                offsetMs: track.offsetMs,
              })),
            })
          );

          await api.post(`/rooms/${roomCode}/end-with-summary`, formData);
          summaryUploadedRef.current = true;

          return true;
        })();
      }

      try {
        return await summaryUploadPromiseRef.current;
      } finally {
        summaryUploadPromiseRef.current = null;
      }
    },
    [isHost, roomCode, stopSession, summarizerEnabled]
  );

  useEffect(() => {
    return () => {
      // Only finalize (and thereby end) the meeting when the host deliberately
      // ended it. A plain "Leave" just stops the local recording and walks away
      // (the recorder hook cleans up its own recorders on unmount).
      if (endedByMeRef.current && summarizerEnabled && isHost) {
        void finalizeMeetingSummary({ showToast: false }).catch((error) => {
          console.error('Failed to finalize meeting summary on unmount', error);
        });
      }
    };
  }, [finalizeMeetingSummary, isHost, summarizerEnabled]);

  // When the host ends the meeting for everyone, the server broadcasts
  // `meeting-ended`. Every other participant is dropped back to the dashboard.
  useEffect(() => {
    if (!meetingEnded || endedByMeRef.current) {
      return undefined;
    }

    setToastMessage('This meeting was ended by the host');
    const timeoutId = window.setTimeout(() => {
      router.push('/dashboard');
    }, 1300);

    return () => window.clearTimeout(timeoutId);
  }, [meetingEnded, router]);

  const handleEndCall = async () => {
    setIsEndingCall(true);
    endedByMeRef.current = true;

    try {
      if (summarizerEnabled && isHost) {
        const summaryGenerated = await finalizeMeetingSummary({ showToast: true });

        if (!summaryGenerated) {
          await api.post(`/rooms/${roomCode}/end`);
        }
      } else {
        await api.post(`/rooms/${roomCode}/end`);
      }

      router.push('/dashboard');
    } catch (error) {
      console.error('Failed to end call', error);
      endedByMeRef.current = false;
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
    <div className="flex h-screen flex-col overflow-hidden app-root text-white supports-[height:100dvh]:h-[100dvh]">
      {toastMessage && (
        <div className="fixed left-1/2 top-6 z-50 -translate-x-1/2 rounded-full border border-amber-300/30 bg-amber-400/20 px-4 py-3 text-sm font-medium text-amber-50 shadow-xl shadow-black/25 backdrop-blur-md">
          {toastMessage}
        </div>
      )}

      <header className="px-4 pt-4 sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 rounded-2xl border px-5 py-3.5" style={{ borderColor: 'var(--border)', background: 'rgba(255,255,255,0.02)' }}>
          <div className="flex items-center gap-3">
            <span className="brand-mark text-base" style={{ width: '2.2rem', height: '2.2rem' }}>M</span>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-display text-lg font-semibold tracking-tight">Room</h1>
                <span className="chip font-mono text-xs uppercase tracking-wide">{roomCode}</span>
              </div>
              {groupName && (
                <p className="mt-0.5 inline-flex items-center gap-1.5 text-xs font-medium text-white/55">
                  <LuUsers aria-hidden="true" className="text-[0.8rem]" /> {groupName}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {summarizerEnabled && (
              <span className="chip text-xs" style={{ color: 'var(--accent)' }}>
                <LuSparkles aria-hidden="true" /> AI minutes on
              </span>
            )}
            <span className="badge">
              <span className="dot-live" />
              {connectedPeerIds.length + 1} in call
            </span>
          </div>
        </div>
      </header>

      <main className={`${isChatOpen ? 'grid min-h-0 flex-1 gap-6 px-4 pb-28 pt-4 sm:px-6 sm:pb-24 sm:pt-5 lg:grid-cols-[minmax(0,1fr)_24rem]' : 'flex min-h-0 flex-1 items-start gap-6 px-4 pb-28 pt-4 sm:px-6 sm:pb-24 sm:pt-5'} overflow-hidden`}>
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
                className="btn flex h-11 w-11 self-center items-center justify-center rounded-full text-lg font-semibold disabled:opacity-40 sm:h-14 sm:w-14"
                aria-label="Previous tiles"
              >
                <LuChevronLeft aria-hidden="true" />
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
                className="btn flex h-11 w-11 self-center items-center justify-center rounded-full text-lg font-semibold disabled:opacity-40 sm:h-14 sm:w-14"
                aria-label="Next tiles"
              >
                <LuChevronRight aria-hidden="true" />
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
              <div className="flex items-center gap-2.5 border-b pb-3" style={{ borderColor: 'var(--border)' }}>
                <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border)] bg-white/5 text-[var(--accent)]">
                  <LuMessageSquare aria-hidden="true" />
                </span>
                <div>
                  <h2 className="text-base font-semibold">Chat</h2>
                  <p className="text-xs muted">In-call messages</p>
                </div>
              </div>

              <div className="flex-1 space-y-2.5 overflow-auto py-4 text-sm">
                {messages.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                    <LuMessageSquare aria-hidden="true" className="text-2xl text-faint" />
                    <p className="muted">No messages yet.</p>
                  </div>
                ) : (
                  messages.map((message, index) => (
                    <div key={`${message.senderId}-${message.timestamp}-${index}`} className="rounded-xl tile px-3 py-2.5">
                      <p className="text-xs font-medium text-[var(--accent)]">{message.senderName}</p>
                      <p className="mt-0.5 text-sm leading-6">{message.text}</p>
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
                <button type="button" onClick={handleSendMessage} className="btn flex h-11 w-11 shrink-0 items-center justify-center px-0" aria-label="Send message">
                  <LuSend aria-hidden="true" />
                </button>
              </div>
            </div>
          </aside>
        )}
      </main>

      <footer className="fixed bottom-0 left-0 right-0 z-40 border-t px-4 pt-4 backdrop-blur-xl sm:px-6" style={{ borderColor: 'var(--border)', background: 'rgba(9, 13, 24, 0.82)', paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
        <div className="mx-auto flex max-w-7xl items-center justify-center gap-2.5 sm:gap-3">
          <button
            type="button"
            onClick={toggleAudio}
            aria-label={isAudioOn ? 'Mute microphone' : 'Unmute microphone'}
            className={`flex h-13 w-13 items-center justify-center rounded-full text-lg sm:h-14 sm:w-14 ${isAudioOn ? 'btn' : 'btn-danger'}`}
          >
            {isAudioOn ? <LuMic aria-hidden="true" /> : <LuMicOff aria-hidden="true" />}
          </button>

          <button
            type="button"
            onClick={toggleVideo}
            aria-label={isVideoOn ? 'Turn camera off' : 'Turn camera on'}
            className={`flex h-13 w-13 items-center justify-center rounded-full text-lg sm:h-14 sm:w-14 ${isVideoOn ? 'btn' : 'btn-danger'}`}
          >
            {isVideoOn ? <LuVideo aria-hidden="true" /> : <LuVideoOff aria-hidden="true" />}
          </button>

          <button
            type="button"
            onClick={() => setIsChatOpen((current) => !current)}
            aria-label={isChatOpen ? 'Hide chat' : 'Show chat'}
            className={`flex h-13 w-13 items-center justify-center rounded-full text-lg sm:h-14 sm:w-14 ${isChatOpen ? 'btn-primary' : 'btn'}`}
          >
            <LuMessageSquare aria-hidden="true" />
          </button>

          <div className="mx-1 hidden h-8 w-px bg-[var(--border-strong)] sm:block" />

          <button
            type="button"
            onClick={handleLeaveCall}
            disabled={isEndingCall}
            className="btn h-13 gap-2 rounded-full px-5 sm:h-14 sm:px-6"
          >
            <LuLogOut aria-hidden="true" />
            <span className="hidden sm:inline">Leave</span>
          </button>

          {isHost && (
            <button
              type="button"
              onClick={handleEndCall}
              disabled={isEndingCall}
              className="btn btn-danger h-13 gap-2 rounded-full px-5 sm:h-14 sm:px-6"
              title="End the meeting for everyone"
            >
              <LuPhoneOff aria-hidden="true" />
              <span className="hidden sm:inline">{isEndingCall ? 'Ending…' : 'End call'}</span>
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
