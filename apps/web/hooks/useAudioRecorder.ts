'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type UseAudioRecorderResult = {
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<Blob | null>;
  isRecording: boolean;
};

export default function useAudioRecorder(): UseAudioRecorderResult {
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopPromiseRef = useRef<{
    resolve: (blob: Blob | null) => void;
    reject: (error: unknown) => void;
  } | null>(null);

  const cleanupStream = useCallback(() => {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  }, []);

  const startRecording = useCallback(async () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      return;
    }

    const mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false,
    });

    chunksRef.current = [];
    mediaStreamRef.current = mediaStream;

    const mediaRecorder = new MediaRecorder(mediaStream, {
      mimeType: 'audio/webm;codecs=opus',
    });

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      const blob = chunksRef.current.length > 0 ? new Blob(chunksRef.current, { type: 'audio/webm' }) : null;
      chunksRef.current = [];
      mediaRecorderRef.current = null;
      cleanupStream();
      setIsRecording(false);
      stopPromiseRef.current?.resolve(blob);
      stopPromiseRef.current = null;
    };

    mediaRecorder.onerror = (event) => {
      mediaRecorderRef.current = null;
      cleanupStream();
      setIsRecording(false);
      stopPromiseRef.current?.reject(event.error ?? new Error('Failed to record audio'));
      stopPromiseRef.current = null;
    };

    mediaRecorderRef.current = mediaRecorder;
    mediaRecorder.start(5000);
    setIsRecording(true);
  }, [cleanupStream]);

  const stopRecording = useCallback(() => {
    const mediaRecorder = mediaRecorderRef.current;

    if (!mediaRecorder) {
      cleanupStream();
      setIsRecording(false);
      return Promise.resolve(null);
    }

    if (mediaRecorder.state !== 'recording') {
      cleanupStream();
      setIsRecording(false);
      return Promise.resolve(null);
    }

    return new Promise<Blob | null>((resolve, reject) => {
      stopPromiseRef.current = { resolve, reject };
      mediaRecorder.stop();
    });
  }, [cleanupStream]);

  useEffect(() => {
    return () => {
      const mediaRecorder = mediaRecorderRef.current;
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
      } else {
        cleanupStream();
      }
    };
  }, [cleanupStream]);

  return {
    startRecording,
    stopRecording,
    isRecording,
  };
}