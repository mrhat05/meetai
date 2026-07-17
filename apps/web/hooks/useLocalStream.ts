'use client';

import { useEffect, useRef, useState } from 'react';
import type { JoinSettings } from '@/lib/joinSettings';

type UseLocalStreamResult = {
  stream: MediaStream | null;
  isVideoOn: boolean;
  isAudioOn: boolean;
  mediaError: string | null;
  toggleVideo: () => void;
  toggleAudio: () => void;
};

function syncTrackState(stream: MediaStream | null) {
  const videoTrack = stream?.getVideoTracks()[0] ?? null;
  const audioTrack = stream?.getAudioTracks()[0] ?? null;

  return {
    isVideoOn: videoTrack ? videoTrack.enabled : false,
    isAudioOn: audioTrack ? audioTrack.enabled : false,
  };
}

/** Applies the lobby's chosen initial mute/camera state to the acquired tracks. */
function applyInitialState(stream: MediaStream, options?: Partial<JoinSettings>) {
  if (options?.initialAudioOn === false) {
    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) audioTrack.enabled = false;
  }
  if (options?.initialVideoOn === false) {
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) videoTrack.enabled = false;
  }
}

export default function useLocalStream(options?: Partial<JoinSettings>): UseLocalStreamResult {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isVideoOn, setIsVideoOn] = useState(false);
  const [isAudioOn, setIsAudioOn] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  // Captured once — in the real flow the lobby has already fixed these before
  // RoomShell (and thus this hook) mounts, so acquisition stays one-shot.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    let isMounted = true;
    const opts = optionsRef.current;

    const startStream = async () => {
      try {
        setMediaError(null);
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: opts?.videoDeviceId ? { deviceId: { ideal: opts.videoDeviceId } } : true,
          audio: opts?.audioDeviceId ? { deviceId: { ideal: opts.audioDeviceId } } : true,
        });

        if (!isMounted) {
          mediaStream.getTracks().forEach((track) => track.stop());
          return;
        }

        applyInitialState(mediaStream, opts);
        setStream(mediaStream);
        const trackState = syncTrackState(mediaStream);
        setIsVideoOn(trackState.isVideoOn);
        setIsAudioOn(trackState.isAudioOn);
      } catch (error) {
        console.error('Failed to get local media stream', error);

        // Graceful fallback: try audio-only if camera/video device is unavailable or in use.
        try {
          const fallbackStream = await navigator.mediaDevices.getUserMedia({
            video: false,
            audio: opts?.audioDeviceId ? { deviceId: { ideal: opts.audioDeviceId } } : true,
          });

          if (!isMounted) {
            fallbackStream.getTracks().forEach((track) => track.stop());
            return;
          }

          applyInitialState(fallbackStream, opts);
          setStream(fallbackStream);
          const trackState = syncTrackState(fallbackStream);
          setIsVideoOn(trackState.isVideoOn);
          setIsAudioOn(trackState.isAudioOn);
          setMediaError('Camera is unavailable or in use. Joined with audio only.');
        } catch (fallbackError) {
          console.error('Failed to get audio fallback stream', fallbackError);
          setStream(null);
          setIsVideoOn(false);
          setIsAudioOn(false);
          setMediaError('Camera/microphone unavailable. Close other apps using devices and retry.');
        }
      }
    };

    void startStream();

    return () => {
      isMounted = false;
      setStream((currentStream) => {
        currentStream?.getTracks().forEach((track) => track.stop());
        return null;
      });
    };
  }, []);

  const toggleVideo = () => {
    if (!stream) return;
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) return;
    
    videoTrack.enabled = !videoTrack.enabled;
    setIsVideoOn(videoTrack.enabled);
  };

  const toggleAudio = () => {
    if (!stream) return;
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) return;
    
    audioTrack.enabled = !audioTrack.enabled;
    setIsAudioOn(audioTrack.enabled);
  };

  return {
    stream,
    isVideoOn,
    isAudioOn,
    mediaError,
    toggleVideo,
    toggleAudio,
  };
}
