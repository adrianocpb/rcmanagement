import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../../db/connection.js';
import { idParam } from '../../lib/http.js';
import { isValidDate } from '../../lib/time.js';
import { PRIORITIES } from '../../lib/validation.js';
import { changeStatus, createTask, deleteTask, getTask, listTasks, updateTask } from './service.js';

const qId = z.preprocess((v) => (v === '' || v == null ? undefined : Number(v)), z.number().int().positive().optional());
const qDate = z.preprocess((v) => (v === '' ? undefined : v), z.string().refine(isValidDate).optional());

export const taskFiltersSchema = z.object({
  status_id: qId,
  assignee_id: qId,
  requester_id: qId,
  sector_id: qId,
  epic_id: qId,
  outcome_id: qId,
  priority: z.preprocess((v) => (v === '' ? undefined : v), z.enum(PRIORITIES).optional()),
  from: qDate,
  to: qDate,
  period_field: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['planned_end', 'created', 'completed']).optional(),
  ),
  overdue: z.preprocess((v) => v === 'true' || v === '1' || v === true, z.boolean()).optional(),
  q: z.string().trim().max(200).optional(),
});

export function tasksRouter(db: DB) {
  const r = Router();

  r.get('/', (req, res) => {
    res.json(listTasks(db, taskFiltersSchema.parse(req.query)));
  });

  r.get('/:id', (req, res) => {
    res.json(getTask(db, idParam(req)));
  });

  r.post('/', (req, res) => {
    res.status(201).json(createTask(db, req.body, req.user!.id));
  });

  r.put('/:id', (req, res) => {
    res.json(updateTask(db, idParam(req), req.body, req.user!.id));
  });

  // Mudança de status (usada pelo arrastar-e-soltar do Kanban).
  r.patch('/:id/status', (req, res) => {
    const { status_id } = z.object({ status_id: z.coerce.number().int().positive() }).parse(req.body);
    res.json(changeStatus(db, idParam(req), status_id, req.user!.id));
  });

  r.delete('/:id', (req, res) => {
    deleteTask(db, idParam(req));
    res.status(204).end();
  });

  return r;
}
