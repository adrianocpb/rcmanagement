import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db/connection.js';
import { idParam, notFound } from '../lib/http.js';
import { nowIso } from '../lib/time.js';
import { PLAN_STATUSES, bool, optionalDate, optionalId, optionalText, requiredText } from '../lib/validation.js';

const schema = z.object({
  name: requiredText(200),
  description: optionalText,
  okr: optionalText,
  owner_id: optionalId,
  status: z.enum(PLAN_STATUSES).default('planejado'),
  start_date: optionalDate,
  end_date: optionalDate,
  active: bool.default(true),
});

/**
 * Agregados por épico. Progresso geral = tarefas concluídas / total de tarefas do épico
 * (tarefas em status "encerra sem entrega", como Cancelado, não entram no total)
 * (inclui tarefas ligadas diretamente ao épico e via outcomes).
 */
const EPIC_SELECT = `
  SELECT e.*, u.name AS owner_name,
         (SELECT COUNT(*) FROM outcomes o WHERE o.epic_id = e.id AND o.active = 1) AS outcomes_count,
         (SELECT COUNT(*) FROM tasks t JOIN statuses s ON s.id = t.status_id
           WHERE t.epic_id = e.id AND t.deleted_at IS NULL AND s.is_cancel_status = 0) AS tasks_count,
         (SELECT COUNT(*) FROM tasks t JOIN statuses s ON s.id = t.status_id
           WHERE t.epic_id = e.id AND t.deleted_at IS NULL AND s.is_completion_status = 1) AS tasks_done
    FROM epics e LEFT JOIN users u ON u.id = e.owner_id`;

export function epicsRouter(db: DB) {
  const r = Router();

  r.get('/', (req, res) => {
    const includeInactive = req.query.include_inactive === 'true';
    res.json(
      db.prepare(`${EPIC_SELECT} ${includeInactive ? '' : 'WHERE e.active = 1'} ORDER BY e.active DESC, e.name`).all(),
    );
  });

  r.get('/:id', (req, res) => {
    const id = idParam(req);
    const epic = db.prepare(`${EPIC_SELECT} WHERE e.id = ?`).get(id);
    if (!epic) throw notFound('Épico');
    res.json(epic);
  });

  r.post('/', (req, res) => {
    const d = schema.parse(req.body);
    const now = nowIso();
    const info = db
      .prepare(
        `INSERT INTO epics (name, description, okr, owner_id, status, start_date, end_date, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(d.name, d.description, d.okr, d.owner_id, d.status, d.start_date, d.end_date, +d.active, now, now);
    res.status(201).json(db.prepare(`${EPIC_SELECT} WHERE e.id = ?`).get(info.lastInsertRowid));
  });

  r.put('/:id', (req, res) => {
    const id = idParam(req);
    if (!db.prepare('SELECT id FROM epics WHERE id = ?').get(id)) throw notFound('Épico');
    const d = schema.parse(req.body);
    db.prepare(
      `UPDATE epics SET name = ?, description = ?, okr = ?, owner_id = ?, status = ?, start_date = ?, end_date = ?,
                        active = ?, updated_at = ? WHERE id = ?`,
    ).run(d.name, d.description, d.okr, d.owner_id, d.status, d.start_date, d.end_date, +d.active, nowIso(), id);
    res.json(db.prepare(`${EPIC_SELECT} WHERE e.id = ?`).get(id));
  });

  return r;
}
