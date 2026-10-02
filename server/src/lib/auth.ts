import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import type { DB } from '../db/connection.js';
import { HttpError } from './http.js';

export const SESSION_COOKIE = 'sid';

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: 'admin' | 'user';
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

export const hashPassword = (plain: string) => bcrypt.hashSync(plain, 10);
export const checkPassword = (plain: string, hash: string) => bcrypt.compareSync(plain, hash);

export function createSession(db: DB, userId: number): { token: string; expiresAt: Date } {
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.sessionDays * 86_400_000);
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    token,
    userId,
    now.toISOString(),
    expiresAt.toISOString(),
  );
  return { token, expiresAt };
}

export function sessionMiddleware(db: DB) {
  const stmt = db.prepare(`
    SELECT u.id, u.name, u.email, u.role
      FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > ? AND u.active = 1`);
  return (req: Request, _res: Response, next: NextFunction) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) {
      const user = stmt.get(token, new Date().toISOString()) as AuthUser | undefined;
      if (user) req.user = user;
    }
    next();
  };
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'Não autenticado.'));
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'Não autenticado.'));
  if (req.user.role !== 'admin') return next(new HttpError(403, 'Acesso restrito a administradores.'));
  next();
}
