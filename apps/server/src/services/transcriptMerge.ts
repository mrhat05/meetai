import type { TranscriptSegment } from '../../lib/transcribeAudio.js';

export type SpeakerTrack = {
  speaker: string;
  offsetMs: number;
  segments: TranscriptSegment[];
};

function formatSecondsToMMSS(totalSecondsValue: number): string {
  const totalSeconds = Math.max(0, Math.floor(totalSecondsValue));
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

/**
 * Merges per-speaker transcript tracks into one chronological transcript.
 * Each track's segment timestamps are shifted by the track's recording offset
 * (relative to the meeting recording session start), then all segments are
 * interleaved by absolute time as "[MM:SS] Speaker: text" lines.
 */
export function mergeSpeakerSegments(tracks: SpeakerTrack[]): string {
  const merged = tracks.flatMap((track) =>
    track.segments
      .filter((segment) => segment.text.trim().length > 0)
      .map((segment) => ({
        speaker: track.speaker,
        atSeconds: track.offsetMs / 1000 + segment.start,
        text: segment.text.trim(),
      })),
  );

  merged.sort((a, b) => a.atSeconds - b.atSeconds);

  return merged
    .map((line) => `[${formatSecondsToMMSS(line.atSeconds)}] ${line.speaker}: ${line.text}`)
    .join('\n');
}
