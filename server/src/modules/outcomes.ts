import { Router } from 'express';
import { z } from 'zod';
import { originOf } from './requests/service.js';
import type { DB } from '../db/connection.js';
import { requireAdmin } from '../lib/auth.js';
import { OUTCOME_COLORS } from '../lib/colors.js';
import { moveItem, placement } from '../lib/board.js';
import { flagEvents, setFlag } from '../lib/flags.js';
import { trashOutcome } from './trash.js';
import { badRequest, idParam, notFound } from '../lib/http.js';
import { nowIso } from '../lib/time.js';
import {
  bool,
  iceValue,
  optionalDate,
  optionalId,
  optionalNumber,
  optionalText,
  requiredId,
  requiredText,
} from '../lib/validation.js';

export { OUTCOME_COLORS };

/** Cor menos usada entre os outcomes ativos (empate: ordem da paleta), para novos outcomes se distinguirem. */
function nextColor(db: DB) {
  const used = new Map(
    (db.prepare('SELECT color, COUNT(*) AS n FROM outcomes WHERE active = 1 AND deleted_at IS NULL AND color IS NOT NULL GROUP BY color').all() as {
      color: string;
      n: number;
    }[]).map((r) => [r.color, r.n]),
  );
  return [...OUTCOME_COLORS].sort((a, b) => (used.get(a) ?? 0) - (used.get(b) ?? 0))[0];
}

const schema = z.object({
  name: requiredText(200),
  description: optionalText,
  epic_id: requiredId,
  owner_id: optionalId,
  /** Coluna do quadro (mesmos status das tarefas). Vazio = status padrão. */
  status_id: optionalId,
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
  color: z.preprocess((v) => (v === '' ? null : v), z.enum(OUTCOME_COLORS).nullish()),
});

const OUTCOME_SELECT = `
  SELECT o.*, e.name AS epic_name, u.name AS owner_name,
         st.name AS status_name, st.color AS status_color,
         st.is_completion_status AS is_completed, st.is_cancel_status AS is_canceled,
         fu.name AS flagged_by_name,
         (SELECT COUNT(*) FROM tasks t JOIN statuses s ON s.id = t.status_id
           WHERE t.outcome_id = o.id AND t.deleted_at IS NULL AND s.is_cancel_status = 0) AS tasks_count,
         (SELECT COUNT(*) FROM tasks t JOIN statuses s ON s.id = t.status_id
           WHERE t.outcome_id = o.id AND t.deleted_at IS NULL AND s.is_completion_status = 1) AS tasks_done
    FROM outcomes o
    JOIN epics e ON e.id = o.epic_id
    LEFT JOIN users u ON u.id = o.owner_id
    LEFT JOIN statuses st ON st.id = o.status_id
    LEFT JOIN users fu ON fu.id = o.flagged_by`;

function assertEpic(db: DB, id: number) {
  if (!db.prepare('SELECT id FROM epics WHERE id = ? AND deleted_at IS NULL').get(id)) throw badRequest('Épico inválido.');
}

