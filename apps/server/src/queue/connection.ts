import { Redis } from 'ioredis';

export const REDIS_URL = process.env.REDIS_URL?.trim() || 'redis://localhost:6379';

/**
 * Creates an ioredis connection for BullMQ. Each consumer (queue producer,
 * worker) gets its own connection because the worker parks a BLOCKING command
 * (BZPOPMIN) on its connection while waiting for jobs — sharing that socket
 * with the producer would stall every enqueue behind the block.
 *
 * `maxRetriesPerRequest: null` is a hard BullMQ requirement: ioredis would
 * otherwise fail a command after 20 retries while Redis is down, which would
 * break BullMQ's guarantee that commands are simply queued until the
 * connection recovers.
 *
 * Works unchanged with Upstash in prod: a rediss:// URL turns on TLS.
 */
const openConnections: Redis[] = [];

export function createRedisConnection(): Redis {
  const connection = new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
  });

  // ioredis is an EventEmitter: an unhandled 'error' event would crash the
  // process — exactly what a resilient queue must not do when Redis blips.
  connection.on('error', (error: Error) => {
    console.error('Redis connection error:', error.message);
  });

  openConnections.push(connection);
  return connection;
}

/**
 * Closes every connection this factory handed out. BullMQ deliberately does
 * NOT close externally-provided connections on queue.close()/worker.close(),
 * so shutdown (and the test teardown) must do it — otherwise the open
 * sockets keep the Node event loop alive and the process never exits.
 */
export async function closeAllRedisConnections(): Promise<void> {
  await Promise.all(
    openConnections.splice(0).map(async (connection) => {
      try {
        await connection.quit();
      } catch {
        connection.disconnect();
      }
    }),
  );
}
