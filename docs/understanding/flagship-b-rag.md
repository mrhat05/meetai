# Understanding Flagship B — RAG "Ask AI across all my meetings"

> Read alongside the code. Every section names the real files. Goal: you can whiteboard
> the whole retrieval pipeline and defend every choice in an interview.

---

## 1. What this feature is, in one breath

The old Ask-AI answered questions about **one** meeting by stuffing that transcript into
the prompt (`minutesQaService.ts`). Flagship B answers questions across **every** meeting
in a group — *"what did we decide about the release?"* — by **retrieving** the most
relevant transcript snippets from all of them and asking the LLM to answer using only
those, with **citations** that deep-link back to the source meeting.

That pattern — retrieve relevant context, then generate an answer grounded in it — is
**RAG (Retrieval-Augmented Generation)**. It's how you let an LLM answer over a corpus far
too large to fit in a prompt, without fine-tuning and without hallucinating.

---

## 2. Why RAG at all (the problem it solves)

You cannot paste 50 meetings into one prompt — you'd blow the context window and pay for
tokens on 49 irrelevant meetings. And the LLM has no memory of your meetings. RAG splits
the job in two:

1. **Retrieval** (cheap, deterministic, database work): find the handful of transcript
   snippets most relevant to the question.
2. **Generation** (the LLM): answer using *only* those snippets.

The LLM becomes a reasoning layer over a small, freshly-retrieved, permission-checked slice
of your data — not a memory of everything.

---

## 3. Embeddings — the core idea

An **embedding** is a vector (here 384 numbers) that represents the *meaning* of a piece
of text. The model (`all-MiniLM-L6-v2`) is trained so that texts with similar meaning land
near each other in 384-dimensional space, even when they share no words. "Ship the release
Friday" and "we'll launch at end of week" point in nearly the same direction.

So "find relevant snippets" becomes a geometry problem: **embed the question, then find the
chunk vectors nearest to it.** That's it. No keyword matching, no LLM call for retrieval.

- **File:** `src/services/embeddingService.ts`.
- **Local, no API:** we run the model *in Node* via `@huggingface/transformers` — free, no
  key, ~90 MB, loaded lazily and cached on disk. The talking point: "I run a
  sentence-transformer locally; embeddings never leave the box and cost nothing per call."
- **`normalize: true`:** we scale every vector to length 1. Then cosine similarity (angle
  between vectors) equals the dot product, and magnitude — which carries noise like text
  length — stops mattering. Retrieval ranks purely by *direction*, i.e. meaning.
- **AI_STUB mode:** returns a deterministic pseudo-vector seeded from a hash of the text, so
  the test suite exercises the full chunk→store→retrieve→cite pipeline offline, without
  downloading the model. Same text → same vector (reproducible), different text → different
  vector.

---

## 4. Why pgvector, not a dedicated vector DB (Pinecone/Weaviate)

**File:** migration `20260717000000_add_minutes_chunks`, table `meeting_minute_chunks`.

pgvector is a Postgres extension that adds a `vector` column type and nearest-neighbour
search. We chose it over a separate vector database because:

- The data already lives in Postgres. **One system** = transactional consistency between a
  meeting's minutes and its chunks, one backup story, one connection pool.
- The retrieval permission filter becomes a plain SQL `WHERE group_id = ...` (see §6) —
  the tenant isolation lives *in the same query* as the similarity search.
- A dedicated vector DB earns its complexity at **millions of vectors / high QPS**. We have
  thousands of chunks. Adding Pinecone here would be operating a second datastore, keeping
  it in sync, and reconciling two backup/restore stories — for no benefit at this scale.

Interview line: *"Right tool for the scale. pgvector until the vector count or QPS forces a
specialized store; I know the migration point."*

### HNSW vs IVFFlat (the index choice)
Both are approximate-nearest-neighbour (ANN) indexes — they trade a tiny bit of recall for
massive speed vs. scanning every vector. We used **HNSW** (`vector_cosine_ops`):
- **HNSW** = a navigable small-world graph; excellent recall/latency, no training step,
  works well as data grows incrementally. Costs more memory and slower to build.
