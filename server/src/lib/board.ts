/**
 * Ordem manual no quadro Kanban, compartilhada por tarefas, outcomes e épicos.
 * `board_position` (número real) define a ordem dentro de cada coluna (status): mover um card
 * para entre dois outros grava a média das posições vizinhas; se não sobrar espaço, a coluna é
 * renumerada em passos iguais.
 */
import { z } from 'zod';
import type { DB } from '../db/connection.js';
import { badRequest } from './http.js';

export type BoardTable = 'tasks' | 'outcomes' | 'epics';

export const POSITION_STEP = 1024;

/** Tarefas na lixeira não ocupam lugar no quadro. */
const scope = (table: BoardTable) => (table === 'tasks' ? ' AND deleted_at IS NULL' : '');

/** Posição para entrar no fim de uma coluna. */
export function endOfColumn(db: DB, table: BoardTable, statusId: number, exceptId = 0): number {
  const r = db
    .prepare(`SELECT MAX(board_position) AS m FROM ${table} WHERE status_id = ?${scope(table)} AND id <> ?`)
    .get(statusId, exceptId) as { m: number | null };
  return (r.m ?? 0) + POSITION_STEP;
}

/** Renumera uma coluna (passos iguais) quando não sobra espaço entre duas posições vizinhas. */
function renumberColumn(db: DB, table: BoardTable, statusId: number) {
  const ids = db
    .prepare(`SELECT id FROM ${table} WHERE status_id = ? ORDER BY board_position IS NULL, board_position, id`)
    .all(statusId) as { id: number }[];
  const upd = db.prepare(`UPDATE ${table} SET board_position = ? WHERE id = ?`);
  ids.forEach((r, i) => upd.run((i + 1) * POSITION_STEP, r.id));
}

/**
 * Posição para o item `id` ficar logo acima de `beforeId` na coluna `statusId`
 * (ou no fim, se `beforeId` for nulo). Chamar dentro de uma transação.
 */
export function positionBefore(db: DB, table: BoardTable, id: number, statusId: number, beforeId: number | null): number {
  const place = () => {
    if (beforeId == null) return endOfColumn(db, table, statusId, id);
    const before = db
      .prepare(`SELECT board_position AS p FROM ${table} WHERE id = ? AND status_id = ?${scope(table)}`)
      .get(beforeId, statusId) as { p: number | null } | undefined;
    if (!before || before.p == null) throw badRequest('O item de referência não está nessa coluna.');
    const prev = db
      .prepare(
        `SELECT MAX(board_position) AS p FROM ${table}
          WHERE status_id = ?${scope(table)} AND id <> ? AND board_position < ?`,
      )
      .get(statusId, id, before.p) as { p: number | null };
    const lower = prev.p ?? before.p - 2 * POSITION_STEP;
    return before.p - lower > 1e-6 ? (lower + before.p) / 2 : null;
  };
  let pos = place();
  if (pos == null) {
    renumberColumn(db, table, statusId);
    pos = place()!;
  }
  return pos;
}

/** Itens sem posição (gravados direto no banco: seed, importação) vão para o fim da coluna, na ordem dada. */
export function fillMissingPositions(db: DB, table: BoardTable, orderBy = 'id') {
  const rows = db
    .prepare(`SELECT id, status_id FROM ${table} WHERE board_position IS NULL AND status_id IS NOT NULL ORDER BY ${orderBy}`)
    .all() as { id: number; status_id: number }[];
  const upd = db.prepare(`UPDATE ${table} SET board_position = ? WHERE id = ?`);
  for (const r of rows) upd.run(endOfColumn(db, table, r.status_id, r.id), r.id);
  return rows.length;
}

/** Corpo de PATCH /:id/position: coluna de destino e o item que fica logo abaixo (vazio = fim). */
export const moveSchema = z.object({
  status_id: z.coerce.number().int().positive(),
  before_id: z.preprocess((v) => (v === '' || v === undefined ? null : v), z.coerce.number().int().positive().nullable()),
});

/** Move um épico ou outcome no quadro (coluna e lugar dentro dela). Sem histórico de status. */
export function moveItem(db: DB, table: 'epics' | 'outcomes', id: number, input: unknown, now: string) {
  const { status_id, before_id } = moveSchema.parse(input);
  if (before_id === id) throw badRequest('Posição inválida.');
  assertStatus(db, status_id);
  db.transaction(() => {
    const pos = positionBefore(db, table, id, status_id, before_id);
    db.prepare(`UPDATE ${table} SET status_id = ?, board_position = ?, updated_at = ? WHERE id = ?`).run(status_id, pos, now, id);
  })();
}

export function assertStatus(db: DB, id: number) {
  if (!db.prepare('SELECT id FROM statuses WHERE id = ?').get(id)) throw badRequest('Status inválido.');
}

/**
 * Coluna e posição ao salvar um épico/outcome pelo formulário: mantém o lugar se o status não mudou;
 * se mudou (ou é novo), entra no fim da nova coluna.
 */
export function placement(
  db: DB,
  table: 'epics' | 'outcomes',
  requested: number | null | undefined,
  current?: { id: number; status_id: number | null; board_position: number | null },
) {
  const statusId = requested ?? current?.status_id ?? defaultStatusId(db);
  if (requested != null) assertStatus(db, requested);
  if (current && current.status_id === statusId && current.board_position != null) {
    return { status_id: statusId, board_position: current.board_position };
  }
  return { status_id: statusId, board_position: endOfColumn(db, table, statusId, current?.id ?? 0) };
}

/** Status de quem não informou um: o padrão de novas tarefas (ou o primeiro ativo). */
export function defaultStatusId(db: DB): number {
  const r = db
    .prepare('SELECT id FROM statuses WHERE active = 1 ORDER BY is_default DESC, position, id LIMIT 1')
    .get() as { id: number } | undefined;
  if (!r) throw badRequest('Cadastre ao menos um status ativo (Administração → Status).');
  return r.id;
}

/**
 * Épicos e outcomes antigos tinham um status próprio (planejado, em andamento, concluído,
 * cancelado). Esta conversão os coloca na coluna equivalente do quadro das tarefas.
 */
export function legacyStatusToColumnSql(table: 'epics' | 'outcomes') {
  return `
UPDATE ${table} SET status_id = COALESCE(
  CASE status
    WHEN 'concluido' THEN (SELECT id FROM statuses WHERE is_completion_status = 1 ORDER BY active DESC, position LIMIT 1)
    WHEN 'cancelado' THEN (SELECT id FROM statuses WHERE is_cancel_status = 1 ORDER BY active DESC, position LIMIT 1)
    WHEN 'em_andamento' THEN (SELECT id FROM statuses WHERE is_start_status = 1 AND active = 1 ORDER BY position LIMIT 1)
  END,
  (SELECT id FROM statuses WHERE active = 1 ORDER BY is_default DESC, position, id LIMIT 1),
  (SELECT id FROM statuses ORDER BY position, id LIMIT 1)
) WHERE status_id IS NULL;
UPDATE ${table} SET board_position = ${POSITION_STEP} * (
  SELECT rn FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY status_id ORDER BY id) AS rn FROM ${table}) x
   WHERE x.id = ${table}.id
) WHERE board_position IS NULL;
`;
}
