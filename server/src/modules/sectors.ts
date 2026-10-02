import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db/connection.js';
import { requireAdmin } from '../lib/auth.js';
import { idParam, notFound } from '../lib/http.js';
import { nowIso } from '../lib/time.js';
import { bool, requiredText, sentOnly } from '../lib/validation.js';

const schema = z.object({ name: requiredText(80), active: bool.default(true) });

export function sectorsRouter(db: DB) {
  const r = Router();

  r.get('/', (_req, res) => {
    res.json(db.prepare('SELECT * FROM sectors ORDER BY active DESC, name').all());
  });

  r.post('/', requireAdmin, (req, res) => {
    const data = schema.parse(req.body);
    const now = nowIso();
    const info = db
      .prepare('INSERT INTO sectors (name, active, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(data.name, data.active ? 1 : 0, now, now);
    res.status(201).json(db.prepare('SELECT * FROM sectors WHERE id = ?').get(info.lastInsertRowid));
  });

  r.put('/:id', requireAdmin, (req, res) => {
    const id = idParam(req);
    const current = db.prepare('SELECT * FROM sectors WHERE id = ?').get(id) as { name: string; active: number } | undefined;
    if (!current) throw notFound('Setor');
    const data = sentOnly(schema.partial().parse(req.body), req.body);
    db.prepare('UPDATE sectors SET name = ?, active = ?, updated_at = ? WHERE id = ?').run(
      data.name ?? current.name,
      data.active === undefined ? current.active : data.active ? 1 : 0,
      nowIso(),
      id,
    );
    res.json(db.prepare('SELECT * FROM sectors WHERE id = ?').get(id));
  });

  return r;
}
