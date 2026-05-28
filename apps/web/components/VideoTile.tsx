'use client';

import { useEffect, useRef } from 'react';

type VideoTileProps = {
  stream: MediaStream | null;
  label: string;
  muted?: boolean;
  avatarUrl?: string | null;
  videoOn?: boolean;
};

function getInitials(label: string) {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export default function VideoTile({ stream, label, muted = false, avatarUrl, videoOn }: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hasVideoTrack = Boolean(stream?.getVideoTracks().length);
  const shouldShowFallback = !stream || videoOn === false || !hasVideoTrack;

  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) return;

    videoElement.srcObject = stream;

    return () => {
      videoElement.srcObject = null;
    };
  }, [stream]);

  return (
    <div className="flex w-full flex-col items-center gap-2">
      <div className="tile shadow-lg relative w-full overflow-hidden rounded-2xl" style={{ aspectRatio: '16 / 9', maxWidth: 640 }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={muted}
          className={`h-full w-full bg-black object-cover transition-opacity ${shouldShowFallback ? 'opacity-0' : 'opacity-100'}`}
        />

        {shouldShowFallback && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[radial-gradient(circle_at_top,rgba(108,92,231,0.16),transparent_50%),linear-gradient(180deg,rgba(15,23,36,0.92),rgba(10,15,24,0.96))] text-center">
            <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border" style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)' }}>
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt={`${label} avatar`} className="h-full w-full object-cover" />
              ) : (
                <span className="text-2xl font-semibold">{getInitials(label)}</span>
              )}
            </div>
            <div>
              <p className="text-sm font-semibold">{label}</p>
              <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>Camera off</p>
            </div>
          </div>
        )}
      </div>
      <p className="text-sm muted">{label}</p>
    </div>
  );
}