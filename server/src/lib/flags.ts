/**
 * Flag (marcador de bloqueio) em tarefas e outcomes: sinaliza que o item depende de algo externo
 * (ex.: a área de negócio remover uma barreira, enviar um documento ou liberar um acesso).
 * Colocar e retirar a flag ficam registrados em flag_events (histórico e indicador do dashboard).
 */
import { z } from 'zod';
import type { DB } from '../db/connection.js';
import { badRequest, notFound } from './http.js';

export type FlagEntity = 'task' | 'outcome';
const TABLE: Record<FlagEntity, string> = { task: 'tasks', outcome: 'outcomes' };
const LABEL: Record<FlagEntity, string> = { task: 'Tarefa', outcome: 'Outcome' };

export const flagSchema = z.object({
  flagged: z.boolean(),
  /** Motivo ao colocar (ex.: "Aguardando acesso ao ERP"); observação ao retirar. */
  note: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(500).nullish()),
});

export function setFlag(db: DB, type: FlagEntity, id: number, input: unknown, userId: number, now: string) {
  const { flagged, note } = flagSchema.parse(input);
  const table = TABLE[type];
  const row = db.prepare(`SELECT flagged_at FROM ${table} WHERE id = ? AND deleted_at IS NULL`).get(id) as
    | { flagged_at: string | null }
    | undefined;
  if (!row) throw notFound(LABEL[type]);
  if (flagged && row.flagged_at) throw badRequest('Este item já está com flag.');
  if (!flagged && !row.flagged_at) throw badRequest('Este item não está com flag.');
  db.transaction(() => {
    if (flagged) {
      db.prepare(`UPDATE ${table} SET flagged_at = ?, flag_reason = ?, flagged_by = ?, updated_at = ? WHERE id = ?`).run(
        now, note ?? null, userId, now, id,
      );
    } else {
      db.prepare(`UPDATE ${table} SET flagged_at = NULL, flag_reason = NULL, flagged_by = NULL, updated_at = ? WHERE id = ?`).run(now, id);
    }
    db.prepare('INSERT INTO flag_events (entity_type, entity_id, action, note, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      type, id, flagged ? 'add' : 'remove', note ?? null, userId, now,
    );
  })();
}

/** Histórico de flags de um item, do mais antigo para o mais recente. */
export function flagEvents(db: DB, type: FlagEntity, id: number) {
  return db
    .prepare(
      `SELECT f.id, f.action, f.note, f.created_at, u.name AS user_name
         FROM flag_events f LEFT JOIN users u ON u.id = f.user_id
        WHERE f.entity_type = ? AND f.entity_id = ?
        ORDER BY f.created_at, f.id`,
    )
    .all(type, id);
}

/** Remove o histórico de flags de itens excluídos definitivamente. */
export function deleteFlagEvents(db: DB, type: FlagEntity, ids: number[]) {
  const del = db.prepare('DELETE FROM flag_events WHERE entity_type = ? AND entity_id = ?');
  for (const id of ids) del.run(type, id);
}
