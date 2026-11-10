import { Router } from 'express';
import { z } from 'zod';
import { originOf } from './requests/service.js';
import type { DB } from '../db/connection.js';
import { requireAdmin } from '../lib/auth.js';
import { moveItem, placement } from '../lib/board.js';
import { trashEpic } from './trash.js';
import { idParam, notFound } from '../lib/http.js';
import { nowIso } from '../lib/time.js';
import { bool, optionalDate, optionalId, optionalText, requiredText } from '../lib/validation.js';

const schema = z.object({
  name: requiredText(200),
  description: optionalText,
  okr: optionalText,
  owner_id: optionalId,
  /** Coluna do quadro (mesmos status das tarefas). Vazio = status padrão. */
  status_id: optionalId,
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
         st.name AS status_name, st.color AS status_color,
         st.is_completion_status AS is_completed, st.is_cancel_status AS is_canceled,
         (SELECT COUNT(*) FROM outcomes o WHERE o.epic_id = e.id AND o.active = 1 AND o.deleted_at IS NULL) AS outcomes_count,
         (SELECT COUNT(*) FROM tasks t JOIN statuses s ON s.id = t.status_id
           WHERE t.epic_id = e.id AND t.deleted_at IS NULL AND s.is_cancel_status = 0) AS tasks_count,
         (SELECT COUNT(*) FROM tasks t JOIN statuses s ON s.id = t.status_id
           WHERE t.epic_id = e.id AND t.deleted_at IS NULL AND s.is_completion_status = 1) AS tasks_done
    FROM epics e LEFT JOIN users u ON u.id = e.owner_id
    LEFT JOIN statuses st ON st.id = e.status_id`;

/** Cria um épico (usado pelo cadastro e pela aprovação de solicitações). */
export function createEpic(db: DB, input: unknown) {
  const d = schema.parse(input);
  const now = nowIso();
  const p = placement(db, 'epics', d.status_id);
  const info = db
    .prepare(
      `INSERT INTO epics (name, description, okr, owner_id, status_id, board_position, start_date, end_date, active,
                          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(d.name, d.description, d.okr, d.owner_id, p.status_id, p.board_position, d.start_date, d.end_date, +d.active, now, now);
  return db.prepare(`${EPIC_SELECT} WHERE e.deleted_at IS NULL AND e.id = ?`).get(info.lastInsertRowid) as { id: number } & Record<string, unknown>;
}

export function listEpics(db: DB, includeInactive = false) {
  return db
    .prepare(`${EPIC_SELECT} WHERE e.deleted_at IS NULL${includeInactive ? '' : ' AND e.active = 1'} ORDER BY e.active DESC, e.name`)
    .all() as ({ id: number } & Record<string, unknown>)[];
}

export function getEpic(db: DB, id: number) {
  const epic = db.prepare(`${EPIC_SELECT} WHERE e.deleted_at IS NULL AND e.id = ?`).get(id) as
    | ({ id: number } & Record<string, unknown>)
    | undefined;
  if (!epic) throw notFound('Épico');
  return { ...epic, origin_request: originOf(db, 'epic', id) };
}

/** Atualiza um épico (todos os campos do formulário). */
export function updateEpic(db: DB, id: number, input: unknown) {
  const current = db.prepare('SELECT id, status_id, board_position FROM epics WHERE id = ? AND deleted_at IS NULL').get(id) as
    | { id: number; status_id: number | null; board_position: number | null }
    | undefined;
  if (!current) throw notFound('Épico');
  const d = schema.parse(input);
  const p = placement(db, 'epics', d.status_id, current);
  db.prepare(
    `UPDATE epics SET name = ?, description = ?, okr = ?, owner_id = ?, status_id = ?, board_position = ?, start_date = ?,
                      end_date = ?, active = ?, updated_at = ? WHERE id = ?`,
  ).run(d.name, d.description, d.okr, d.owner_id, p.status_id, p.board_position, d.start_date, d.end_date, +d.active, nowIso(), id);
  return db.prepare(`${EPIC_SELECT} WHERE e.deleted_at IS NULL AND e.id = ?`).get(id) as { id: number } & Record<string, unknown>;
}

export function epicsRouter(db: DB) {
  const r = Router();

  r.get('/', (req, res) => {
    res.json(listEpics(db, req.query.include_inactive === 'true'));
  });

  r.get('/:id', (req, res) => {
    res.json(getEpic(db, idParam(req)));
  });

  r.post('/', (req, res) => {
    res.status(201).json(createEpic(db, req.body));
  });

  r.put('/:id', (req, res) => {
    res.json(updateEpic(db, idParam(req), req.body));
  });

  r.patch('/:id/position', (req, res) => {
    const id = idParam(req);
    if (!db.prepare('SELECT id FROM epics WHERE id = ? AND deleted_at IS NULL').get(id)) throw notFound('Épico');
    moveItem(db, 'epics', id, req.body, nowIso());
    res.json(db.prepare(`${EPIC_SELECT} WHERE e.deleted_at IS NULL AND e.id = ?`).get(id));
  });

  // Mover para a lixeira (com os outcomes do épico): somente administradores.
  r.delete('/:id', requireAdmin, (req, res) => {
    trashEpic(db, idParam(req), req.user!.id);
    res.status(204).end();
  });

  return r;
}
