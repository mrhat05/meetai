import { createReadStream } from 'node:fs';
import Groq from 'groq-sdk';

const groqApiKey = process.env.GROQ_API_KEY?.trim();
const groq = groqApiKey ? new Groq({ apiKey: groqApiKey }) : null;

export type TranscriptSegment = {
  start: number;
  text: string;
};

// Deterministic segments used by the automated test suite so it never hits
// the real Groq API. Enabled with AI_STUB=1.
const STUB_SEGMENTS: TranscriptSegment[] = [
  { start: 0, text: 'Welcome everyone to the weekly sync.' },
  { start: 5, text: 'We agreed to ship the release on Friday.' },
  { start: 11, text: 'Alex will send the report by Wednesday.' },
];

function formatSecondsToMMSS(secondsValue: unknown): string {
  const totalSeconds = Math.max(0, Math.floor(Number(secondsValue) || 0));
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

/**
 * Transcribes one audio file and returns raw timestamped segments.
 * An empty array means the audio genuinely contained no speech. Transient
 * failures (Groq 429/5xx, network, missing key) THROW so the queue worker
 * can retry the job. The caller owns the file's lifetime — it must survive
 * across retry attempts and is deleted only once the whole job succeeds.
 */
export async function transcribeAudioSegments(audioFilePath: string): Promise<TranscriptSegment[]> {
  if (process.env.AI_STUB === '1') {
    return STUB_SEGMENTS;
  }

  try {
    if (!groq) {
      throw new Error('GROQ_API_KEY is not configured');
    }

    const audioStream = createReadStream(audioFilePath);
    const response = (await groq.audio.transcriptions.create({
      file: audioStream,
      model: 'whisper-large-v3-turbo',
      response_format: 'verbose_json',
      language: 'en',
    })) as unknown as {
      segments?: Array<{ start?: number; text?: string }>;
    };

    const segments = Array.isArray(response?.segments) ? response.segments : [];
    return segments
      .map((segment) => ({
        start: Math.max(0, Number(segment.start) || 0),
        text: (segment.text ?? '').trim(),
      }))
      .filter((segment) => segment.text.length > 0);
  } catch (error) {
    console.error('transcribeAudioSegments failed:', error);
    throw error;
  }
}

export function formatSegments(segments: TranscriptSegment[]): string {
  return segments
    .map((segment) => (segment.text ? `[${formatSecondsToMMSS(segment.start)}] ${segment.text}` : ''))
    .filter(Boolean)
    .join('\n');
}

/**
 * Back-compat helper: transcribes one file and returns "[MM:SS] text" lines.
 */
export async function transcribeAudio(audioFilePath: string): Promise<string> {
  const segments = await transcribeAudioSegments(audioFilePath);
  return formatSegments(segments);
}