- **IVFFlat** = clusters vectors into lists, searches the nearest lists; needs representative
  training data to build good clusters and degrades if you build it on an empty/tiny table.
At our scale either is fine; HNSW is the safer default because it needs no training data and
handles incremental inserts gracefully.

---

## 5. Chunking — why we split transcripts

**File:** `src/services/chunkTranscript.ts`.

We don't embed a whole transcript as one vector — a 30-minute meeting compressed to one
384-dim point is too blurry to match a specific question. Instead we split it into
**~800-character chunks** (packed on whole speaker turns, never mid-sentence) with
**~100-character overlap**:

- **~800 chars:** small enough that a chunk is one coherent topic (a sharp embedding → a
  precise match), big enough to carry real context.
- **~100 overlap:** a fact that straddles a boundary stays retrievable from either side, so
  the split never severs an answer.
- **Speaker-turn aware:** the transcript is stored as `[MM:SS] Speaker: text` lines
  (from `transcriptMerge.ts`), so we pack whole lines — chunks respect who said what.
- The meeting **title is prepended** to each chunk so a retrieved snippet keeps the meeting
  it came from as context.

These numbers are levers, not laws — you'd tune them by measuring retrieval hit-rate on real
questions. "No speech detected." / empty transcripts produce zero chunks.

---

## 6. Retrieval + the security point (read this twice)

**File:** `src/services/minutesChunkService.ts` → `retrieveRelevantChunks`, used by
`POST /groups/:groupId/ask` in `src/routes/groups.ts`.

```sql
SELECT c.chunk_text, c.minutes_id, mm.title, (c.embedding <=> $queryVec) AS distance
FROM meeting_minute_chunks c JOIN meeting_minutes mm ON mm.id = c.minutes_id
WHERE c.group_id = $groupId            -- ← the whole ballgame
ORDER BY c.embedding <=> $queryVec     -- cosine distance, uses the HNSW index
LIMIT 8;
```

- `<=>` is pgvector's **cosine distance** (smaller = more similar). Ordering by it with a
  `LIMIT` is the nearest-neighbour search, accelerated by the HNSW index.
- **The permission filter is INSIDE the query.** `group_id` is denormalized onto the chunk
  row precisely so retrieval can filter by a single indexed column. The model *never
  receives* another group's chunks — they're excluded before generation. This is the
  tenant-isolation guarantee, and it's the RAG security lesson: **most RAG data leaks happen
  when retrieval ignores the ACL and people trust the prompt to behave.** The prompt is not
  a security boundary; the `WHERE` clause is.
- The route *also* checks group membership first (403 for non-members) — defense in depth,
  reusing the same membership SQL as every other group route.

The test proves this: a second, empty group's Ask returns **zero** sources even though the
first group is full of chunks. If the `WHERE group_id` filter were missing, group B's
question would surface group A's chunks — the test would fail.

---

## 7. Generation — grounding + citations

**File:** `src/services/groupQaService.ts`.

The retrieved chunks are labeled `[1] [2] …` and handed to Llama with strict instructions:
*answer ONLY from these excerpts; if the answer isn't there, say so; cite the [n] you use.*
Two things fall out:

- **Hallucination control:** the model is told to use only the provided excerpts, so it
  can't invent facts that aren't in your meetings. If retrieval finds nothing relevant, the
  endpoint short-circuits to "I couldn't find that" *without even calling the LLM*.
- **Citations:** the endpoint returns `{ answer, sources: [{minutesId, title}] }` where
  sources are the distinct meetings the chunks came from, best-rank first. The UI renders
  each as a chip that opens that meeting — so every answer is traceable to its origin.

---

## 8. How ingestion composes with Flagship A

**File:** `src/services/minutesPipeline.ts` (the BullMQ worker).

The two flagships compose: the same worker that transcribes + summarizes a meeting also
**embeds it**, right after `saveMinutes`, inside the `if (created)` block. So a new meeting
becomes searchable automatically.

