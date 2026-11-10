/**
 * Lixeira de tarefas, outcomes e épicos (exclusão lógica: deleted_at / deleted_by).
 *  - Excluir um épico leva junto os outcomes dele (mesmo instante); restaurar o épico os traz de volta.
 *  - Um outcome cujo épico está na lixeira só volta junto com o épico.
 *  - As tarefas nunca são excluídas junto: enquanto o épico/outcome está na lixeira, elas apenas deixam
 *    de mostrá-lo; na exclusão definitiva, o vínculo é removido.
 *  - Itens ficam config.trashDays dias na lixeira e depois são removidos definitivamente.
 */
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import type { DB } from '../db/connection.js';
import { requireAdmin } from '../lib/auth.js';
import { deleteFlagEvents } from '../lib/flags.js';
import { badRequest, notFound } from '../lib/http.js';
import { nowIso } from '../lib/time.js';
import { listTrash as listTaskTrash, purgeTask, purgeTrash as purgeTaskTrash, restoreTask } from './tasks/service.js';

export type TrashType = 'task' | 'outcome' | 'epic';

// ---------------- Mover para a lixeira ----------------

export function trashOutcome(db: DB, id: number, userId: number, now = nowIso()) {
  const info = db
    .prepare('UPDATE outcomes SET deleted_at = ?, deleted_by = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
    .run(now, userId, now, id);
  if (info.changes === 0) throw notFound('Outcome');
}

export function trashEpic(db: DB, id: number, userId: number, now = nowIso()) {
  db.transaction(() => {
    const info = db
      .prepare('UPDATE epics SET deleted_at = ?, deleted_by = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
      .run(now, userId, now, id);
    if (info.changes === 0) throw notFound('Épico');
    db.prepare('UPDATE outcomes SET deleted_at = ?, deleted_by = ?, updated_at = ? WHERE epic_id = ? AND deleted_at IS NULL').run(
      now, userId, now, id,
    );
  })();
}

// ---------------- Restaurar ----------------

function restoreOutcome(db: DB, id: number) {
  const o = db
    .prepare(
      `SELECT o.id, e.deleted_at AS epic_deleted_at, e.name AS epic_name FROM outcomes o JOIN epics e ON e.id = o.epic_id
        WHERE o.id = ? AND o.deleted_at IS NOT NULL`,
    )
    .get(id) as { epic_deleted_at: string | null; epic_name: string } | undefined;
  if (!o) throw notFound('Outcome na lixeira');
  if (o.epic_deleted_at) throw badRequest(`O épico "${o.epic_name}" também está na lixeira: restaure o épico primeiro.`);
  db.prepare('UPDATE outcomes SET deleted_at = NULL, deleted_by = NULL, updated_at = ? WHERE id = ?').run(nowIso(), id);
}

function restoreEpic(db: DB, id: number) {
  const e = db.prepare('SELECT deleted_at FROM epics WHERE id = ? AND deleted_at IS NOT NULL').get(id) as
    | { deleted_at: string }
    | undefined;
  if (!e) throw notFound('Épico na lixeira');
  const now = nowIso();
  db.transaction(() => {
    // Os outcomes excluídos junto com o épico (mesmo instante) voltam com ele.
    db.prepare('UPDATE outcomes SET deleted_at = NULL, deleted_by = NULL, updated_at = ? WHERE epic_id = ? AND deleted_at = ?').run(
      now, id, e.deleted_at,
    );
    db.prepare('UPDATE epics SET deleted_at = NULL, deleted_by = NULL, updated_at = ? WHERE id = ?').run(now, id);
  })();
}

// ---------------- Excluir definitivamente ----------------

function purgeOutcomes(db: DB, ids: number[]) {
  const unlink = db.prepare('UPDATE tasks SET outcome_id = NULL WHERE outcome_id = ?');
  const del = db.prepare('DELETE FROM outcomes WHERE id = ?');
  for (const id of ids) {
    unlink.run(id);
    del.run(id);
  }
  deleteFlagEvents(db, 'outcome', ids);
}

function purgeEpics(db: DB, ids: number[]) {
  for (const id of ids) {
    const outcomeIds = (db.prepare('SELECT id FROM outcomes WHERE epic_id = ?').all(id) as { id: number }[]).map((r) => r.id);
    purgeOutcomes(db, outcomeIds);
    db.prepare('UPDATE tasks SET epic_id = NULL WHERE epic_id = ?').run(id);
    db.prepare('DELETE FROM epics WHERE id = ?').run(id);
  }
}

function deletedIds(db: DB, table: 'epics' | 'outcomes', olderThan?: string) {
  const sql = `SELECT id FROM ${table} WHERE deleted_at IS NOT NULL${olderThan ? ' AND deleted_at < ?' : ''}`;
  return (db.prepare(sql).all(...(olderThan ? [olderThan] : [])) as { id: number }[]).map((r) => r.id);
}

/** Esvazia a lixeira (tudo) ou, com `olderThanDays`, só o que passou do prazo. Retorna quantos itens saíram. */
export function purgeAllTrash(db: DB, olderThanDays?: number, now = new Date()): number {
  const cutoff = olderThanDays === undefined ? undefined : new Date(now.getTime() - olderThanDays * 86_400_000).toISOString();
  const tasks = purgeTaskTrash(db, olderThanDays, now);
  return db.transaction(() => {
    const epics = deletedIds(db, 'epics', cutoff);
    const epicOutcomes = epics.length
      ? (db.prepare(`SELECT COUNT(*) AS n FROM outcomes WHERE epic_id IN (${epics.map(() => '?').join(',')})`).get(...epics) as { n: number }).n
      : 0;
    purgeEpics(db, epics);
    const outcomes = deletedIds(db, 'outcomes', cutoff);
    purgeOutcomes(db, outcomes);
    return tasks + epics.length + epicOutcomes + outcomes.length;
  })();
}

function purgeOne(db: DB, type: TrashType, id: number) {
  if (type === 'task') return purgeTask(db, id);
  const table = type === 'epic' ? 'epics' : 'outcomes';
  if (!db.prepare(`SELECT id FROM ${table} WHERE id = ? AND deleted_at IS NOT NULL`).get(id)) {
    throw notFound(type === 'epic' ? 'Épico na lixeira' : 'Outcome na lixeira');
  }
  db.transaction(() => (type === 'epic' ? purgeEpics(db, [id]) : purgeOutcomes(db, [id])))();
}

// ---------------- Listagem ----------------

export interface TrashItem {
  type: TrashType;
  id: number;
  title: string;
  /** Contexto: setor/responsável (tarefa), épico (outcome), nº de outcomes (épico). */
  detail: string | null;
  status_name: string | null;
  status_color: string | null;
  deleted_at: string;
  deleted_by_name: string | null;
  /** Outcome excluído junto com o épico: volta ao restaurar o épico. */
  with_epic?: boolean;
  purge_at: string;
  days_left: number;
}

export function listAllTrash(db: DB, days: number, now = new Date()): TrashItem[] {
  const decorate = (r: Omit<TrashItem, 'purge_at' | 'days_left'>): TrashItem => {
    const purgeAt = new Date(new Date(r.deleted_at).getTime() + days * 86_400_000);
    return { ...r, purge_at: purgeAt.toISOString(), days_left: Math.max(0, Math.ceil((purgeAt.getTime() - now.getTime()) / 86_400_000)) };
  };
  const tasks = (listTaskTrash(db, days, now) as unknown as Record<string, string>[]).map((t) =>
    decorate({
      type: 'task',
      id: Number(t.id),
      title: t.title,
      detail: `${t.sector_name} · ${t.assignee_name}`,
      status_name: t.status_name,
      status_color: t.status_color,
      deleted_at: t.deleted_at,
      deleted_by_name: t.deleted_by_name ?? null,
    }),
  );
  const outcomes = (
    db
      .prepare(
        `SELECT o.id, o.name AS title, 'Épico: ' || e.name AS detail, s.name AS status_name, s.color AS status_color,
                o.deleted_at, u.name AS deleted_by_name, (e.deleted_at IS NOT NULL AND e.deleted_at = o.deleted_at) AS with_epic
           FROM outcomes o JOIN epics e ON e.id = o.epic_id
           LEFT JOIN statuses s ON s.id = o.status_id LEFT JOIN users u ON u.id = o.deleted_by
          WHERE o.deleted_at IS NOT NULL`,
      )
      .all() as (Omit<TrashItem, 'type' | 'purge_at' | 'days_left' | 'with_epic'> & { with_epic: number })[]
  ).map((o) => decorate({ ...o, type: 'outcome', with_epic: !!o.with_epic }));
  const epics = (
    db
      .prepare(
        `SELECT e.id, e.name AS title, s.name AS status_name, s.color AS status_color, e.deleted_at, u.name AS deleted_by_name,
                (SELECT COUNT(*) FROM outcomes o WHERE o.epic_id = e.id AND o.deleted_at = e.deleted_at) AS n
           FROM epics e LEFT JOIN statuses s ON s.id = e.status_id LEFT JOIN users u ON u.id = e.deleted_by
          WHERE e.deleted_at IS NOT NULL`,
      )
      .all() as (Omit<TrashItem, 'type' | 'detail' | 'purge_at' | 'days_left'> & { n: number })[]
  ).map(({ n, ...e }) => decorate({ ...e, type: 'epic', detail: n ? `com ${n} outcome(s)` : null }));
  return [...tasks, ...outcomes, ...epics].sort((a, b) => b.deleted_at.localeCompare(a.deleted_at));
}

// ---------------- Rotas (/api/trash) ----------------

const typeSchema = z.enum(['task', 'outcome', 'epic']);
const idSchema = z.coerce.number().int().positive();

export function trashRouter(db: DB) {
  const r = Router();

  r.get('/', (_req, res) => {
    purgeAllTrash(db, config.trashDays); // remove o que já passou do prazo antes de listar
    res.json({ days: config.trashDays, items: listAllTrash(db, config.trashDays) });
  });

  // Esvaziar a lixeira: somente administradores.
  r.delete('/', requireAdmin, (_req, res) => {
    res.json({ removed: purgeAllTrash(db) });
  });

  r.post('/:type/:id/restore', (req, res) => {
    const type = typeSchema.parse(req.params.type);
    const id = idSchema.parse(req.params.id);
    if (type === 'task') restoreTask(db, id);
    else if (type === 'outcome') restoreOutcome(db, id);
    else restoreEpic(db, id);
    res.status(204).end();
  });

  // Excluir definitivamente: somente administradores.
  r.delete('/:type/:id', requireAdmin, (req, res) => {
    purgeOne(db, typeSchema.parse(req.params.type), idSchema.parse(req.params.id));
    res.status(204).end();
  });

  return r;
}
