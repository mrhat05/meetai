import 'dotenv/config';
import express from 'express';
import * as http from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import authRouter from '../routes/auth.js';
import roomsRouter, { AUDIO_UPLOAD_DIR } from './routes/rooms.js';
import groupsRouter from './routes/groups.js';
import signalingHandler from './socket/signaling.ts';
import { registerSocketServer } from './socket/presence.ts';
import { startMinutesWorker, stopMinutesWorker } from './queue/minutesWorker.ts';
import { minutesQueue } from './queue/minutesQueue.ts';
import { closeAllRedisConnections } from './queue/connection.ts';
import { sweepStaleAudioUploads } from '../lib/audioSweeper.ts';

const app = express();

const clientOrigin = process.env.CLIENT_URL ?? 'http://localhost:3000';

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', clientOrigin);
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  return next();
});

// Accept larger JSON payloads (avatars stored as data URLs) and urlencoded bodies
app.use(express.json({ limit: '50mb', verify: (req, _res, buf) => { (req as any).rawBody = buf; } }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Error handler to convert body-parser PayloadTooLargeErrors to JSON responses
app.use((err: any, _req: any, res: any, next: any) => {
  if (err && err.type === 'entity.too.large') {
    console.warn('Payload too large:', err.length || 'unknown');
    return res.status(413).json({ error: 'Payload too large' });
  }
  return next(err);
});
app.use('/auth', authRouter);
app.use('/rooms', roomsRouter);
app.use('/groups', groupsRouter);

const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: clientOrigin,
    credentials: true,
    methods: ['GET', 'POST'],
  },
});
registerSocketServer(io);
io.on('connection', signalingHandler(io));

const PORT = Number(process.env.PORT) || 3000;

// The BullMQ minutes worker runs in-process (shares this instance's disk for
// audio uploads and the in-memory socket map for 'minutes-ready' pushes).
// Started under tests too: the suite drives the real end-with-summary route
// and needs the job actually processed.
startMinutesWorker();

// Reap .webm uploads orphaned by early-return requests or dead-lettered jobs.
void sweepStaleAudioUploads(AUDIO_UPLOAD_DIR);

// Under the automated test suite the app is started on an ephemeral port by
// the test itself, so skip the default listen to avoid binding PORT.
if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

/**
 * Graceful shutdown — the difference between "deploys lose data" and
 * "deploys are boring". On SIGTERM (what Render sends before replacing the
 * instance) / SIGINT (Ctrl+C):
 *   1. stop accepting new HTTP + websocket connections,
 *   2. let the worker FINISH its in-flight minutes job (worker.close waits),
 *   3. close the queue producer, then exit 0.
 * A 25s watchdog forces exit inside Render's ~30s kill window; if the job
 * outlives it, SIGKILL wins — and BullMQ's stalled-job check re-queues the
 * job on next boot. That is at-least-once delivery doing its job.
 */
let isShuttingDown = false;
async function shutdown(signal: NodeJS.Signals) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`${signal} received — draining (in-flight minutes job will finish)…`);

  const watchdog = setTimeout(() => {
    console.error('Graceful shutdown timed out after 25s — forcing exit.');
    process.exit(1);
  }, 25_000);
  watchdog.unref();

  try {
    server.close();
    io.close();
    await stopMinutesWorker();
    await minutesQueue.close();
    await closeAllRedisConnections();
    console.log('Drained cleanly — exiting.');
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test') {
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

export { app, io };
