import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db/connection.js';
import { SESSION_COOKIE, checkPassword, createSession } from '../lib/auth.js';
import { HttpError } from '../lib/http.js';
import { LoginThrottle } from '../lib/security.js';
import { config } from '../config.js';

export function authRouter(db: DB, throttle = new LoginThrottle()) {
  const r = Router();

  r.post('/login', (req, res) => {
    const { email, password } = z
      .object({ email: z.string().trim().toLowerCase(), password: z.string() })
      .parse(req.body);
    // Bloqueia após muitas senhas erradas (por IP e por e-mail) para dificultar adivinhação.
    const keys = [`ip:${req.ip}`, `email:${email}`];
    const wait = throttle.blockedFor(keys);
    if (wait) throw new HttpError(429, `Muitas tentativas de login. Tente novamente em ${wait} minuto(s).`);
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as
      | { id: number; name: string; email: string; role: string; sector_id: number | null; active: number; password_hash: string }
      | undefined;
    if (!user || !user.active || !checkPassword(password, user.password_hash)) {
      throttle.fail(keys);
      throw new HttpError(401, 'E-mail ou senha inválidos.');
    }
    throttle.succeed([`email:${email}`]);
    const { token, expiresAt } = createSession(db, user.id);
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.cookieSecure, // COOKIE_SECURE=true ao servir via HTTPS
      expires: expiresAt,
    });
    res.json({ id: user.id, name: user.name, email: user.email, role: user.role, sector_id: user.sector_id });
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
