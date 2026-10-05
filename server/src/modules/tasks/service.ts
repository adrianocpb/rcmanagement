import { z } from 'zod';
import type { DB } from '../../db/connection.js';
import { badRequest, notFound } from '../../lib/http.js';
import { addDays, nowIso, startOfLocalDayUtc, todayLocal } from '../../lib/time.js';
import {
  PRIORITIES,
  iceValue,
  optionalDate,
  optionalId,
  optionalInstant,
  optionalNumber,
  optionalText,
  requiredId,
  requiredText,
  sentOnly,
} from '../../lib/validation.js';
import { getStatus, type StatusRow } from '../statuses.js';
import { applyStatusEntry, deadlineState } from './rules.js';

export const createTaskSchema = z.object({
  title: requiredText(200),
  description: optionalText,
  notes: optionalText,
  sector_id: requiredId,
  requester_id: requiredId,
  assignee_id: requiredId,
  status_id: optionalId, // vazio → status padrão configurado
  epic_id: optionalId,
  outcome_id: optionalId,
  priority: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.enum(PRIORITIES).default('media')),
  estimated_hours: optionalNumber.refine((v) => v === null || v >= 0, 'não pode ser negativo'),
  planned_start_date: optionalDate,
  ice_impact: iceValue,
  ice_confidence: iceValue,
  ice_ease: iceValue,
  planned_end_date: optionalDate, // opcional: sem prazo, a tarefa nunca fica "atrasada"
});

export const updateTaskSchema = createTaskSchema
  .extend({
    status_id: requiredId,
    planned_end_date: optionalDate,
    // Ajustes manuais (correções) das datas reais. Só são aplicados se diferirem do valor gravado.
    started_at: optionalInstant,
    completed_at: optionalInstant,
  })
  .partial();

export type TaskFilters = {
  status_id?: number;
  assignee_id?: number;
  requester_id?: number;
  sector_id?: number;
  epic_id?: number;
  outcome_id?: number;
  priority?: string;
  from?: string;
  to?: string;
  period_field?: 'planned_end' | 'created' | 'completed';
  overdue?: boolean;
  q?: string;
};

const BASE_SELECT = `
  SELECT t.*,
         s.name  AS status_name, s.color AS status_color, s.position AS status_position,
         s.is_completion_status AS is_completed, s.is_cancel_status AS is_canceled, s.is_start_status AS status_is_start,
         sec.name AS sector_name,
         req.name AS requester_name,
         asg.name AS assignee_name,
         e.name  AS epic_name,
         o.name  AS outcome_name
    FROM tasks t
    JOIN statuses s   ON s.id = t.status_id
    JOIN sectors sec  ON sec.id = t.sector_id
    JOIN users req    ON req.id = t.requester_id
    JOIN users asg    ON asg.id = t.assignee_id
    LEFT JOIN epics e    ON e.id = t.epic_id
    LEFT JOIN outcomes o ON o.id = t.outcome_id`;

export type TaskRow = Record<string, unknown> & {
  id: number;
  status_id: number;
  planned_end_date: string | null;
  started_at: string | null;
  completed_at: string | null;
  is_completed: number;
  is_canceled?: number;
};

function decorate(row: TaskRow, today: string) {
  const state = deadlineState(row, !!row.is_completed, today, !!row.is_canceled);
  return {
    ...row,
    is_completed: !!row.is_completed,
    is_canceled: !!row.is_canceled,
    deadline_state: state,
    is_overdue: state === 'atrasada',
  };
}

/** Monta cláusulas WHERE compartilhadas entre lista de tarefas e dashboard. */
export function buildTaskWhere(f: TaskFilters, today = todayLocal()) {
  const where = ['t.deleted_at IS NULL'];
  const params: unknown[] = [];
  const eq = (col: string, v: unknown) => {
    if (v !== undefined && v !== null && v !== '') {
      where.push(`${col} = ?`);
      params.push(v);
    }
  };
  eq('t.status_id', f.status_id);
  eq('t.assignee_id', f.assignee_id);
  eq('t.requester_id', f.requester_id);
  eq('t.sector_id', f.sector_id);
  eq('t.epic_id', f.epic_id);
  eq('t.outcome_id', f.outcome_id);
  eq('t.priority', f.priority);
  if (f.q) {
    where.push('(t.title LIKE ? OR t.description LIKE ?)');
    params.push(`%${f.q}%`, `%${f.q}%`);
  }
  if (f.from || f.to) {
    const field = f.period_field ?? 'planned_end';
    if (field === 'planned_end') {
      if (f.from) (where.push('t.planned_end_date >= ?'), params.push(f.from));
      if (f.to) (where.push('t.planned_end_date <= ?'), params.push(f.to));
    } else {
      const col = field === 'created' ? 't.created_at' : 't.completed_at';
      if (f.from) (where.push(`${col} >= ?`), params.push(startOfLocalDayUtc(f.from)));
      if (f.to) (where.push(`${col} < ?`), params.push(startOfLocalDayUtc(addDays(f.to, 1))));
    }
  }
  if (f.overdue) {
    where.push(
      's.is_completion_status = 0 AND s.is_cancel_status = 0 AND t.planned_end_date IS NOT NULL AND t.planned_end_date < ?',
    );
    params.push(today);
  }
  return { sql: where.join(' AND '), params };
}

