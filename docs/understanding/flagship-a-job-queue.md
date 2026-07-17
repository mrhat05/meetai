# Understanding Flagship A — the durable AI-minutes pipeline

> Read this after (or alongside) the code. Every section names the real files so you can
> jump between explanation and implementation. The goal: you can whiteboard this whole
> system from memory and defend every tradeoff.

---

## 1. The bug this fixes (tell this story first)

Before: when a host ended a meeting, `POST /rooms/:roomCode/end-with-summary` kicked off
transcription + 3 LLM calls as a **fire-and-forget promise** — `void processMeetingMinutes(...)`
in `apps/server/src/routes/rooms.ts`. The response said `202 { processing: true }` and hoped.

Three ways that silently lost meetings forever:

1. **Process death.** Render restarts, deploys, or crashes during the ~30–60 s pipeline →
   the promise dies with the process. No record a job ever existed.
2. **Transient AI failures.** One Groq 429/500 and the pipeline saved junk: transcription
   errors were swallowed into `[]` (indistinguishable from a silent meeting → a bogus
   "No speech detected" row), summary errors were swallowed into fallback markdown
   ("Summary generation failed") — permanently, as if it succeeded.
3. **No visibility.** The user saw nothing between "meeting ended" and the minutes-ready
   push. If the pipeline died, the gap was infinite and unexplained.

After: the job lives in **Redis** (BullMQ). It survives process death, retries transient
failures with backoff, lands in a dead-letter set when it's truly stuck, and exposes a
status the UI can show.

---

## 2. Mental model: what a job queue actually is

Think of a restaurant ticket rail. The waiter (HTTP route) doesn't cook; they clip a
ticket (job) to the rail (Redis) and immediately go back to taking orders (202 Accepted).
The cook (worker) takes tickets one at a time. If the cook faints mid-dish, the ticket is
still on the rail — another shift picks it up. The rail is the source of truth, not the
cook's memory.

The three properties this buys, and where each lives in our code:

| Property | Meaning | Where |
|---|---|---|
| **Durability** | the job exists outside the process's memory | Redis (Upstash in prod, `docker-compose.yml` locally, AOF enabled) |
| **Retry policy** | transient failure ≠ permanent loss | `queue/minutesQueue.ts` (`attempts: 4`, exponential backoff) |
| **Decoupling** | producer speed ≠ consumer speed | route enqueues instantly; worker chews at `concurrency: 1` |

---

## 3. What BullMQ physically stores in Redis (whiteboard this)

BullMQ models one queue as a family of Redis keys (`bull:minutes:*`):

- **`bull:minutes:<jobId>`** — a **hash** holding the job itself: your JSON payload
  (`data`), options, `attemptsMade`, timestamps, `failedReason`.
- **`bull:minutes:wait`** — a **list** of job ids ready to run (the ticket rail).
- **`bull:minutes:active`** — a **list** of ids currently being processed.
- **`bull:minutes:delayed`** — a **sorted set** scored by "run at" timestamp — this is
  where a job sits *between backoff retries*.
- **`bull:minutes:completed` / `bull:minutes:failed`** — **sorted sets** of finished ids.
  The `failed` set is our dead-letter queue.
- A **stalled check**: while working, the worker maintains a lock on the job. If the
  process dies, the lock expires, the periodic stalled-checker moves the job back to
  `wait`, and the next worker (e.g. after your redeploy) picks it up. **That is the whole
  crash-recovery mechanism** — no magic, just a lock with a TTL.

