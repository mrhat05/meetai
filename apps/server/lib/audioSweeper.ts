import { readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Boot-time reaper for tmp/audio-uploads. Two ways a .webm can be orphaned:
 *  - multer writes the upload BEFORE the route's auth/validation runs, so an
 *    early-return (403 non-host, invalid manifest, …) leaks the file;
 *  - a minutes job that exhausted all retries leaves its inputs behind
 *    (kept on purpose so a failed job in the DLQ can still be retried).
 * Anything older than maxAgeMs is no longer retryable in practice — delete it.
 */
export async function sweepStaleAudioUploads(dir: string, maxAgeMs = DEFAULT_MAX_AGE_MS): Promise<number> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return 0; // directory doesn't exist yet — nothing to sweep
  }

  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;

  for (const entry of entries) {
    const filePath = path.join(dir, entry);
    try {
      const info = await stat(filePath);
      if (info.isFile() && info.mtimeMs < cutoff) {
        await unlink(filePath);
        removed += 1;
      }
    } catch {
      // raced with the pipeline's own cleanup — fine
    }
  }

  if (removed > 0) {
    console.log(`audio sweeper: removed ${removed} stale upload(s) from ${dir}`);
  }
  return removed;
}
