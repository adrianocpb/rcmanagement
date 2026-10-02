import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import type { DB } from '../db/connection.js';
import { SESSION_COOKIE, checkPassword, createSession } from '../lib/auth.js';
import { HttpError } from '../lib/http.js';

export function authRouter(db: DB) {
  const r = Router();

  r.post('/login', (req, res) => {
    const { email, password } = z
      .object({ email: z.string().trim().toLowerCase(), password: z.string() })
      .parse(req.body);
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as
      | { id: number; name: string; email: string; role: string; active: number; password_hash: string }
      | undefined;
    if (!user || !user.active || !checkPassword(password, user.password_hash)) {
      throw new HttpError(401, 'E-mail ou senha inválidos.');
    }
    const { token, expiresAt } = createSession(db, user.id);
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProduction && process.env.COOKIE_SECURE !== 'false',
      expires: expiresAt,
    });
    res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
  });

  r.post('/logout', (req, res) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    res.clearCookie(SESSION_COOKIE);
    res.status(204).end();
  });

  r.get('/me', (req, res) => {
    if (!req.user) throw new HttpError(401, 'Não autenticado.');
    res.json(req.user);
  });

  return r;
}