/** Cria um outcome (usado pelo cadastro e pela aprovação de solicitações). */
export function createOutcome(db: DB, input: unknown) {
  const d = schema.parse(input);
  assertEpic(db, d.epic_id);
  const now = nowIso();
  const p = placement(db, 'outcomes', d.status_id);
  const info = db
    .prepare(
      `INSERT INTO outcomes (epic_id, name, description, owner_id, status_id, board_position, start_date, target_date, indicator_name,
                             indicator_unit, baseline_value, target_value, current_value, ice_impact, ice_confidence,
                             ice_ease, active, color, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      d.epic_id, d.name, d.description, d.owner_id, p.status_id, p.board_position, d.start_date, d.target_date,
      d.indicator_name, d.indicator_unit, d.baseline_value, d.target_value, d.current_value, d.ice_impact,
      d.ice_confidence, d.ice_ease, +d.active, d.color ?? nextColor(db), now, now,
    );
  return db.prepare(`${OUTCOME_SELECT} WHERE o.deleted_at IS NULL AND o.id = ?`).get(info.lastInsertRowid) as { id: number } & Record<string, unknown>;
}

export function listOutcomes(db: DB, f: { includeInactive?: boolean; epicId?: number } = {}) {
  const where: string[] = ['o.deleted_at IS NULL'];
  const params: unknown[] = [];
  if (!f.includeInactive) where.push('o.active = 1');
  if (f.epicId) {
    where.push('o.epic_id = ?');
    params.push(f.epicId);
  }
  return db.prepare(`${OUTCOME_SELECT} WHERE ${where.join(' AND ')} ORDER BY e.name, o.name`).all(...params) as ({
    id: number;
  } & Record<string, unknown>)[];
}

export function getOutcome(db: DB, id: number) {
  const outcome = db.prepare(`${OUTCOME_SELECT} WHERE o.deleted_at IS NULL AND o.id = ?`).get(id) as
    | ({ id: number } & Record<string, unknown>)
    | undefined;
  if (!outcome) throw notFound('Outcome');
  return { ...outcome, origin_request: originOf(db, 'outcome', id), flag_events: flagEvents(db, 'outcome', id) };
}

/** Atualiza um outcome (todos os campos do formulário). Tarefas ligadas acompanham a troca de épico. */
export function updateOutcome(db: DB, id: number, input: unknown) {
  const current = db.prepare('SELECT id, status_id, board_position FROM outcomes WHERE id = ? AND deleted_at IS NULL').get(id) as
    | { id: number; status_id: number | null; board_position: number | null }
    | undefined;
  if (!current) throw notFound('Outcome');
  const d = schema.parse(input);
  assertEpic(db, d.epic_id);
  const p = placement(db, 'outcomes', d.status_id, current);
  db.transaction(() => {
    db.prepare(
      `UPDATE outcomes SET epic_id = ?, name = ?, description = ?, owner_id = ?, status_id = ?, board_position = ?,
                           start_date = ?, target_date = ?, indicator_name = ?, indicator_unit = ?, baseline_value = ?,
                           target_value = ?, current_value = ?, ice_impact = ?, ice_confidence = ?, ice_ease = ?,
                           active = ?, color = COALESCE(?, color), updated_at = ?
        WHERE id = ?`,
    ).run(
      d.epic_id, d.name, d.description, d.owner_id, p.status_id, p.board_position, d.start_date, d.target_date,
      d.indicator_name, d.indicator_unit, d.baseline_value, d.target_value, d.current_value, d.ice_impact,
      d.ice_confidence, d.ice_ease, +d.active, d.color ?? null, nowIso(), id,
    );
    // Mantém a coerência Épico → Outcome → Tarefa se o outcome mudar de épico.
    db.prepare('UPDATE tasks SET epic_id = ? WHERE outcome_id = ?').run(d.epic_id, id);
  })();
  return db.prepare(`${OUTCOME_SELECT} WHERE o.deleted_at IS NULL AND o.id = ?`).get(id) as { id: number } & Record<string, unknown>;
}

export function outcomesRouter(db: DB) {
  const r = Router();

  r.get('/', (req, res) => {
    res.json(
      listOutcomes(db, {
        includeInactive: req.query.include_inactive === 'true',
        epicId: req.query.epic_id ? Number(req.query.epic_id) : undefined,
      }),
    );
  });

  r.get('/:id', (req, res) => {
    res.json(getOutcome(db, idParam(req)));
  });

  r.post('/', (req, res) => {
    res.status(201).json(createOutcome(db, req.body));
  });

  r.put('/:id', (req, res) => {
    res.json(updateOutcome(db, idParam(req), req.body));
  });

  r.patch('/:id/position', (req, res) => {
    const id = idParam(req);
    if (!db.prepare('SELECT id FROM outcomes WHERE id = ? AND deleted_at IS NULL').get(id)) throw notFound('Outcome');
    moveItem(db, 'outcomes', id, req.body, nowIso());
    res.json(db.prepare(`${OUTCOME_SELECT} WHERE o.deleted_at IS NULL AND o.id = ?`).get(id));
  });

  // Flag (marcador de bloqueio): colocar ou retirar. Fica no histórico.
  r.put('/:id/flag', (req, res) => {
    const id = idParam(req);
    setFlag(db, 'outcome', id, req.body, req.user!.id, nowIso());
    res.json(db.prepare(`${OUTCOME_SELECT} WHERE o.deleted_at IS NULL AND o.id = ?`).get(id));
  });

  // Mover para a lixeira: somente administradores.
  r.delete('/:id', requireAdmin, (req, res) => {
    trashOutcome(db, idParam(req), req.user!.id);
    res.status(204).end();
  });

  return r;
}
