import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomInt } from 'node:crypto';
import prisma from '../db.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { sendOtpEmail } from '../lib/mailer.js';

const router = Router();
const pendingRegistrationModel = prisma as typeof prisma & {
  pendingRegistration: {
    upsert: typeof prisma.pendingRegistration.upsert;
    findUnique: typeof prisma.pendingRegistration.findUnique;
    delete: typeof prisma.pendingRegistration.delete;
  };
};

// Use `any` when accessing the generated pendingPasswordReset model to
// avoid TypeScript errors in editors that may not have regenerated types yet.
// Access via `(prisma as any).pendingPasswordReset` below.

const JWT_ACCESS_EXPIRES = '15m';
const JWT_REFRESH_EXPIRES = '15d';

// In production the frontend (Vercel) and backend (Render) are on different
// sites, so the refresh cookie must be SameSite=None; Secure or the browser
// won't send it on the cross-site /auth/refresh XHR — the access token then
// expires after 15m and the user gets logged out. Locally everything is
// same-site (localhost), so Lax over http is correct.
const isProduction = process.env.NODE_ENV === 'production';

function setRefreshTokenCookie(res: any, refreshToken: string) {
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    sameSite: isProduction ? 'none' : 'lax',
    secure: isProduction,
    path: '/',
    maxAge: 15 * 24 * 60 * 60 * 1000,
  });
}

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

function generateOtp() {
  return String(randomInt(100000, 1000000));
}

router.post('/register/request-otp', async (req, res) => {
  try {
    const { email, password, display_name } = req.body as { email?: string; password?: string; display_name?: string };
    if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ error: 'email already exists' });
    }

    const displayName = (display_name?.trim() || email.split('@')[0] || email).trim();
    const passwordHash = await bcrypt.hash(password, 12);
    const otp = generateOtp();
    const otpHash = await bcrypt.hash(otp, 10);
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await pendingRegistrationModel.pendingRegistration.upsert({
      where: { email },
      update: {
        displayName,
        passwordHash,
        otpHash,
        otpExpiresAt,
      },
      create: {
        email,
        displayName,
        passwordHash,
        otpHash,
        otpExpiresAt,
      },
    });

    const emailResult = await sendOtpEmail({
      to: email,
      displayName,
      otp,
      expiresInMinutes: 10,
    });

    return res.json({
      message: 'OTP sent to your email',
      expiresInSeconds: 600,
      ...(emailResult.previewCode ? { otp: emailResult.previewCode } : {}),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'internal error' });
  }
});

router.post('/register/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body as { email?: string; otp?: string };
    if (!email || !otp) return res.status(400).json({ error: 'email and otp are required' });

    const pendingRegistration = await pendingRegistrationModel.pendingRegistration.findUnique({ where: { email } });
    if (!pendingRegistration) {
      return res.status(404).json({ error: 'otp request not found' });
    }

    if (pendingRegistration.otpExpiresAt.getTime() < Date.now()) {
      await pendingRegistrationModel.pendingRegistration.delete({ where: { email } });
      return res.status(410).json({ error: 'otp expired' });
    }

    const isValidOtp = await bcrypt.compare(otp, pendingRegistration.otpHash);
    if (!isValidOtp) {
      return res.status(401).json({ error: 'invalid otp' });
    }

    const user = await prisma.user.create({
      data: {
        email: pendingRegistration.email,
        passwordHash: pendingRegistration.passwordHash,
        displayName: pendingRegistration.displayName,
        avatarUrl: null,
        bio: null,
        phoneNumber: null,
        location: null,
      },
      select: { id: true, email: true, displayName: true, avatarUrl: true, bio: true, phoneNumber: true, location: true },
    });

    await pendingRegistrationModel.pendingRegistration.delete({ where: { email } });

    const accessToken = signAccessToken({ userId: user.id, email: user.email, displayName: user.displayName });
    const refreshToken = signRefreshToken({ userId: user.id });

    setRefreshTokenCookie(res, refreshToken);

    return res.status(201).json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        bio: user.bio,
        phoneNumber: user.phoneNumber,
        location: user.location,
      },
    });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return res.status(409).json({ error: 'email already exists' });
    }
    console.error(err);
    return res.status(500).json({ error: 'internal error' });
  }
});

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
        bio: null,
        phoneNumber: null,
        location: null,
      },
      select: { id: true, email: true, displayName: true, avatarUrl: true, bio: true, phoneNumber: true, location: true },
    });
    const accessToken = signAccessToken({ userId: user.id, email: user.email, displayName: user.displayName });
    const refreshToken = signRefreshToken({ userId: user.id });

    setRefreshTokenCookie(res, refreshToken);

    return res.status(201).json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        bio: user.bio,
        phoneNumber: user.phoneNumber,
        location: user.location,
      },
    });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return res.status(409).json({ error: 'email already exists' });
    }
    console.error(err);
    return res.status(500).json({ error: 'internal error' });
  }
});

