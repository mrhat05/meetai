/**
 * Backfills RAG chunk embeddings for meetings that don't have any yet — for
 * minutes created before Flagship B, and to repair the worker's best-effort
 * ingestion if it ever failed. Idempotent and re-runnable: it skips minutes
 * that already have chunks, and saveChunks() itself is ON CONFLICT DO NOTHING.
 *
 * Usage (from apps/server):
 *   node --import ./register.mjs scripts/backfill-embeddings.ts
 *   AI_STUB=1 node --import ./register.mjs scripts/backfill-embeddings.ts   (offline stub vectors)
 */
import 'dotenv/config';
import db from '../db.ts';
import { chunkTranscript } from '../src/services/chunkTranscript.ts';
import { embedTexts } from '../src/services/embeddingService.ts';
import { saveChunks, countChunks } from '../src/services/minutesChunkService.ts';

async function main() {
  const minutes = await db.$queryRaw<Array<{ id: string; group_id: string; title: string; raw_transcript: string }>>`
    SELECT mm."id", mm."group_id", mm."title", mm."raw_transcript"
    FROM "meeting_minutes" mm
    ORDER BY mm."created_at" ASC
  `;

  console.log(`Scanning ${minutes.length} meeting(s)…`);
  let embedded = 0;
  let skipped = 0;

  for (const row of minutes) {
    const existing = await countChunks(row.id);
    if (existing > 0) {
      skipped += 1;
      continue;
    }

    const chunks = chunkTranscript(row.raw_transcript, row.title);
    if (chunks.length === 0) {
      skipped += 1;
      continue;
    }

    const vectors = await embedTexts(chunks.map((chunk) => chunk.text));
    const inserted = await saveChunks(row.id, row.group_id, chunks, vectors);
    embedded += 1;
    console.log(`  ${row.id} — ${inserted} chunk(s) embedded`);
  }

  console.log(`Done. Embedded ${embedded} meeting(s), skipped ${skipped}.`);
  await db.$disconnect();
}

void main().catch(async (error) => {
  console.error(error);
  await db.$disconnect().catch(() => {});
  process.exit(1);
});
