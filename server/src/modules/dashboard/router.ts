import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../../db/connection.js';
import { badRequest } from '../../lib/http.js';
import { addDays, isValidDate, todayLocal } from '../../lib/time.js';
import { buildTaskWhere } from '../tasks/service.js';
import {
  computeMetrics,
  computeTimeInStatus,
  type HistoryEvent,
  type MetricTask,
  type StatusInfo,
} from './metrics.js';

const qId = z.preprocess((v) => (v === '' || v == null ? undefined : Number(v)), z.number().int().positive().optional());
const qDate = z.preprocess((v) => (v === '' ? undefined : v), z.string().refine(isValidDate).optional());

const querySchema = z.object({
  from: qDate,
  to: qDate,
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
                s.is_completion_status AS is_completed, s.is_cancel_status AS is_canceled, s.counts_in_wip
           FROM tasks t JOIN statuses s ON s.id = t.status_id
          WHERE ${sql}`,
      )
      .all(...params) as (Omit<MetricTask, 'is_completed' | 'is_canceled' | 'counts_in_wip'> & {
      is_completed: number;
      is_canceled: number;
      counts_in_wip: number;
    })[];
    const tasks: MetricTask[] = rows.map((t) => ({
      ...t,
      is_completed: !!t.is_completed,
      is_canceled: !!t.is_canceled,
      counts_in_wip: !!t.counts_in_wip,
    }));

    // Histórico de status das mesmas tarefas filtradas, para o tempo em cada coluna.
    const events = db
      .prepare(
        `SELECT h.task_id, h.to_status_id, h.changed_at
           FROM task_status_history h
           JOIN tasks t ON t.id = h.task_id
           JOIN statuses s ON s.id = t.status_id
          WHERE ${sql}`,
      )
      .all(...params) as unknown as HistoryEvent[];
    const statuses = db.prepare('SELECT * FROM statuses ORDER BY position').all() as unknown as (Omit<
      StatusInfo,
      'is_completion_status' | 'is_cancel_status'
    > & { is_completion_status: number; is_cancel_status: number; counts_in_wip: number; active: number })[];

    res.json({
      ...computeMetrics({ tasks, from, to, today, now: new Date() }),
      time_in_status: computeTimeInStatus(
        events,
        statuses.map((s) => ({
          ...s,
          is_completion_status: !!s.is_completion_status,
          is_cancel_status: !!s.is_cancel_status,
        })),
        from,
        to,
      ),
      wip_statuses: statuses
        .filter((s) => s.active && s.counts_in_wip && !s.is_completion_status && !s.is_cancel_status)
        .map((s) => s.name),
    });
  });

  return r;
}
