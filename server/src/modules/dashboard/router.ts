import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../../db/connection.js';
import { badRequest } from '../../lib/http.js';
import { addDays, isValidDate, todayLocal } from '../../lib/time.js';
import { buildTaskWhere } from '../tasks/service.js';
import { computeMetrics, type MetricTask } from './metrics.js';

const qId = z.preprocess((v) => (v === '' || v == null ? undefined : Number(v)), z.number().int().positive().optional());
const qDate = z.preprocess((v) => (v === '' ? undefined : v), z.string().refine(isValidDate).optional());

const querySchema = z.object({
  from: qDate,
  to: qDate,
  granularity: z.enum(['week', 'month']).default('week'),
  assignee_id: qId,
  sector_id: qId,
  epic_id: qId,
  outcome_id: qId,
});

export function dashboardRouter(db: DB) {
  const r = Router();

  r.get('/', (req, res) => {
    const q = querySchema.parse(req.query);
    const today = todayLocal();
    const to = q.to ?? today;
    const from = q.from ?? addDays(to, -89);
    if (from > to) throw badRequest('A data inicial deve ser anterior à final.');

    // Filtros de dimensão; o período é aplicado dentro de computeMetrics por indicador.
    const { sql, params } = buildTaskWhere(
      { assignee_id: q.assignee_id, sector_id: q.sector_id, epic_id: q.epic_id, outcome_id: q.outcome_id },
      today,
    );
    const rows = db
      .prepare(
        `SELECT t.id, t.status_id, t.created_at, t.started_at, t.completed_at, t.planned_end_date,
                s.name AS status_name, s.color AS status_color, s.position AS status_position,
                s.is_completion_status AS is_completed
           FROM tasks t JOIN statuses s ON s.id = t.status_id
          WHERE ${sql}`,
      )
      .all(...params) as (Omit<MetricTask, 'is_completed'> & { is_completed: number })[];

    const tasks: MetricTask[] = rows.map((t) => ({ ...t, is_completed: !!t.is_completed }));
    res.json(computeMetrics({ tasks, from, to, granularity: q.granularity, today, now: new Date() }));
  });

  return r;
}
