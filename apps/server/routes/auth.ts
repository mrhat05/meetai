import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../db.js';

const router = Router();

const JWT_ACCESS_EXPIRES = '15m';
const JWT_REFRESH_EXPIRES = '7d';

function signAccessToken(payload: object) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is required');
  return jwt.sign(payload, secret, { expiresIn: JWT_ACCESS_EXPIRES });
}

function signRefreshToken(payload: object) {
  const secret = process.env.JWT_REFRESH_SECRET;
  if (!secret) throw new Error('JWT_REFRESH_SECRET is required');
  return jwt.sign(payload, secret, { expiresIn: JWT_REFRESH_EXPIRES });
}

router.post('/register', async (req, res) => {
  try {
    const { email, password, display_name } = req.body as { email?: string; password?: string; display_name?: string };
    if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
    const passwordHash = await bcrypt.hash(password, 12);
    const displayName = (display_name ?? email.split('@')[0]) as string;

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        displayName,
        avatarUrl: null,
      },
      select: { id: true, email: true, displayName: true },
    });
    const accessToken = signAccessToken({ userId: user.id, email: user.email });
    const refreshToken = signRefreshToken({ userId: user.id });
    return res.status(201).json({ accessToken, refreshToken });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return res.status(409).json({ error: 'email already exists' });
    }
    console.error(err);
    return res.status(500).json({ error: 'internal error' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ error: 'invalid credentials' });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'invalid credentials' });
    const accessToken = signAccessToken({ userId: user.id, email: user.email });
    const refreshToken = signRefreshToken({ userId: user.id });
    return res.json({ accessToken, refreshToken });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'internal error' });
  }
});

router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body as { refreshToken?: string };
    if (!refreshToken) return res.status(400).json({ error: 'refreshToken is required' });
    const secret = process.env.JWT_REFRESH_SECRET;
    if (!secret) throw new Error('JWT_REFRESH_SECRET is required');

    let payload: any;
    try {
      payload = jwt.verify(refreshToken, secret) as any;
    } catch (err) {
      return res.status(401).json({ error: 'invalid refresh token' });
    }

    const accessToken = signAccessToken({ userId: payload.userId });
    return res.json({ accessToken });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'internal error' });
  }
});

router.post('/logout', (_req, res) => {
  // Client-side only for now
  return res.sendStatus(200);
});

export default router;
