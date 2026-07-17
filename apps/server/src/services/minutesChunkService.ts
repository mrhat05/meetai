import db from '../../db.js';
import { toVectorLiteral } from './embeddingService.ts';
import type { TranscriptChunk } from './chunkTranscript.ts';

export type RetrievedChunk = {
  chunk_text: string;
  minutes_id: string;
  title: string;
  distance: number;
};

/**
 * Persists a meeting's chunk embeddings. Idempotent: ON CONFLICT on the
 * (minutes_id, chunk_index) unique index means a retried worker run or a
 * re-run of the backfill can't create duplicate vectors.
 */
export async function saveChunks(
  minutesId: string,
  groupId: string,
  chunks: TranscriptChunk[],
  vectors: number[][],
): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    const vector = vectors[i];
    if (!chunk || !vector) continue;
    const vectorLiteral = toVectorLiteral(vector);
    // Parameterized values (safe); the vector is passed as a text literal and
    // cast to the pgvector type in SQL.
    inserted += await db.$executeRaw`
      INSERT INTO "meeting_minute_chunks"
        ("minutes_id", "group_id", "chunk_index", "chunk_text", "embedding")
      VALUES (
        ${minutesId}::uuid,
        ${groupId}::uuid,
        ${chunk.chunkIndex},
        ${chunk.text},
        ${vectorLiteral}::vector
      )
      ON CONFLICT ("minutes_id", "chunk_index") DO NOTHING
    `;
  }
  return inserted;
}

/** How many chunks already exist for a meeting — used by the backfill guard. */
export async function countChunks(minutesId: string): Promise<number> {
  const rows = await db.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count
    FROM "meeting_minute_chunks"
    WHERE "minutes_id" = ${minutesId}::uuid
  `;
  return Number(rows[0]?.count ?? 0);
}

/**
 * Nearest-neighbour retrieval for a group's question.
 *
 * The `WHERE group_id = ...` filter is INSIDE the SQL, not applied after —
 * this is the tenant-isolation guarantee. The model literally never receives
 * another group's chunks, so it cannot leak them no matter how the prompt is
 * phrased. RAG data leaks happen precisely when retrieval ignores the ACL and
 * people trust the prompt to behave.
 *
 * `<=>` is pgvector's cosine distance (smaller = more similar); ordering by it
 * uses the HNSW index. Vectors are normalized, so cosine ranks by meaning.
 */
export async function retrieveRelevantChunks(
  groupId: string,
  queryVector: number[],
  limit = 8,
): Promise<RetrievedChunk[]> {
  const vectorLiteral = toVectorLiteral(queryVector);
  return db.$queryRaw<RetrievedChunk[]>`
    SELECT
      c."chunk_text",
      c."minutes_id",
      mm."title",
      (c."embedding" <=> ${vectorLiteral}::vector) AS distance
    FROM "meeting_minute_chunks" c
    INNER JOIN "meeting_minutes" mm ON mm."id" = c."minutes_id"
    WHERE c."group_id" = ${groupId}::uuid
    ORDER BY c."embedding" <=> ${vectorLiteral}::vector
    LIMIT ${limit}
  `;
}

const minutesChunkService = {
  saveChunks,
  countChunks,
  retrieveRelevantChunks,
};

export default minutesChunkService;
