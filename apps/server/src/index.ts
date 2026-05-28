import 'dotenv/config';
import express from 'express';
import * as http from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import authRouter from '../routes/auth.js';
import roomsRouter from './routes/rooms.js';
import groupsRouter from './routes/groups.js';
import signalingHandler from './socket/signaling.ts';
import { registerSocketServer } from './socket/presence.ts';

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

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

export { app, io };