export function listTasks(db: DB, f: TaskFilters) {
  const today = todayLocal();
  const { sql, params } = buildTaskWhere(f, today);
  const rows = db
    .prepare(
      `${BASE_SELECT} WHERE ${sql}
       ORDER BY s.position,
                CASE t.priority WHEN 'urgente' THEN 0 WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END,
                t.planned_end_date IS NULL, t.planned_end_date, t.id`,
    )
    .all(...params) as TaskRow[];
  return rows.map((r) => decorate(r, today));
}

export function getTask(db: DB, id: number) {
  const row = db.prepare(`${BASE_SELECT} WHERE t.id = ? AND t.deleted_at IS NULL`).get(id) as TaskRow | undefined;
  if (!row) throw notFound('Tarefa');
  const history = db
    .prepare(
      `SELECT h.id, h.changed_at, h.from_status_id, h.to_status_id,
              fs.name AS from_status_name, ts.name AS to_status_name, ts.color AS to_status_color,
              u.name AS changed_by_name
         FROM task_status_history h
         LEFT JOIN statuses fs ON fs.id = h.from_status_id
         JOIN statuses ts ON ts.id = h.to_status_id
         LEFT JOIN users u ON u.id = h.changed_by
        WHERE h.task_id = ?
        ORDER BY h.changed_at, h.id`,
    )
    .all(id);
  return { ...decorate(row, todayLocal()), history };
}

function requireRow(db: DB, table: string, id: number | null | undefined, label: string) {
  if (id == null) return null;
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (!row) throw badRequest(`${label} inválido(a).`);
  return row as Record<string, unknown>;
}

function resolveEpicFromOutcome(db: DB, epicId: number | null, outcomeId: number | null): number | null {
  if (outcomeId == null) return epicId;
  const outcome = requireRow(db, 'outcomes', outcomeId, 'Outcome') as { epic_id: number };
  // Um outcome pertence a um épico: a tarefa herda o épico do outcome.
  return outcome.epic_id;
}

function recordHistory(db: DB, taskId: number, from: number | null, to: number, userId: number, at: string) {
  db.prepare(
    'INSERT INTO task_status_history (task_id, from_status_id, to_status_id, changed_by, changed_at) VALUES (?, ?, ?, ?, ?)',
  ).run(taskId, from, to, userId, at);
}

function activeStatus(db: DB, id: number): StatusRow {
  const st = getStatus(db, id);
  if (!st || !st.active) throw badRequest('Status inválido ou inativo.');
  return st;
}

export function createTask(db: DB, input: unknown, userId: number, now = nowIso()) {
  const d = createTaskSchema.parse(input);
  let statusId = d.status_id;
  if (statusId == null) {
    const def = db
      .prepare('SELECT id FROM statuses WHERE active = 1 ORDER BY is_default DESC, position LIMIT 1')
      .get() as { id: number } | undefined;
    if (!def) throw badRequest('Nenhum status ativo configurado.');
    statusId = def.id;
  }
  const status = activeStatus(db, statusId);
  requireRow(db, 'sectors', d.sector_id, 'Setor');
  requireRow(db, 'users', d.requester_id, 'Solicitante');
  requireRow(db, 'users', d.assignee_id, 'Responsável');
  requireRow(db, 'epics', d.epic_id, 'Épico');
  const epicId = resolveEpicFromOutcome(db, d.epic_id, d.outcome_id);
  const dates = applyStatusEntry({ started_at: null, completed_at: null }, status, now);

  const id = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO tasks (title, description, notes, sector_id, requester_id, assignee_id, epic_id, outcome_id,
                            status_id, priority, estimated_hours, planned_start_date, planned_end_date,
                            ice_impact, ice_confidence, ice_ease,
                            started_at, completed_at, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        d.title,
        d.description,
        d.notes,
        d.sector_id,
        d.requester_id,
        d.assignee_id,
        epicId,
        d.outcome_id,
        status.id,
        d.priority,
        d.estimated_hours,
        d.planned_start_date,
        d.planned_end_date,
        d.ice_impact,
        d.ice_confidence,
        d.ice_ease,
        dates.started_at,
        dates.completed_at,
        userId,
        now,
        now,
      );
    const newId = Number(info.lastInsertRowid);
    recordHistory(db, newId, null, status.id, userId, now);
    return newId;
  })();
  return getTask(db, id);
}

