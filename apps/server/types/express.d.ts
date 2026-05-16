import type { AuthPayload } from '../middleware/authMiddleware.js';

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export {};
