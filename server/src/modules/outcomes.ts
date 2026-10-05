import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db/connection.js';
import { badRequest, idParam, notFound } from '../lib/http.js';
import { nowIso } from '../lib/time.js';
import {
  PLAN_STATUSES,
  bool,
  iceValue,
  optionalDate,
  optionalId,
  optionalNumber,
  optionalText,
  requiredId,
  requiredText,
} from '../lib/validation.js';

const schema = z.object({
  name: requiredText(200),
  description: optionalText,
  epic_id: requiredId,
  owner_id: optionalId,
  status: z.enum(PLAN_STATUSES).default('planejado'),
  start_date: optionalDate,
  target_date: optionalDate,
  indicator_name: optionalText,
  indicator_unit: optionalText,
  baseline_value: optionalNumber,
  target_value: optionalNumber,
  current_value: optionalNumber,
  ice_impact: iceValue,
  ice_confidence: iceValue,
  ice_ease: iceValue,
  active: bool.default(true),
});

const OUTCOME_SELECT = `
  SELECT o.*, e.name AS epic_name, u.name AS owner_name,
         (SELECT COUNT(*) FROM tasks t WHERE t.outcome_id = o.id AND t.deleted_at IS NULL) AS tasks_count,
         (SELECT COUNT(*) FROM tasks t JOIN statuses s ON s.id = t.status_id
           WHERE t.outcome_id = o.id AND t.deleted_at IS NULL AND s.is_completion_status = 1) AS tasks_done
    FROM outcomes o
    JOIN epics e ON e.id = o.epic_id
    LEFT JOIN users u ON u.id = o.owner_id`;

export function outcomesRouter(db: DB) {
  const r = Router();

  r.get('/', (req, res) => {
    const where: string[] = [];
    const params: unknown[] = [];
    if (req.query.include_inactive !== 'true') where.push('o.active = 1');
    if (req.query.epic_id) {
      where.push('o.epic_id = ?');
      params.push(Number(req.query.epic_id));
    }
    res.json(
      db
        .prepare(`${OUTCOME_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY e.name, o.name`)
        .all(...params),
    );
  });

  r.get('/:id', (req, res) => {
    const outcome = db.prepare(`${OUTCOME_SELECT} WHERE o.id = ?`).get(idParam(req));
    if (!outcome) throw notFound('Outcome');
    res.json(outcome);
  });

  const ensureEpic = (id: number) => {
    if (!db.prepare('SELECT id FROM epics WHERE id = ?').get(id)) throw badRequest('Épico inválido.');
  };

  r.post('/', (req, res) => {
    const d = schema.parse(req.body);
    ensureEpic(d.epic_id);
    const now = nowIso();
    const info = db
      .prepare(
        `INSERT INTO outcomes (epic_id, name, description, owner_id, status, start_date, target_date, indicator_name,
                               indicator_unit, baseline_value, target_value, current_value, ice_impact, ice_confidence,
                               ice_ease, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        d.epic_id, d.name, d.description, d.owner_id, d.status, d.start_date, d.target_date, d.indicator_name,
        d.indicator_unit, d.baseline_value, d.target_value, d.current_value, d.ice_impact, d.ice_confidence,
        d.ice_ease, +d.active, now, now,
      );
    res.status(201).json(db.prepare(`${OUTCOME_SELECT} WHERE o.id = ?`).get(info.lastInsertRowid));
  });

  r.put('/:id', (req, res) => {
    const id = idParam(req);
    if (!db.prepare('SELECT id FROM outcomes WHERE id = ?').get(id)) throw notFound('Outcome');
    const d = schema.parse(req.body);
    ensureEpic(d.epic_id);
    db.transaction(() => {
      db.prepare(
        `UPDATE outcomes SET epic_id = ?, name = ?, description = ?, owner_id = ?, status = ?, start_date = ?,
                             target_date = ?, indicator_name = ?, indicator_unit = ?, baseline_value = ?,
                             target_value = ?, current_value = ?, ice_impact = ?, ice_confidence = ?, ice_ease = ?,
                             active = ?, updated_at = ?
          WHERE id = ?`,
      ).run(
        d.epic_id, d.name, d.description, d.owner_id, d.status, d.start_date, d.target_date, d.indicator_name,
        d.indicator_unit, d.baseline_value, d.target_value, d.current_value, d.ice_impact, d.ice_confidence,
        d.ice_ease, +d.active, nowIso(), id,
      );
      // Mantém a coerência Épico → Outcome → Tarefa se o outcome mudar de épico.
      db.prepare('UPDATE tasks SET epic_id = ? WHERE outcome_id = ?').run(d.epic_id, id);
    })();
    res.json(db.prepare(`${OUTCOME_SELECT} WHERE o.id = ?`).get(id));
  });

  return r;
}