One subtlety worth explaining: ingestion is **best-effort / non-fatal** (wrapped in
try/catch, like the email send). Why not let it fail the job and retry? Because the worker's
*existence pre-check* early-returns on a re-run once minutes exist — so a retry would skip
straight past embedding and never create the chunks. Instead, embedding failures are logged
and repaired by the **backfill script** (`scripts/backfill-embeddings.ts`), which also
embeds meetings created before this feature existed. The backfill is idempotent: it skips
minutes that already have chunks, and `saveChunks` inserts with `ON CONFLICT DO NOTHING`.

---

## 9. Interview Q&A (rehearse out loud)

**"What is RAG and why use it?"** — Retrieve the relevant slice of a corpus, then generate
an answer grounded in it. It lets an LLM answer over data far larger than its context window,
with fresh data and fewer hallucinations, without fine-tuning.

**"Why pgvector and not Pinecone?"** — Data's already in Postgres → one system, transactional
consistency, and the permission filter is a plain SQL WHERE. A vector DB earns its keep at
millions of vectors / high QPS; we're at thousands.

**"How do you stop one group retrieving another's data?"** — The `group_id` filter is part
of the vector query itself; the model never sees unauthorized chunks. RAG leaks come from
trusting the prompt instead of filtering retrieval.

**"Why chunk at ~800 chars?"** — Small enough to be topically coherent (sharper match), big
enough to carry context; overlap prevents answers being split across a boundary. I'd tune it
by measuring retrieval hit-rate.

**"Why cosine similarity?"** — The embedding model is trained for angular similarity;
magnitude carries length artifacts. With normalized vectors, cosine ≡ dot product.

**"HNSW vs IVFFlat?"** — Both ANN. HNSW = graph, great recall, no training, handles
incremental inserts; IVFFlat = clustered, needs training data. HNSW is the safer default at
this scale.

**"What happens if embedding fails during ingestion?"** — It's non-fatal (the minutes still
save); the backfill script repairs the gap. It can't fail the job, because the worker's
idempotency pre-check would skip embedding on the retry.

---

## 10. Every file touched

| File | Role |
|---|---|
| `prisma/migrations/20260717000000_add_minutes_chunks/migration.sql` | `CREATE EXTENSION vector` + `meeting_minute_chunks` (HNSW cosine index, unique, group_id) |
| `prisma/schema.prisma` | `MeetingMinuteChunk` model with `Unsupported("vector(384)")` |
| `src/services/embeddingService.ts` | local MiniLM (lazy singleton), AI_STUB deterministic vectors, `toVectorLiteral` |
| `src/services/chunkTranscript.ts` | ~800-char, ~100-overlap, speaker-turn-aware chunking |
| `src/services/minutesChunkService.ts` | `saveChunks` (idempotent) + `retrieveRelevantChunks` (group filter in SQL) |
| `src/services/groupQaService.ts` | grounded, cited generation; AI_STUB stub; throw→502 |
| `src/services/minutesPipeline.ts` | best-effort ingestion hook inside the worker's `if (created)` |
| `src/routes/groups.ts` | `POST /groups/:groupId/ask` (membership check, embed, retrieve, answer, cite) |
| `scripts/backfill-embeddings.ts` | idempotent backfill for existing/failed-ingestion minutes |
| `apps/web/components/GroupAskCard.tsx` | "Ask across meetings" chat card with citation chips |
| `apps/web/app/groups/[groupId]/page.tsx` | mounts the card; chips reuse `handleOpenMinutes` |
| `apps/server/test/transcriber.test.ts` | RAG citations + tenant-isolation + authz assertions |

---

## 11. The 45-second whiteboard version

> Each meeting's transcript is chunked (~800 chars, speaker-turn aware) and each chunk is
> embedded locally with all-MiniLM-L6-v2 into a 384-dim normalized vector, stored in
> Postgres via pgvector with an HNSW cosine index — ingested by the same BullMQ worker that
> saved the minutes. To answer a group-wide question I embed the question and run a
> nearest-neighbour search **filtered by group_id inside the SQL** (that's the tenant
> isolation — the model never sees another group's data), take the top 8 chunks, and ask
> Llama to answer using only those, citing the ones it used. The citations deep-link to the
> source meeting. pgvector over a dedicated vector DB because the data's already in Postgres
> and we're at thousands of vectors, not millions.
