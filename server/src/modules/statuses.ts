import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db/connection.js';
import { requireAdmin } from '../lib/auth.js';
import { badRequest, idParam, notFound } from '../lib/http.js';
import { nowIso } from '../lib/time.js';
import { bool, requiredText, sentOnly } from '../lib/validation.js';

export interface StatusRow {
  id: number;
  name: string;
  color: string;
  position: number;
  is_default: number;
  is_start_status: number;
  is_completion_status: number;
  counts_in_wip: number;
  /** Encerra a tarefa sem entrega (ex.: Cancelado). */
  is_cancel_status: number;
  active: number;
}

const schema = z.object({
  name: requiredText(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'cor inválida').default('#64748b'),
  is_default: bool.default(false),
  is_start_status: bool.default(false),
  is_completion_status: bool.default(false),
  counts_in_wip: bool.default(true),
  is_cancel_status: bool.default(false),
  active: bool.default(true),
});

export function getStatus(db: DB, id: number): StatusRow | undefined {
  return db.prepare('SELECT * FROM statuses WHERE id = ?').get(id) as StatusRow | undefined;
}

/** Um status não pode ao mesmo tempo concluir (entregar) e encerrar sem entrega. */
function assertFlags(f: { is_completion_status: unknown; is_cancel_status: unknown }) {
  if (Number(f.is_completion_status) && Number(f.is_cancel_status)) {
    throw badRequest('Um status não pode ser ao mesmo tempo "Conclusão" e "Encerra sem entrega".');
  }
}

export function statusesRouter(db: DB) {
  const r = Router();

  r.get('/', (_req, res) => {
    res.json(db.prepare('SELECT * FROM statuses ORDER BY position, id').all());
  });

  const ensureSingleDefault = (id: number) =>
    db.prepare('UPDATE statuses SET is_default = 0 WHERE id <> ?').run(id);

  r.post('/', requireAdmin, (req, res) => {
    const d = schema.parse(req.body);
    assertFlags(d);
    const now = nowIso();
    const pos = (db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM statuses').get() as { p: number }).p;
    const id = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO statuses (name, color, position, is_default, is_start_status, is_completion_status, counts_in_wip,
                                 is_cancel_status, active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          d.name, d.color, pos, +d.is_default, +d.is_start_status, +d.is_completion_status, +d.counts_in_wip,
          +d.is_cancel_status, +d.active, now, now,
        );
      const newId = Number(info.lastInsertRowid);
      if (d.is_default) ensureSingleDefault(newId);
      return newId;
    })();
    res.status(201).json(getStatus(db, id));
  });

  // Reordenação: recebe a lista completa de IDs na nova ordem.
  r.put('/reorder', requireAdmin, (req, res) => {
    const { ids } = z.object({ ids: z.array(z.number().int().positive()).min(1) }).parse(req.body);
    const stmt = db.prepare('UPDATE statuses SET position = ?, updated_at = ? WHERE id = ?');
    const now = nowIso();
    db.transaction(() => ids.forEach((id, i) => stmt.run(i + 1, now, id)))();
    res.json(db.prepare('SELECT * FROM statuses ORDER BY position, id').all());
  });

  r.put('/:id', requireAdmin, (req, res) => {
    const id = idParam(req);
    const current = getStatus(db, id);
    if (!current) throw notFound('Status');
    const d = sentOnly(schema.partial().parse(req.body), req.body);
    const next = {
      name: d.name ?? current.name,
      color: d.color ?? current.color,
      is_default: d.is_default === undefined ? current.is_default : +d.is_default,
      is_start_status: d.is_start_status === undefined ? current.is_start_status : +d.is_start_status,
      is_completion_status:
        d.is_completion_status === undefined ? current.is_completion_status : +d.is_completion_status,
      counts_in_wip: d.counts_in_wip === undefined ? current.counts_in_wip : +d.counts_in_wip,
      is_cancel_status: d.is_cancel_status === undefined ? current.is_cancel_status : +d.is_cancel_status,
      active: d.active === undefined ? current.active : +d.active,
    };
    assertFlags(next);
    if (!next.active) {
      const inUse = db
        .prepare('SELECT COUNT(*) AS n FROM tasks WHERE status_id = ? AND deleted_at IS NULL')
        .get(id) as { n: number };
      if (inUse.n > 0) {
        throw badRequest(`Não é possível desativar: ${inUse.n} tarefa(s) estão neste status. Mova-as antes.`);
      }
      if (next.is_default) throw badRequest('O status padrão de novas tarefas não pode ser desativado.');
    }
    db.transaction(() => {
      db.prepare(
        `UPDATE statuses SET name = ?, color = ?, is_default = ?, is_start_status = ?, is_completion_status = ?,
                counts_in_wip = ?, is_cancel_status = ?, active = ?, updated_at = ? WHERE id = ?`,
      ).run(
        next.name,
        next.color,
        next.is_default,
        next.is_start_status,
        next.is_completion_status,
        next.counts_in_wip,
        next.is_cancel_status,
        next.active,
        nowIso(),
        id,
      );
      if (next.is_default) ensureSingleDefault(id);
    })();
    res.json(getStatus(db, id));
  });

  return r;
}