export function updateTask(db: DB, id: number, input: unknown, userId: number, now = nowIso()) {
  const current = db.prepare('SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL').get(id) as
    | (TaskRow & Record<string, unknown>)
    | undefined;
  if (!current) throw notFound('Tarefa');
  const d = sentOnly(updateTaskSchema.parse(input), input);

  const has = (k: keyof typeof d) => Object.prototype.hasOwnProperty.call(d, k) && d[k] !== undefined;
  const pick = <K extends keyof typeof d>(k: K) => (has(k) ? d[k] : current[k as string]);

  for (const [k, label] of [
    ['sector_id', 'Setor'],
    ['requester_id', 'Solicitante'],
    ['assignee_id', 'Responsável'],
  ] as const) {
    if (has(k) && d[k] == null) throw badRequest(`${label} é obrigatório.`);
  }
  if (has('sector_id')) requireRow(db, 'sectors', d.sector_id, 'Setor');
  if (has('requester_id')) requireRow(db, 'users', d.requester_id, 'Solicitante');
  if (has('assignee_id')) requireRow(db, 'users', d.assignee_id, 'Responsável');
  if (has('epic_id')) requireRow(db, 'epics', d.epic_id, 'Épico');

  const outcomeId = (Object.prototype.hasOwnProperty.call(d, 'outcome_id') ? d.outcome_id : current.outcome_id) as
    | number
    | null;
  const epicIdInput = (Object.prototype.hasOwnProperty.call(d, 'epic_id') ? d.epic_id : current.epic_id) as
    | number
    | null;
  const epicId = resolveEpicFromOutcome(db, epicIdInput ?? null, outcomeId ?? null);

  let dates = { started_at: current.started_at, completed_at: current.completed_at };
  const newStatusId = (d.status_id ?? current.status_id) as number;
  const statusChanged = newStatusId !== current.status_id;
  if (statusChanged) dates = applyStatusEntry(dates, activeStatus(db, newStatusId), now);

  // Correções manuais: só valem quando o usuário alterou explicitamente o valor gravado.
  if (Object.prototype.hasOwnProperty.call(d, 'started_at') && d.started_at !== current.started_at) {
    dates.started_at = d.started_at ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(d, 'completed_at') && d.completed_at !== current.completed_at) {
    dates.completed_at = d.completed_at ?? null;
  }

  const text = (k: 'description' | 'notes') =>
    Object.prototype.hasOwnProperty.call(d, k) ? (d[k] ?? null) : current[k];
  const nullable = (
    k: 'estimated_hours' | 'planned_start_date' | 'planned_end_date' | 'ice_impact' | 'ice_confidence' | 'ice_ease',
  ) =>
    Object.prototype.hasOwnProperty.call(d, k) ? (d[k] ?? null) : current[k];

  db.transaction(() => {
    db.prepare(
      `UPDATE tasks SET title = ?, description = ?, notes = ?, sector_id = ?, requester_id = ?, assignee_id = ?,
                        epic_id = ?, outcome_id = ?, status_id = ?, priority = ?, estimated_hours = ?,
                        planned_start_date = ?, planned_end_date = ?, ice_impact = ?, ice_confidence = ?, ice_ease = ?,
                        started_at = ?, completed_at = ?, updated_at = ?
        WHERE id = ?`,
    ).run(
      pick('title'),
      text('description'),
      text('notes'),
      pick('sector_id'),
      pick('requester_id'),
      pick('assignee_id'),
      epicId,
      outcomeId ?? null,
      newStatusId,
      pick('priority'),
      nullable('estimated_hours'),
      nullable('planned_start_date'),
      nullable('planned_end_date'),
      nullable('ice_impact'),
      nullable('ice_confidence'),
      nullable('ice_ease'),
      dates.started_at,
      dates.completed_at,
      now,
      id,
    );
    if (statusChanged) recordHistory(db, id, current.status_id, newStatusId, userId, now);
  })();
  return getTask(db, id);
}

export function changeStatus(db: DB, id: number, statusId: number, userId: number, now = nowIso()) {
  return updateTask(db, id, { status_id: statusId }, userId, now);
}

export function deleteTask(db: DB, id: number) {
  const info = db
    .prepare('UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
    .run(nowIso(), nowIso(), id);
  if (info.changes === 0) throw notFound('Tarefa');
}
