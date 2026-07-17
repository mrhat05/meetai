-- Enable pgvector (available 0.8.1 on this instance). RAG lives in the same
-- Postgres as the minutes: one datastore, transactional consistency between a
-- meeting's minutes and its chunks, and the retrieval permission filter is a
-- plain SQL WHERE rather than a second system to keep in sync.
-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateTable
CREATE TABLE "meeting_minute_chunks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "minutes_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "chunk_text" TEXT NOT NULL,
    "embedding" vector(384) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "meeting_minute_chunks_pkey" PRIMARY KEY ("id")
);

-- Idempotent re-embed: a retried/backfilled chunk insert can't duplicate rows.
-- CreateIndex
CREATE UNIQUE INDEX "meeting_minute_chunks_minutes_id_chunk_index_key" ON "meeting_minute_chunks"("minutes_id", "chunk_index");

-- Tenant filter: retrieval always constrains by group_id, so index it.
-- CreateIndex
CREATE INDEX "meeting_minute_chunks_group_id_idx" ON "meeting_minute_chunks"("group_id");

-- Approximate-nearest-neighbour search index. HNSW (graph-based) over IVFFlat
-- for better recall/latency without needing training data at this scale.
-- vector_cosine_ops because the embedding model is trained for angular
-- similarity and we store normalized vectors (cosine == dot product).
-- CreateIndex
CREATE INDEX "meeting_minute_chunks_embedding_hnsw_idx" ON "meeting_minute_chunks" USING hnsw ("embedding" vector_cosine_ops);

-- AddForeignKey
ALTER TABLE "meeting_minute_chunks" ADD CONSTRAINT "meeting_minute_chunks_minutes_id_fkey" FOREIGN KEY ("minutes_id") REFERENCES "meeting_minutes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_minute_chunks" ADD CONSTRAINT "meeting_minute_chunks_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
