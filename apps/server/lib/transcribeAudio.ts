import { createReadStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import Groq from 'groq-sdk';

const groqApiKey = process.env.GROQ_API_KEY?.trim();
const groq = groqApiKey ? new Groq({ apiKey: groqApiKey }) : null;

function formatSecondsToMMSS(secondsValue: unknown): string {
  const totalSeconds = Math.max(0, Math.floor(Number(secondsValue) || 0));
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export async function transcribeAudio(audioFilePath: string): Promise<string> {
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
    const lines = segments
      .map((segment) => {
        const timestamp = formatSecondsToMMSS(segment.start);
        const text = (segment.text ?? '').trim();
        return text ? `[${timestamp}] ${text}` : '';
      })
      .filter(Boolean);

    return lines.join('\n');
  } catch (error) {
    console.error('transcribeAudio failed:', error);
    return '';
  } finally {
    try {
      await unlink(audioFilePath);
    } catch (cleanupError) {
      console.error('transcribeAudio cleanup failed:', cleanupError);
    }
  }
}