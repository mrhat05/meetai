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
      <div
        className="group tile relative w-full overflow-hidden rounded-2xl border border-[var(--border-strong)] shadow-[var(--shadow)]"
        style={{ aspectRatio: '16 / 9', maxWidth: 640 }}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={muted}
          className={`h-full w-full bg-black object-cover transition-opacity duration-300 ${shouldShowFallback ? 'opacity-0' : 'opacity-100'}`}
        />

        {shouldShowFallback && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[radial-gradient(circle_at_top,rgba(124,108,246,0.2),transparent_55%),linear-gradient(180deg,rgba(13,19,34,0.94),rgba(6,9,18,0.98))] text-center">
            <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border font-display" style={{ borderColor: 'rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)' }}>
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt={`${label} avatar`} className="h-full w-full object-cover" />
              ) : (
                <span className="gradient-text text-2xl font-semibold">{getInitials(label)}</span>
              )}
            </div>
            <p className="text-xs text-faint">Camera off</p>
          </div>
        )}

        {/* Name overlay */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2.5 pt-6">
          <span className="truncate text-sm font-medium text-white drop-shadow">{label}</span>
          {muted && (
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-black/50 text-white/90" aria-label="You">
              <span className="text-[0.65rem] font-semibold">You</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}