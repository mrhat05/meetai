import { Worker } from 'bullmq';
import { createRedisConnection } from './connection.ts';
import { MINUTES_QUEUE_NAME } from './minutesQueue.ts';
import { processMeetingMinutes, type MinutesJobPayload } from '../services/minutesPipeline.ts';

/**
 * The minutes worker runs IN-PROCESS with the API server, deliberately:
 * the uploaded .webm tracks live on this instance's local disk and the
 * socket.io user map (socket/presence.ts) is in-memory — a separate worker
 * process could neither read the audio nor emit 'minutes-ready'. Durability
 * comes from Redis holding the job state, not from process separation: if
 * this process dies mid-job, the job's lock expires (stalled-job check) and
 * the next boot picks it up again.
 *
 * Scale-out path (documented, not built): separate worker dyno + object
 * storage for audio + socket.io Redis adapter.
 */
let worker: Worker<MinutesJobPayload> | null = null;

export function startMinutesWorker(): Worker<MinutesJobPayload> {
  if (worker) {
    return worker;
  }

  worker = new Worker<MinutesJobPayload>(
    MINUTES_QUEUE_NAME,
    async (job) => {
      console.log(
        `minutes job ${job.id} attempt ${job.attemptsMade + 1}/${job.opts.attempts}: room ${job.data.roomCode}`,
      );
      await processMeetingMinutes(job.data);
    },
    {
      connection: createRedisConnection(),
      // One meeting at a time: the pipeline is Groq-rate-limit heavy and this
      // host also serves live WebRTC signaling — don't starve it.
      concurrency: 1,
    },
  );

  worker.on('completed', (job) => {
    console.log(`minutes job ${job.id} completed (room ${job.data.roomCode})`);
  });

  worker.on('failed', (job, error) => {
    const attempts = job ? `${job.attemptsMade}/${job.opts.attempts}` : '?';
    console.error(`minutes job ${job?.id} failed (attempt ${attempts}):`, error.message);
  });

  worker.on('error', (error) => {
    console.error('minutes worker error:', error.message);
  });

  return worker;
}

/** Graceful shutdown: waits for the in-flight job to finish, then closes. */
export async function stopMinutesWorker(): Promise<void> {
  if (!worker) {
    return;
  }
  const closing = worker.close();
  worker = null;
  await closing;
}
