import db from '../../db.js';
import { toVectorLiteral } from './embeddingService.ts';
import type { TranscriptChunk } from './chunkTranscript.ts';

export type RetrievedChunk = {
  chunk_text: string;
  minutes_id: string;
  title: string;
  distance: number;
};

/** Retrieved chunk for the per-user assistant — carries routing info for citations. */
export type PersonalRetrievedChunk = RetrievedChunk & {
  room_code: string;
  group_id: string | null;
};

/**
 * Persists a meeting's chunk embeddings. Idempotent: ON CONFLICT on the
 * (minutes_id, chunk_index) unique index means a retried worker run or a
 * re-run of the backfill can't create duplicate vectors. `groupId` is null for
 * personal (non-group) meetings.
 */
export async function saveChunks(
  minutesId: string,
  groupId: string | null,
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

/**
 * Nearest-neighbour retrieval for the PERSONAL assistant — across every meeting
 * this user is allowed to see, spanning all their groups + personal meetings.
 *
 * The authorization predicate lives INSIDE the SQL (the whole security story):
 * a chunk is returned only if its meeting is a group meeting in a group the user
 * currently belongs to, OR a personal meeting the user owns (created_by). The
 * model never receives a chunk the user can't access, so there is no cross-user
 * or cross-group leak regardless of how the question is phrased. Leaving a group
 * revokes access immediately (the filter reads live group_members).
 */
export async function retrievePersonalChunks(
  userId: string,
  queryVector: number[],
  limit = 8,
): Promise<PersonalRetrievedChunk[]> {
  const vectorLiteral = toVectorLiteral(queryVector);
  return db.$queryRaw<PersonalRetrievedChunk[]>`
    SELECT
      c."chunk_text",
      c."minutes_id",
      mm."title",
      r."room_code",
      mm."group_id",
      (c."embedding" <=> ${vectorLiteral}::vector) AS distance
    FROM "meeting_minute_chunks" c
    INNER JOIN "meeting_minutes" mm ON mm."id" = c."minutes_id"
    INNER JOIN "rooms" r ON r."id" = mm."room_id"
    WHERE (
        mm."group_id" IS NOT NULL AND EXISTS (
          SELECT 1 FROM "group_members" gm
          WHERE gm."group_id" = mm."group_id" AND gm."user_id" = ${userId}::uuid
        )
      )
      OR (
        mm."group_id" IS NULL AND mm."created_by" = ${userId}::uuid
      )
    ORDER BY c."embedding" <=> ${vectorLiteral}::vector
    LIMIT ${limit}
  `;
}

const minutesChunkService = {
  saveChunks,
  countChunks,
  retrieveRelevantChunks,
  retrievePersonalChunks,
};

export default minutesChunkService;
