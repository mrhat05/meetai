/**
 * Manual drill harness for the BullMQ minutes queue — demonstrates the
 * durability/idempotency claims without needing a real meeting.
 *
 * Usage (from apps/server):
 *   node --import ./register.mjs scripts/queue-drill.ts enqueue-dup
 *     → enqueues the SAME roomId twice; shows queue-level dedup (1 job).
 *   node --import ./register.mjs scripts/queue-drill.ts enqueue [roomId]
 *     → enqueues one failing drill job (fake room → the INSERT hits a FK
 *       violation, so with AI_STUB=1 the job fails deterministically and
 *       exercises retries/backoff → the failed set / DLQ).
 *   node --import ./register.mjs scripts/queue-drill.ts state <roomId>
 *     → prints the job's live state (waiting/delayed/active/failed…).
 *   node --import ./register.mjs scripts/queue-drill.ts clean <roomId>
 *     → removes the drill job from Redis.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { minutesQueue, enqueueMinutesJob } from '../src/queue/minutesQueue.ts';
import { closeAllRedisConnections } from '../src/queue/connection.ts';
import type { MinutesJobPayload } from '../src/services/minutesPipeline.ts';

const [, , cmd, roomIdArg] = process.argv;

function payloadFor(roomId: string): MinutesJobPayload {
  return {
    roomId,
    roomCode: `drill-${roomId.slice(0, 8)}`,
    groupId: randomUUID(), // group doesn't exist → saveMinutes FK-fails on purpose
    groupName: 'Queue Drill',
    hostUserId: randomUUID(),
    durationSeconds: 60,
    tracks: [{ filePath: 'Z:/nonexistent-drill.webm', speaker: 'Drill', offsetMs: 0 }],
  };
}

async function main() {
  if (cmd === 'enqueue') {
    const roomId = roomIdArg || randomUUID();
    await enqueueMinutesJob(payloadFor(roomId));
    console.log(`enqueued drill job — roomId (=jobId): ${roomId}`);
  } else if (cmd === 'enqueue-dup') {
    const roomId = roomIdArg || randomUUID();
    await enqueueMinutesJob(payloadFor(roomId));
    await enqueueMinutesJob(payloadFor(roomId)); // same jobId → BullMQ dedups
    const counts = await minutesQueue.getJobCounts('wait', 'delayed', 'active', 'completed', 'failed');
    console.log('two enqueues of the same roomId →', JSON.stringify(counts));
    const job = await minutesQueue.getJob(roomId);
    console.log(`job exists exactly once: ${job?.id}`);
    await job?.remove();
    console.log('drill job cleaned up');
  } else if (cmd === 'state') {
    if (!roomIdArg) throw new Error('roomId required');
    const job = await minutesQueue.getJob(roomIdArg);
    if (!job) {
      console.log('no such job in Redis');
    } else {
      console.log(
        JSON.stringify(
          {
            id: job.id,
            state: await job.getState(),
            attemptsMade: job.attemptsMade,
            failedReason: job.failedReason ?? null,
          },
          null,
          2,
        ),
      );
    }
  } else if (cmd === 'clean') {
    if (!roomIdArg) throw new Error('roomId required');
    const job = await minutesQueue.getJob(roomIdArg);
    await job?.remove();
    console.log(`removed: ${job?.id ?? 'nothing to remove'}`);
  } else {
    console.log('usage: queue-drill.ts <enqueue|enqueue-dup|state|clean> [roomId]');
  }

  await minutesQueue.close();
  await closeAllRedisConnections();
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
