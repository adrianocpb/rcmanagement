import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db/connection.js';
import { hashPassword, requireAdmin } from '../lib/auth.js';
import { badRequest, idParam, notFound } from '../lib/http.js';
import { nowIso } from '../lib/time.js';
import { bool, requiredText, sentOnly } from '../lib/validation.js';

const PUBLIC_COLS = 'id, name, email, role, active, created_at, updated_at';

const createSchema = z.object({
  name: requiredText(120),
  email: z.string().trim().toLowerCase().email('e-mail inválido'),
  role: z.enum(['admin', 'user']).default('user'),
  active: bool.default(true),
  password: z.string().min(6, 'mínimo de 6 caracteres'),
});
const updateSchema = createSchema.partial().extend({
  password: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(6, 'mínimo de 6 caracteres').optional()),
});

export function usersRouter(db: DB) {
  const r = Router();

  // Lista leve (id, nome) para selects — disponível a qualquer usuário autenticado.
  r.get('/options', (_req, res) => {
    res.json(db.prepare('SELECT id, name, active FROM users ORDER BY name').all());
  });

  r.get('/', requireAdmin, (_req, res) => {
    res.json(db.prepare(`SELECT ${PUBLIC_COLS} FROM users ORDER BY active DESC, name`).all());
  });

  r.post('/', requireAdmin, (req, res) => {
    const data = createSchema.parse(req.body);
    const now = nowIso();
    const info = db
      .prepare(
        `INSERT INTO users (name, email, password_hash, role, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(data.name, data.email, hashPassword(data.password), data.role, data.active ? 1 : 0, now, now);
    res.status(201).json(db.prepare(`SELECT ${PUBLIC_COLS} FROM users WHERE id = ?`).get(info.lastInsertRowid));
  });

  r.put('/:id', requireAdmin, (req, res) => {
    const id = idParam(req);
    const current = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!current) throw notFound('Usuário');
    const data = sentOnly(updateSchema.parse(req.body), req.body);
    if (id === req.user!.id && (data.active === false || data.role === 'user')) {
      throw badRequest('Você não pode desativar ou rebaixar o seu próprio usuário.');
    }
    const merged = {
      name: data.name ?? current.name,
      email: data.email ?? current.email,
      role: data.role ?? current.role,
      active: data.active === undefined ? current.active : data.active ? 1 : 0,
      password_hash: data.password ? hashPassword(data.password) : current.password_hash,
    };
    db.prepare(
      `UPDATE users SET name = ?, email = ?, role = ?, active = ?, password_hash = ?, updated_at = ? WHERE id = ?`,
    ).run(merged.name, merged.email, merged.role, merged.active, merged.password_hash, nowIso(), id);
    if (!merged.active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    res.json(db.prepare(`SELECT ${PUBLIC_COLS} FROM users WHERE id = ?`).get(id));
  });

  return r;
}
