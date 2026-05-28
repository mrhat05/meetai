'use client';

import { useEffect, useState } from 'react';

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

export default function useLocalStream(): UseLocalStreamResult {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isVideoOn, setIsVideoOn] = useState(false);
  const [isAudioOn, setIsAudioOn] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const startStream = async () => {
      try {
        setMediaError(null);
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });

        if (!isMounted) {
          mediaStream.getTracks().forEach((track) => track.stop());
          return;
        }

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
            audio: true,
          });

          if (!isMounted) {
            fallbackStream.getTracks().forEach((track) => track.stop());
            return;
          }

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
