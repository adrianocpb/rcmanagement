/**
 * Tags das tarefas: rótulos livres (ex.: o fornecedor "Kynera") usados em filtros e indicadores.
 *  - Ao salvar uma tarefa com uma tag nova, ela é criada (nomes não diferenciam maiúsculas).
 *  - Cada tag recebe uma cor da paleta (a menos usada); o administrador pode renomear, trocar a cor
 *    ou excluir (a tag sai das tarefas).
 */
import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db/connection.js';
import { requireAdmin } from '../lib/auth.js';
import { badRequest, idParam, notFound } from '../lib/http.js';
import { nowIso } from '../lib/time.js';
import { OUTCOME_COLORS } from '../lib/colors.js';

export const MAX_TAGS_PER_TASK = 10;

const tagName = z
  .string()
  .transform((s) => s.trim().replace(/\s+/g, ' '))
  .pipe(z.string().min(1, 'tag vazia').max(40, 'tag com mais de 40 caracteres'));

/** Lista de nomes de tags de uma tarefa (sem repetições, ignorando maiúsculas). */
export const tagListSchema = z
  .array(tagName)
  .max(MAX_TAGS_PER_TASK, `no máximo ${MAX_TAGS_PER_TASK} tags por tarefa`)
  .transform((names) => names.filter((n, i) => names.findIndex((m) => m.toLowerCase() === n.toLowerCase()) === i));

export interface TagRow {
  id: number;
  name: string;
  color: string | null;
}

function nextColor(db: DB) {
  const used = new Map(
    (db.prepare('SELECT color, COUNT(*) AS n FROM tags WHERE color IS NOT NULL GROUP BY color').all() as { color: string; n: number }[]).map(
      (r) => [r.color, r.n],
    ),
  );
  return [...OUTCOME_COLORS].sort((a, b) => (used.get(a) ?? 0) - (used.get(b) ?? 0))[0];
}

/** Id da tag com esse nome (cria se não existir). */
export function ensureTag(db: DB, name: string): number {
  const found = db.prepare('SELECT id FROM tags WHERE name = ?').get(name) as { id: number } | undefined;
  if (found) return found.id;
  return Number(db.prepare('INSERT INTO tags (name, color, created_at) VALUES (?, ?, ?)').run(name, nextColor(db), nowIso()).lastInsertRowid);
}

/** Substitui as tags de uma tarefa. Chamar dentro de uma transação. */
export function setTaskTags(db: DB, taskId: number, names: string[]) {
  db.prepare('DELETE FROM task_tags WHERE task_id = ?').run(taskId);
  const ins = db.prepare('INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?)');
  for (const n of names) ins.run(taskId, ensureTag(db, n));
}

/** Subconsulta JSON com as tags de cada tarefa (para o SELECT das tarefas). */
export const TASK_TAGS_JSON = `(SELECT json_group_array(json_object('id', x.id, 'name', x.name, 'color', x.color))
    FROM (SELECT g.id, g.name, g.color FROM task_tags tt JOIN tags g ON g.id = tt.tag_id
           WHERE tt.task_id = t.id ORDER BY g.name COLLATE NOCASE) x)`;

export const parseTags = (json: unknown): TagRow[] => (typeof json === 'string' ? (JSON.parse(json) as TagRow[]) : []);

export function listTags(db: DB) {
  return db
    .prepare(
      `SELECT g.id, g.name, g.color, g.created_at,
              (SELECT COUNT(*) FROM task_tags tt JOIN tasks t ON t.id = tt.task_id
                WHERE tt.tag_id = g.id AND t.deleted_at IS NULL) AS tasks_count
         FROM tags g ORDER BY g.name COLLATE NOCASE`,
    )
    .all();
}

const updateSchema = z.object({
  name: tagName.optional(),
  color: z.enum(OUTCOME_COLORS).optional(),
});

export function tagsRouter(db: DB) {
  const r = Router();

  r.get('/', (_req, res) => {
    res.json(listTags(db));
  });

  r.post('/', (req, res) => {
    const { name } = z.object({ name: tagName }).parse(req.body);
    const id = ensureTag(db, name);
    res.status(201).json(db.prepare('SELECT id, name, color FROM tags WHERE id = ?').get(id));
  });

  // Renomear / trocar a cor: somente administradores.
  r.put('/:id', requireAdmin, (req, res) => {
    const id = idParam(req);
    const cur = db.prepare('SELECT * FROM tags WHERE id = ?').get(id) as TagRow | undefined;
    if (!cur) throw notFound('Tag');
    const d = updateSchema.parse(req.body);
    if (d.name) {
      const clash = db.prepare('SELECT id FROM tags WHERE name = ? AND id <> ?').get(d.name, id);
      if (clash) throw badRequest(`Já existe a tag "${d.name}".`);
    }
    db.prepare('UPDATE tags SET name = ?, color = ? WHERE id = ?').run(d.name ?? cur.name, d.color ?? cur.color, id);
    res.json(db.prepare('SELECT id, name, color FROM tags WHERE id = ?').get(id));
  });

  // Excluir: a tag sai de todas as tarefas. Somente administradores.
  r.delete('/:id', requireAdmin, (req, res) => {
    const info = db.prepare('DELETE FROM tags WHERE id = ?').run(idParam(req));
    if (info.changes === 0) throw notFound('Tag');
    res.status(204).end();
  });

  return r;
}