The worker waits for jobs with a **blocking Redis command** parked on its connection.
That's why `queue/connection.ts` creates a **separate connection** for the worker vs the
producer (a blocked socket can't serve enqueues), and why BullMQ demands
`maxRetriesPerRequest: null` — ioredis must queue commands indefinitely while Redis is
briefly unreachable instead of erroring after 20 tries and breaking BullMQ's invariants.

Atomicity: every state transition (wait→active, active→delayed, …) is a **Lua script** —
Redis executes it as one atomic step, so two workers can never grab the same job.

---

## 4. Life of one meeting (trace this end-to-end)

```
Host clicks "End call"  (apps/web/components/RoomShell.tsx → finalizeMeetingSummary)
  │  uploads N .webm tracks + manifest
  ▼
POST /rooms/:roomCode/end-with-summary          (apps/server/src/routes/rooms.ts)
  │  auth → host check → mark room ended → emit 'meeting-ended'
  │  enqueueMinutesJob(payload)                 (src/queue/minutesQueue.ts)
  │    jobId = roomId · attempts 4 · backoff 5s exponential
  │  → 202 Accepted  { processing: true }       ← honest now: work is durably queued
  ▼
Redis  (bull:minutes:* keys — job survives crashes/deploys here)
  ▼
Worker (in-process, concurrency 1)              (src/queue/minutesWorker.ts)
  │  processMeetingMinutes(job.data)            (src/services/minutesPipeline.ts)
  │    1. minutes-already-exist check  ── idempotency layer 1
  │    2. transcribe each track (Groq Whisper)  — THROWS on failure → retry
  │    3. merge speaker timelines               (services/transcriptMerge.ts)
  │    4. title (degrades to null) · summary (THROWS) · action items (degrades to [])
  │    5. saveMinutes ON CONFLICT(room_id) DO NOTHING ── idempotency layer 2
  │    6. if created: emit 'minutes-ready' + email members ── layer 3 (notify once)
  │    7. delete the .webm files — ONLY now, on success
  ▼
Group page                                       (apps/web/app/groups/[groupId]/page.tsx)
  minutes-ready socket push → toast + list refetch
  meanwhile: polls GET /groups/:id/minutes-status → amber "generating…" / rose "failed"
```

---

## 5. At-least-once delivery + idempotency (the core concept)

**You cannot have exactly-once delivery end-to-end.** Networks duplicate, retries re-run,
a worker can crash *after* doing the work but *before* acking it. Queues therefore promise
**at-least-once**: the job runs one *or more* times. Your escape hatch is making re-runs
harmless — **idempotent consumers**. Practically: at-least-once delivery + idempotent
processing *is* exactly-once processing for all business purposes.

Our defense in depth (all three exist because each covers a different race):

1. **Queue-level dedup** — `jobId: roomId` in `minutesQueue.ts`. BullMQ refuses a second
   job with an id it already knows. Catches: host double-click, client HTTP retry.
   Doesn't catch: a *re-run* of the same job (that's one job, run twice).
2. **Worker pre-check** — `minutesPipeline.ts` starts by asking "do minutes for this room
   already exist?" and exits early. Catches: the crash-after-save-before-ack re-run,
   without burning 60 s of Groq calls. Doesn't catch: two runs racing past the check
   simultaneously.
3. **DB unique constraint** — `meeting_minutes.room_id` is UNIQUE (migration
   `20260716140000_add_unique_room_id_to_meeting_minutes`), and `saveMinutes`
   (`services/minutesService.ts`) inserts with `ON CONFLICT ("room_id") DO NOTHING`.
   The database is the last line: even perfectly-racing runs physically cannot produce
   two rows. The loser gets `created: false`.

**Notifications are gated on `created === true`** — so members get at-most-once email.
Deliberate asymmetry: minutes are at-least-once (never lose them), emails are
at-most-once (never spam; a lost email in the crash window is the cheaper failure).
If you wanted at-least-once emails too, you'd split notification into its own idempotent
job — say that in an interview, don't build it here.

---

## 6. Retries and backoff (and *what* deserves a retry)

`attempts: 4, backoff: { type: 'exponential', delay: 5000 }` → failures wait
**5 s → 10 s → 20 s** between attempts. Why exponential? A struggling dependency (Groq
under load) needs *air*, not a hammer; each retry doubles the breathing room. Jitter
(randomizing the delay) would prevent many clients retrying in lockstep — the
"thundering herd"; mention it, BullMQ supports it via custom backoff.

**The subtle part we had to fix: retries are theater unless something throws.** The old
code swallowed every Groq error into a fallback value, so a queue would never have seen a
failure. We made a policy decision per call site:

| Call | On failure | Why |
|---|---|---|
| Whisper transcription (`lib/transcribeAudio.ts`) | **throw → retry** | it's the raw material; `[]` now unambiguously means "genuinely silent meeting" |
| Summary (`services/summarizationService.ts`) | **throw → retry** | the summary IS the product; saving "generation failed" as minutes is a lie |
| Title | degrade to `null` | there's a designed fallback title (`<group> · <date>`); re-running the whole pipeline for a nicety wastes tokens |
| Action items (`services/actionItemsService.ts`) | degrade to `[]` | same logic — enhancement, not essence |

Interview line: *"I classified each failure by whether the user would rather wait or
rather lose it — essentials retry, garnishes degrade."*