// Password reset: request OTP
router.post('/password/request-otp', async (req, res) => {
  try {
    const { email } = req.body as { email?: string };
    if (!email) return res.status(400).json({ error: 'email is required' });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ error: 'user not found' });

    const otp = generateOtp();
    const otpHash = await bcrypt.hash(otp, 10);
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await (prisma as any).pendingPasswordReset.upsert({
      where: { email },
      update: { otpHash, otpExpiresAt },
      create: { email, otpHash, otpExpiresAt },
    });

    const emailResult = await sendOtpEmail({ to: email, displayName: user.displayName || '', otp, expiresInMinutes: 10 });

    return res.json({ message: 'OTP sent to your email', expiresInSeconds: 600, ...(emailResult.previewCode ? { otp: emailResult.previewCode } : {}) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'internal error' });
  }
});

// Password reset: verify otp and set new password
router.post('/password/reset', async (req, res) => {
  try {
    const { email, otp, new_password } = req.body as { email?: string; otp?: string; new_password?: string };
    if (!email || !otp || !new_password) return res.status(400).json({ error: 'email, otp and new_password are required' });

    const pending = await (prisma as any).pendingPasswordReset.findUnique({ where: { email } });
    if (!pending) return res.status(404).json({ error: 'password reset request not found' });

    if (pending.otpExpiresAt.getTime() < Date.now()) {
      await (prisma as any).pendingPasswordReset.delete({ where: { email } });
      return res.status(410).json({ error: 'otp expired' });
    }

    const ok = await bcrypt.compare(otp, pending.otpHash);
    if (!ok) return res.status(401).json({ error: 'invalid otp' });

    const passwordHash = await bcrypt.hash(new_password, 12);
    await prisma.user.update({ where: { email }, data: { passwordHash } });

    await (prisma as any).pendingPasswordReset.delete({ where: { email } });

    return res.json({ message: 'password updated' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'internal error' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ error: 'no account found with that email' });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'invalid credentials' });
    const accessToken = signAccessToken({ userId: user.id, email: user.email, displayName: user.displayName });
    const refreshToken = signRefreshToken({ userId: user.id });

    setRefreshTokenCookie(res, refreshToken);

    return res.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        bio: user.bio,
        phoneNumber: user.phoneNumber,
        location: user.location,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'internal error' });
  }
});

router.post('/refresh', async (req, res) => {
  try {
    const refreshToken =
      req.body?.refreshToken ??
      req.headers.cookie
        ?.split(';')
        .map((chunk) => chunk.trim())
        .find((chunk) => chunk.startsWith('refreshToken='))
        ?.split('=')[1];

    if (!refreshToken) return res.status(400).json({ error: 'refreshToken is required' });
    const secret = process.env.JWT_REFRESH_SECRET;
    if (!secret) throw new Error('JWT_REFRESH_SECRET is required');

    let payload: any;
    try {
      payload = jwt.verify(refreshToken, secret) as any;
    } catch (err) {
      return res.status(401).json({ error: 'invalid refresh token' });
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, email: true, displayName: true },
    });

    if (!user) {
      return res.status(401).json({ error: 'invalid refresh token' });
    }

    const accessToken = signAccessToken({ userId: user.id, email: user.email, displayName: user.displayName });
    return res.json({ accessToken });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'internal error' });
  }
});

router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        avatarUrl: true,
        bio: true,
        phoneNumber: true,
        location: true,
        createdAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'user not found' });
    }

    return res.json({ user });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'internal error' });
  }
});

router.put('/me', authMiddleware, async (req, res) => {
  try {
    const { displayName, avatarUrl, bio, phoneNumber, location } = req.body as {
      displayName?: string;
      avatarUrl?: string | null;
      bio?: string | null;
      phoneNumber?: string | null;
      location?: string | null;
    };

    const updatedUser = await prisma.user.update({
      where: { id: req.user!.userId },
      data: {
        ...(typeof displayName === 'string' ? { displayName: displayName.trim() } : {}),
        ...(avatarUrl !== undefined ? { avatarUrl } : {}),
        ...(bio !== undefined ? { bio } : {}),
        ...(phoneNumber !== undefined ? { phoneNumber } : {}),
        ...(location !== undefined ? { location } : {}),
      },
      select: {
        id: true,
        email: true,
        displayName: true,
        avatarUrl: true,
        bio: true,
        phoneNumber: true,
        location: true,
        createdAt: true,
      },
    });

    return res.json({ user: updatedUser });
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
