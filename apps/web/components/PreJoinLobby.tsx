'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  LuMic, LuMicOff, LuVideo, LuVideoOff, LuSparkles, LuArrowRight, LuArrowLeft, LuTriangleAlert,
} from 'react-icons/lu';
import api from '@/lib/api';
import AppHeader from '@/components/AppHeader';
import type { JoinSettings } from '@/lib/joinSettings';

type PreJoinLobbyProps = {
  roomCode: string;
  onJoin: (settings: JoinSettings) => void;
};

type RoomInfo = {
  hostId: string | null;
  group_name: string | null;
  summarizer_enabled: boolean;
  group: { summarizer_enabled: boolean } | null;
};

function decodeUserId(): string | null {
  try {
    const token = window.localStorage.getItem('accessToken');
    if (!token) return null;
    const [, payload] = token.split('.');
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const parsed = JSON.parse(window.atob(padded)) as { userId?: string };
    return parsed.userId ?? null;
  } catch {
    return null;
  }
}

export default function PreJoinLobby({ roomCode, onJoin }: PreJoinLobbyProps) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState<string>('');
  const [micId, setMicId] = useState<string>('');
  const [mediaError, setMediaError] = useState<string | null>(null);

  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [isTogglingAi, setIsTogglingAi] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);

  const currentUserId = useMemo(() => decodeUserId(), []);
  const isGroupMeeting = Boolean(room?.group);
  const isHost = Boolean(room && currentUserId && room.hostId === currentUserId);
  const canToggleAi = isHost && !isGroupMeeting;

  // Room context (name, host, AI-minutes status).
  useEffect(() => {
    let active = true;
    api
      .get<RoomInfo>(`/rooms/${roomCode}`)
      .then(({ data }) => {
        if (!active) return;
        setRoom(data);
        setAiEnabled(Boolean(data.summarizer_enabled));
      })
      .catch((error: any) => {
        if (!active) return;
        setRoomError(error?.response?.status === 404 ? 'This meeting was not found or has ended.' : 'Could not load meeting details.');
      });
    return () => { active = false; };
  }, [roomCode]);

  // Acquire / re-acquire the preview stream for the selected devices.
  useEffect(() => {
    let active = true;

    const acquire = async () => {
      // Stop any previous preview before switching devices.
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;

      try {
        setMediaError(null);
        const stream = await navigator.mediaDevices.getUserMedia({
          video: cameraId ? { deviceId: { ideal: cameraId } } : true,
          audio: micId ? { deviceId: { ideal: micId } } : true,
        });
        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        // Reflect the current toggle state onto the fresh tracks.
        const videoTrack = stream.getVideoTracks()[0];
        const audioTrack = stream.getAudioTracks()[0];
        if (videoTrack) videoTrack.enabled = camOn;
        if (audioTrack) audioTrack.enabled = micOn;

        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;

        // Populate device lists (labels are available now that permission is granted).
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (!active) return;
        const videoInputs = devices.filter((d) => d.kind === 'videoinput');
        const audioInputs = devices.filter((d) => d.kind === 'audioinput');
        setCameras(videoInputs);
        setMics(audioInputs);
        // Select the device actually in use (so the dropdown reflects reality),
        // falling back to the first available so the controlled select always
        // matches a rendered option.
        if (!cameraId) {
          const activeCam = videoTrack ? videoInputs.find((d) => d.label === videoTrack.label) : undefined;
          const nextCam = activeCam?.deviceId || videoInputs[0]?.deviceId;
          if (nextCam) setCameraId(nextCam);
        }
        if (!micId) {
          const activeMic = audioTrack ? audioInputs.find((d) => d.label === audioTrack.label) : undefined;
          const nextMic = activeMic?.deviceId || audioInputs[0]?.deviceId;
          if (nextMic) setMicId(nextMic);
        }
      } catch (error) {
        console.error('Lobby preview failed', error);
        if (active) setMediaError('Camera/microphone unavailable. Check permissions and that no other app is using them.');
      }
    };

    void acquire();
    return () => {
      active = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
    // Re-acquire only when the chosen device changes (not on every toggle).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraId, micId]);

  const toggleMic = () => {
    setMicOn((prev) => {
      const next = !prev;
      const track = streamRef.current?.getAudioTracks()[0];
      if (track) track.enabled = next;
      return next;
    });
  };

  const toggleCam = () => {
    setCamOn((prev) => {
      const next = !prev;
      const track = streamRef.current?.getVideoTracks()[0];
      if (track) track.enabled = next;
      return next;
    });
  };

  const handleToggleAi = async () => {
    if (!canToggleAi || isTogglingAi) return;
    const next = !aiEnabled;
    setIsTogglingAi(true);
    setAiEnabled(next); // optimistic
    try {
      await api.patch(`/rooms/${roomCode}`, { summarizerEnabled: next });
    } catch (error) {
      console.error('Failed to toggle AI minutes', error);
      setAiEnabled(!next); // roll back
    } finally {
      setIsTogglingAi(false);
    }
  };

  const handleJoin = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    onJoin({
      audioDeviceId: micId || undefined,
      videoDeviceId: cameraId || undefined,
      initialAudioOn: micOn,
      initialVideoOn: camOn,
    });
  };

  if (roomError) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 app-root">
        <div className="card card-hero animate-pop-in max-w-sm p-8 text-center">
          <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-rose-500/20 bg-rose-500/10 text-rose-300">
            <LuTriangleAlert aria-hidden="true" />
          </span>
          <p className="mb-1 font-display text-xl font-semibold">Can&apos;t join this meeting</p>
          <p className="mb-6 text-sm muted">{roomError}</p>
          <button onClick={() => router.push('/dashboard')} className="btn btn-primary mx-auto">Back to dashboard</button>
        </div>
      </main>
    );
  }

  const meetingLabel = room?.group_name || `Meeting ${roomCode}`;

  return (
    <main className="min-h-screen app-root px-4 py-6 text-white sm:px-6 sm:py-10">
      <div className="mx-auto max-w-5xl">
        <AppHeader />

        <div className="mb-6">
          <p className="eyebrow">Ready to join</p>
          <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight sm:text-3xl">{meetingLabel}</h1>
        </div>

        <div className="card grid gap-6 p-5 md:grid-cols-[1.4fr_1fr] md:p-6">
          {/* Preview */}
          <div className="relative overflow-hidden rounded-2xl border border-[var(--border)] bg-black/60 aspect-video">
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className={`h-full w-full object-cover ${camOn ? '' : 'invisible'}`}
            />
            {!camOn && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/60">
                <LuVideoOff aria-hidden="true" className="text-2xl" />
                <span className="text-sm">Camera is off</span>
              </div>
            )}
            {mediaError && (
              <div className="absolute inset-x-3 top-3 rounded-xl border border-rose-500/20 bg-rose-500/15 px-3 py-2 text-xs text-rose-100 backdrop-blur">
                {mediaError}
              </div>
            )}
            {/* Overlay toggles */}
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-3 bg-gradient-to-t from-black/70 to-transparent p-4">
              <button
                type="button"
                onClick={toggleMic}
                className={`flex h-12 w-12 items-center justify-center rounded-full text-lg ${micOn ? 'btn' : 'btn-danger'}`}
                aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'}
                aria-pressed={!micOn}
              >
                {micOn ? <LuMic aria-hidden="true" /> : <LuMicOff aria-hidden="true" />}
              </button>
              <button
                type="button"
                onClick={toggleCam}
                className={`flex h-12 w-12 items-center justify-center rounded-full text-lg ${camOn ? 'btn' : 'btn-danger'}`}
                aria-label={camOn ? 'Turn camera off' : 'Turn camera on'}
                aria-pressed={!camOn}
              >
                {camOn ? <LuVideo aria-hidden="true" /> : <LuVideoOff aria-hidden="true" />}
              </button>
            </div>
          </div>

          {/* Controls */}
          <div className="flex flex-col gap-4">
            <div>
              <label htmlFor="lobby-camera" className="mb-1.5 block text-xs font-medium text-white/70">Camera</label>
              <select
                id="lobby-camera"
                value={cameraId}
                onChange={(e) => setCameraId(e.target.value)}
                className="auth-input w-full"
              >
                {cameras.length === 0 && <option value="">Default camera</option>}
                {cameras.map((cam, i) => (
                  <option key={cam.deviceId || i} value={cam.deviceId}>{cam.label || `Camera ${i + 1}`}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="lobby-mic" className="mb-1.5 block text-xs font-medium text-white/70">Microphone</label>
              <select
                id="lobby-mic"
                value={micId}
                onChange={(e) => setMicId(e.target.value)}
                className="auth-input w-full"
              >
                {mics.length === 0 && <option value="">Default microphone</option>}
                {mics.map((mic, i) => (
                  <option key={mic.deviceId || i} value={mic.deviceId}>{mic.label || `Microphone ${i + 1}`}</option>
                ))}
              </select>
            </div>

            {/* AI minutes */}
            <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-white/[0.02] px-3.5 py-3">
              <span className="inline-flex items-center gap-2 text-sm text-white/85">
                <LuSparkles aria-hidden="true" className="text-violet-200" /> AI minutes
              </span>
              {canToggleAi ? (
                <button
                  type="button"
                  onClick={handleToggleAi}
                  disabled={isTogglingAi}
                  role="switch"
                  aria-checked={aiEnabled}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition ${aiEnabled ? 'bg-[var(--primary)]' : 'bg-white/15'}`}
                  aria-label="Toggle AI minutes"
                >
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${aiEnabled ? 'left-[1.375rem]' : 'left-0.5'}`} />
                </button>
              ) : (
                <span className={`text-xs font-semibold ${aiEnabled ? 'text-emerald-300' : 'text-white/50'}`}>
                  {aiEnabled ? 'On' : 'Off'}
                </span>
              )}
            </div>
            {isGroupMeeting && (
              <p className="-mt-2 text-xs text-faint">Group meetings control AI minutes in group settings.</p>
            )}

            <div className="mt-auto flex flex-col gap-2 pt-2">
              <button onClick={handleJoin} className="btn btn-primary h-12 w-full">
                Join now <LuArrowRight aria-hidden="true" />
              </button>
              <button onClick={() => router.push('/dashboard')} className="btn btn-ghost h-11 w-full">
                <LuArrowLeft aria-hidden="true" /> Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
