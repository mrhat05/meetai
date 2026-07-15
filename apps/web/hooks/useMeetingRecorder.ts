'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type RecordedTrack = {
  blob: Blob;
  speaker: string;
  offsetMs: number;
};

type TrackRecorder = {
  recorder: MediaRecorder;
  chunks: Blob[];
  speaker: string;
  startedAtMs: number;
  /** Only the local mic recorder owns its stream and must stop its tracks. */
  ownedStream: MediaStream | null;
  stopped: Promise<void>;
  resolveStopped: () => void;
};

const MAX_TRACKS = 10;
const TIMESLICE_MS = 5000;

type UseMeetingRecorderResult = {
  startSession: (localSpeaker: string) => Promise<void>;
  addRemoteTrack: (peerId: string, stream: MediaStream, speaker: string) => void;
  removeRemoteTrack: (peerId: string) => void;
  stopSession: () => Promise<RecordedTrack[] | null>;
  isRecording: boolean;
};

/**
 * Records one audio track per speaker during a meeting: the local microphone
 * plus each remote peer's incoming audio. Each track remembers when it started
 * relative to the session so the server can merge transcripts chronologically.
 */
export default function useMeetingRecorder(): UseMeetingRecorderResult {
  const [isRecording, setIsRecording] = useState(false);
  const sessionStartRef = useRef<number | null>(null);
  // Active recorders keyed by track id; finished tracks accumulate in doneRef.
  const activeRef = useRef<Map<string, TrackRecorder>>(new Map());
  const doneRef = useRef<TrackRecorder[]>([]);
  const generationRef = useRef(0);

  const createTrackRecorder = useCallback(
    (key: string, stream: MediaStream, speaker: string, ownedStream: MediaStream | null) => {
      if (activeRef.current.has(key) || activeRef.current.size >= MAX_TRACKS) {
        return;
      }

      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      } catch (recorderError) {
        console.error(`Failed to start recorder for ${speaker}:`, recorderError);
        return;
      }

      let resolveStopped = () => {};
      const stopped = new Promise<void>((resolve) => {
        resolveStopped = resolve;
      });

      const entry: TrackRecorder = {
        recorder,
        chunks: [],
        speaker,
        startedAtMs: Date.now(),
        ownedStream,
        stopped,
        resolveStopped,
      };

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          entry.chunks.push(event.data);
        }
      };

      const finalize = () => {
        entry.ownedStream?.getTracks().forEach((track) => track.stop());
        entry.resolveStopped();
      };

      recorder.onstop = finalize;
      recorder.onerror = (event) => {
        console.error(`Recorder error for ${speaker}:`, event);
        finalize();
      };

      recorder.start(TIMESLICE_MS);
      activeRef.current.set(key, entry);
    },
    [],
  );

  const stopTrack = useCallback((key: string) => {
    const entry = activeRef.current.get(key);
    if (!entry) return;

    activeRef.current.delete(key);
    doneRef.current.push(entry);

    if (entry.recorder.state === 'recording') {
      entry.recorder.stop();
    } else {
      entry.resolveStopped();
    }
  }, []);

  const startSession = useCallback(
    async (localSpeaker: string) => {
      if (sessionStartRef.current !== null) {
        return;
      }

      sessionStartRef.current = Date.now();
      doneRef.current = [];

      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      createTrackRecorder('local', micStream, localSpeaker, micStream);
      setIsRecording(true);
    },
    [createTrackRecorder],
  );

  const addRemoteTrack = useCallback(
    (peerId: string, stream: MediaStream, speaker: string) => {
      if (sessionStartRef.current === null) return;

      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) return;

      // One active recorder per peer; a rejoining peer gets a new generation.
      const alreadyActive = Array.from(activeRef.current.keys()).some((key) => key.startsWith(`${peerId}:`));
      if (alreadyActive) return;

      generationRef.current += 1;
      const key = `${peerId}:${generationRef.current}`;
      const audioOnlyStream = new MediaStream([audioTrack]);

      createTrackRecorder(key, audioOnlyStream, speaker, null);

      audioTrack.addEventListener('ended', () => stopTrack(key), { once: true });
    },
    [createTrackRecorder, stopTrack],
  );

  const removeRemoteTrack = useCallback(
    (peerId: string) => {
      for (const key of Array.from(activeRef.current.keys())) {
        if (key.startsWith(`${peerId}:`)) {
          stopTrack(key);
        }
      }
    },
    [stopTrack],
  );

  const stopSession = useCallback(async (): Promise<RecordedTrack[] | null> => {
    const sessionStartMs = sessionStartRef.current;
    if (sessionStartMs === null) {
      return null;
    }

    for (const key of Array.from(activeRef.current.keys())) {
      stopTrack(key);
    }

    const finished = doneRef.current;
    await Promise.all(finished.map((entry) => entry.stopped));

    sessionStartRef.current = null;
    doneRef.current = [];
    setIsRecording(false);

    const tracks = finished
      .filter((entry) => entry.chunks.length > 0)
      .map((entry) => ({
        blob: new Blob(entry.chunks, { type: 'audio/webm' }),
        speaker: entry.speaker,
        offsetMs: Math.max(0, entry.startedAtMs - sessionStartMs),
      }));

    return tracks.length > 0 ? tracks : null;
  }, [stopTrack]);

  useEffect(() => {
    return () => {
      for (const entry of activeRef.current.values()) {
        if (entry.recorder.state === 'recording') {
          entry.recorder.stop();
        }
        entry.ownedStream?.getTracks().forEach((track) => track.stop());
      }
      activeRef.current.clear();
    };
  }, []);

  return {
    startSession,
    addRemoteTrack,
    removeRemoteTrack,
    stopSession,
    isRecording,
  };
}