---

## 7. The finding that changed the design: retry inputs must outlive attempts

Original code deleted each `.webm` inside transcription (`finally { unlink(...) }`).
Compose that with retries and you get a **data-corruption bug**: attempt 1 transcribes
(files deleted), then the summary call fails → attempt 2 re-transcribes *missing files* →
gets nothing → happily saves "No speech detected". The retry mechanism itself would have
manufactured wrong data.

Rule: **a retryable job's inputs must survive until the job succeeds.** So:

- transcription no longer deletes anything — the caller owns file lifetime;
- `minutesPipeline.ts` deletes the tracks **only after** a successful save (or when the
  run proves redundant);
- files orphaned by terminal failures (or by multer writing before an early-return 403 —
  a real pre-existing leak) are reaped >24 h later by `lib/audioSweeper.ts` at boot.

This generalizes: it's the same reason message queues don't delete a message until the
consumer *acks*, not when it *starts*.

---

## 8. Why the worker runs in-process (and when it shouldn't)

The textbook picture is a separate worker fleet. We deliberately run the worker inside
the API process (`startMinutesWorker()` in `src/index.ts`) because two resources are
process-local:

- the uploaded `.webm` files sit on this instance's **local disk** (`tmp/audio-uploads`);
- the socket.io user map (`src/socket/presence.ts`) is **in-memory** — a separate process
  could never emit `minutes-ready` to a browser connected to the API process.

**Durability comes from Redis holding the job state, not from process separation.** Kill
the process mid-job: the job's lock expires, the stalled-checker re-queues it, the next
boot's worker finishes it. Same guarantee, zero extra dynos.

Scale-out path (README material, not built): audio → object storage (S3/Supabase
Storage), sockets → socket.io Redis adapter, worker → its own Render service. Each item
removes one process-local dependency. Knowing the *order* of that migration is the
senior-level answer.

---

## 9. DLQ + the status endpoint (failure you can see)

After 4 failed attempts the job stays in BullMQ's **failed set** (`removeOnFail: false`)
— our mini dead-letter queue. Nothing is silently dropped: the payload, stack trace and
attempt count are all inspectable in Redis, and the job can be manually retried.

`GET /groups/:groupId/minutes-status` (`src/routes/groups.ts`) answers "what's happening
with the latest meeting's minutes?" with layered truth:

1. membership check first (same 403 rule as the minutes list — never leak status across
   groups);
2. find the group's most recently ended room (<24 h);
3. **DB row exists → `completed`** (the database outranks the queue as truth);
4. otherwise ask BullMQ for job `roomId`: active → `processing`, failed → `failed`,
   waiting/delayed → `queued`, no job → `idle` (room ended without a summary job).

The group page (`apps/web/app/groups/[groupId]/page.tsx`) polls this every 5 s *only
while the Minutes tab is open and the status is pending*, renders an amber
"being generated…" chip or a rose "failed" chip, and refetches the list on completion.
The `minutes-ready` socket push remains the fast path; polling is the truthful fallback.
(API design note: the roadmap sketched `/rooms/:roomCode/minutes-status`, but the
consumer — the group page — doesn't know a roomCode after the meeting ends. Design the
API around the consumer.)

---

## 10. Graceful shutdown (why deploys are now boring)

On every deploy, Render sends **SIGTERM**, waits a grace period (~30 s), then **SIGKILL**.
Default Node behavior on SIGTERM is instant death — exactly the crash we built the queue
to survive, happening on *every deploy*.

`src/index.ts` now handles SIGTERM/SIGINT: stop accepting HTTP + socket connections →
`worker.close()` (**waits for the in-flight job to finish** and takes no new ones) →
close the queue → exit 0. A 25 s watchdog force-exits just inside Render's window.

And if the job is longer than the grace period? SIGKILL wins, the job dies mid-flight —
and that's *fine*: the lock expires, the stalled-checker re-queues, the new deploy's
worker re-runs it, idempotency makes the re-run safe. Graceful shutdown is the
optimization; at-least-once is the guarantee.

One more layer: if **Redis itself** is unreachable at enqueue time, the route logs loudly
and falls back to the legacy in-process run (`rooms.ts`) — no durability, but strictly
better than telling the host "sorry, meeting lost". Graceful degradation: reduced
guarantees beat refused service.

---

## 11. Interview Q&A (rehearse out loud)

