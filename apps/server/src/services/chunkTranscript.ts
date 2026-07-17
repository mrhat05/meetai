export type TranscriptChunk = {
  chunkIndex: number;
  text: string;
};

// ~800 chars is the sweet spot for this data: big enough that a chunk carries
// enough context to be a coherent retrieval unit, small enough that it stays
// topically focused (a tighter embedding → a sharper similarity match). The
// ~100-char overlap keeps a fact that straddles a boundary retrievable from
// either side. These are tunable — you'd tune them by measuring retrieval
// hit-rate on real questions.
const TARGET_CHARS = 800;
const OVERLAP_CHARS = 100;

/**
 * Splits a merged transcript into overlapping chunks, respecting speaker
 * turns. The stored transcript is one "[MM:SS] Speaker: text" line per turn
 * (see transcriptMerge.ts), so we pack whole lines — never splitting mid-turn
 * — until a chunk reaches the target size, then start the next chunk carrying
 * a tail of the previous one as overlap.
 *
 * `title` is prepended to every chunk so a retrieved snippet keeps the meeting
 * it came from as context for the LLM. Returns [] for the "No speech detected."
 * / empty case so silent meetings produce no vectors.
 */
export function chunkTranscript(transcript: string, title: string): TranscriptChunk[] {
  const trimmed = transcript?.trim() ?? '';
  if (!trimmed || trimmed === 'No speech detected.') {
    return [];
  }

  const lines = trimmed.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    return [];
  }

  const header = title?.trim() ? `Meeting: ${title.trim()}\n` : '';
  const chunks: TranscriptChunk[] = [];
  let current: string[] = [];
  let currentLen = 0;
  let chunkIndex = 0;

  const flush = () => {
    if (current.length === 0) return;
    chunks.push({ chunkIndex: chunkIndex++, text: header + current.join('\n') });
  };

  for (const line of lines) {
    // A single turn longer than the target still becomes its own chunk rather
    // than being split mid-sentence.
    if (currentLen + line.length > TARGET_CHARS && current.length > 0) {
      flush();

      // Carry a tail of the just-flushed lines as overlap for the next chunk.
      const overlap: string[] = [];
      let overlapLen = 0;
      for (let i = current.length - 1; i >= 0; i -= 1) {
        const prevLine = current[i]!;
        if (overlapLen + prevLine.length > OVERLAP_CHARS) break;
        overlap.unshift(prevLine);
        overlapLen += prevLine.length + 1;
      }
      current = overlap;
      currentLen = overlapLen;
    }

    current.push(line);
    currentLen += line.length + 1;
  }
  flush();

  return chunks;
}
