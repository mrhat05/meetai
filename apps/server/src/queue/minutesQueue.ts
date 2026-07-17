import { Queue } from 'bullmq';
import { createRedisConnection } from './connection.ts';
import type { MinutesJobPayload } from '../services/minutesPipeline.ts';

export const MINUTES_QUEUE_NAME = 'minutes';

/** Producer-side handle to the queue; also used by the status endpoint. */
export const minutesQueue = new Queue<MinutesJobPayload>(MINUTES_QUEUE_NAME, {
  connection: createRedisConnection(),
});

/**
 * Durably enqueues the minutes job for a finished meeting.
 *
 * - `jobId: roomId` — dedup at the queue layer: BullMQ refuses a second job
 *   with an id it has already seen, so a double-submitted request (host
 *   double-click, HTTP retry) collapses into one job.
 * - `attempts: 4` + exponential backoff of 5s → 10s → 20s: rides out
 *   transient Groq 429/5xx without hammering a struggling dependency.
 * - `removeOnComplete` keeps a bounded trail for the status endpoint, then
 *   self-cleans; `removeOnFail: false` keeps terminally-failed jobs in the
 *   failed set — our mini dead-letter queue for inspection/manual retry.
 */
export async function enqueueMinutesJob(payload: MinutesJobPayload) {
  return minutesQueue.add('generate-minutes', payload, {
    jobId: payload.roomId,
    attempts: 4,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 3600, count: 100 },
    removeOnFail: false,
  });
}