**"Why a queue instead of awaiting in the request?"**
The pipeline takes 30–60 s — that's an HTTP timeout risk and a terrible UX, and
in-process work dies with the process. A queue gives durability, retries, and decouples
producer from consumer capacity. The route returns 202 Accepted, which is now honest.

**"Why BullMQ over RabbitMQ?"**
Same delivery semantics at this scale, zero extra brokers to operate — Redis was already
coming for rate limiting. RabbitMQ earns its complexity with routing topologies, many
consumers/languages, per-message ack tuning; none apply here. Zero-new-infra alternative:
pg-boss on the existing Postgres (`SELECT … FOR UPDATE SKIP LOCKED`). Knowing both is the
point.

**"What if the worker crashes mid-job?"**
The job's lock in Redis expires; the stalled-job check re-queues it; the next worker
re-runs it; three idempotency layers (jobId dedup, existence pre-check, unique index +
ON CONFLICT) make the re-run produce exactly one minutes row and zero duplicate emails.

**"Exactly-once?"**
Doesn't exist end-to-end. At-least-once delivery + idempotent handlers is the practical
equivalent, and where a duplicate would still hurt (email), we chose at-most-once by
gating on first-time creation.

**"What actually triggers a retry?"**
Thrown errors — which is why we changed transcription and summarization from
swallow-and-degrade to throw. Title and action-item failures degrade instead. Retries
without propagated errors are theater.

**"Why did you keep the audio files until the job succeeds?"**
Because retry inputs must survive across attempts — deleting them inside transcription
meant a retry would fabricate "no speech" minutes. Same principle as ack-after-process,
not ack-on-receive.

**"Where's the race in your status endpoint?"**
Job can complete between the DB check and the queue check — it reads `completed` (from
the job) as `processing` for one poll cycle, then the DB row wins. Eventual consistency
with a 5 s horizon; harmless because the socket push usually arrives first.

---

## 12. Every file touched

| File | Role |
|---|---|
| `apps/server/src/queue/connection.ts` | ioredis factory (`maxRetriesPerRequest: null`, error handler, Upstash-ready) |
| `apps/server/src/queue/minutesQueue.ts` | queue + `enqueueMinutesJob` (jobId dedup, retries, DLQ retention) |
| `apps/server/src/queue/minutesWorker.ts` | in-process worker, concurrency 1, lifecycle logging, graceful close |
| `apps/server/src/services/minutesPipeline.ts` | the extracted pipeline: idempotent, notify-once, cleanup-on-success |
| `apps/server/src/routes/rooms.ts` | route now enqueues (with inline fallback); exports `AUDIO_UPLOAD_DIR` |
| `apps/server/src/routes/groups.ts` | `GET /groups/:groupId/minutes-status` |
| `apps/server/src/index.ts` | worker start, boot sweeper, SIGTERM/SIGINT drain with watchdog |
| `apps/server/lib/transcribeAudio.ts` | no longer deletes files; throws on failure |
| `apps/server/src/services/summarizationService.ts` | summary failures throw (title still degrades) |
| `apps/server/src/services/minutesService.ts` | `ON CONFLICT (room_id) DO NOTHING` + `created` flag |
| `apps/server/lib/audioSweeper.ts` | boot-time reaper for orphaned `.webm` files |
| `apps/server/prisma/migrations/20260716140000_*/migration.sql` | unique index on `meeting_minutes.room_id` |
| `apps/server/test/transcriber.test.ts` | teardown closes worker/queue; suite now needs local Redis |
| `apps/web/app/groups/[groupId]/page.tsx` | status polling, amber/rose chips, list refetch on completion |
| `docker-compose.yml` | Redis AOF persistence + restart policy + volume |

---

## 13. The 60-second whiteboard version

> Ending a meeting enqueues a job in Redis (BullMQ) keyed by roomId and returns 202. An
> in-process worker transcribes per-speaker tracks, summarizes with Llama, saves minutes,
> and notifies members. Crashes are survived because the job state lives in Redis — a
> stalled job's lock expires and it re-queues. Transient AI failures throw and retry with
> exponential backoff (4 attempts), then park in the failed set as a DLQ surfaced to the
> UI as "failed". Re-runs are safe through three idempotency layers — jobId dedup, an
> existence pre-check, and a unique index with ON CONFLICT — and emails only send on
> first-time creation. SIGTERM drains the in-flight job before exit, so deploys are
> boring. The audio files are the job's inputs, so they live until the job succeeds.
