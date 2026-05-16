import 'dotenv/config';
import express from 'express';
import * as http from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import authRouter from './routes/auth.js';

const app = express();
app.use(express.json());
app.use('/auth', authRouter);
const server = http.createServer(app);
const io = new SocketIOServer(server);

const PORT = Number(process.env.PORT) || 3000;

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

export { app, io };