import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

export type AuthPayload = {
  userId: string;
  email?: string;
  iat?: number;
  exp?: number;
};

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const token = header.slice('Bearer '.length).trim();
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is required');
  }

  try {
    const decoded = jwt.verify(token, secret) as AuthPayload;
    req.user = decoded;
    return next();
  } catch {
    return res.status(401).json({ error: 'unauthorized' });
  }
}
