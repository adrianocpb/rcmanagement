/**
 * Comentários nas tarefas: texto (links http/https viram clicáveis no frontend) e imagens.
 *  - Equipe (admin e usuário) lê e comenta; o autor edita e exclui o próprio comentário;
 *    o administrador exclui qualquer um.
 *  - Imagens: até MAX_IMAGES por comentário, somando no máximo MAX_TOTAL_BYTES; gravadas em
 *    UPLOADS_DIR/tasks/<id da tarefa>/ (removidas junto com a tarefa ao esvaziar a lixeira).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { config } from '../config.js';
import type { DB } from '../db/connection.js';
import type { AuthUser } from '../lib/auth.js';
import { badRequest, HttpError, notFound } from '../lib/http.js';
import { nowIso } from '../lib/time.js';

export const MAX_IMAGES = 5;
export const MAX_TOTAL_BYTES = 10 * 1024 * 1024;

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

type UploadedFile = { originalname: string; size: number; buffer: Buffer };
type CommentRow = { id: number; task_id: number; author_id: number; body: string; created_at: string; updated_at: string };
type ImageRow = { id: number; comment_id: number; filename: string; stored_name: string; mime_type: string; size: number };

const bodySchema = z.object({ body: z.string().trim().max(10_000).default('') });

/** Pasta das imagens de uma tarefa. */
export function taskUploadsDir(taskId: number) {
  return path.join(config.uploadsDir, 'tasks', String(taskId));
}

/** Remove do disco as imagens de tarefas excluídas definitivamente. */
export function removeTaskUploads(taskIds: number[]) {
  for (const id of taskIds) fs.rmSync(taskUploadsDir(id), { recursive: true, force: true });
}

function cleanFilename(name: string) {
  const base = path.basename(name).replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '_').trim();
  return (base || 'imagem').slice(0, 150);
}

function validateImages(files: UploadedFile[]) {
  if (files.length > MAX_IMAGES) throw badRequest(`Máximo de ${MAX_IMAGES} imagens por comentário.`);
  const total = files.reduce((s, f) => s + f.size, 0);
  if (total > MAX_TOTAL_BYTES) {
    throw badRequest(`As imagens somam ${(total / 1024 / 1024).toFixed(1)} MB; o limite é 10 MB por comentário.`);
  }
  for (const f of files) {
    if (!IMAGE_TYPES[path.extname(f.originalname).toLowerCase()]) {
      throw badRequest(`Formato não permitido: "${cleanFilename(f.originalname)}". Use PNG, JPG, GIF ou WEBP.`);
    }
  }
}

function assertTask(db: DB, taskId: number) {
  const t = db.prepare('SELECT id FROM tasks WHERE id = ? AND deleted_at IS NULL').get(taskId);
  if (!t) throw notFound('Tarefa');
}

function loadComment(db: DB, taskId: number, commentId: number): CommentRow {
  const c = db.prepare('SELECT * FROM task_comments WHERE id = ? AND task_id = ?').get(commentId, taskId) as CommentRow | undefined;
  if (!c) throw notFound('Comentário');
  return c;
}

export function listComments(db: DB, taskId: number, user: AuthUser) {
  assertTask(db, taskId);
  const comments = db
    .prepare(
      `SELECT c.*, u.name AS author_name FROM task_comments c JOIN users u ON u.id = c.author_id
        WHERE c.task_id = ? ORDER BY c.created_at, c.id`,
    )
    .all(taskId) as (CommentRow & { author_name: string })[];
  const images = db
    .prepare(
      `SELECT i.* FROM task_comment_images i JOIN task_comments c ON c.id = i.comment_id
        WHERE c.task_id = ? ORDER BY i.id`,
    )
    .all(taskId) as ImageRow[];
  return comments.map((c) => ({
    ...c,
    edited: c.updated_at !== c.created_at,
    can_edit: c.author_id === user.id,
    can_delete: c.author_id === user.id || user.role === 'admin',
    images: images
      .filter((i) => i.comment_id === c.id)
      .map((i) => ({
        id: i.id,
        filename: i.filename,
        size: i.size,
        url: `/api/tasks/${taskId}/comments/${c.id}/images/${i.id}`,
      })),
  }));
}

export function createComment(db: DB, taskId: number, input: unknown, files: UploadedFile[], user: AuthUser) {
  assertTask(db, taskId);
  const { body } = bodySchema.parse(input);
  if (!body && files.length === 0) throw badRequest('Escreva um comentário ou anexe uma imagem.');
  validateImages(files);
  const dir = taskUploadsDir(taskId);
  const written: string[] = [];
  try {
    db.transaction(() => {
      const now = nowIso();
      const commentId = Number(
        db
          .prepare('INSERT INTO task_comments (task_id, author_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
          .run(taskId, user.id, body, now, now).lastInsertRowid,
      );
      if (files.length) fs.mkdirSync(dir, { recursive: true });
      const insert = db.prepare(
        `INSERT INTO task_comment_images (comment_id, filename, stored_name, mime_type, size, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const f of files) {
        const ext = path.extname(f.originalname).toLowerCase();
        const stored = `${crypto.randomUUID()}${ext}`;
        fs.writeFileSync(path.join(dir, stored), f.buffer);
        written.push(path.join(dir, stored));
        insert.run(commentId, cleanFilename(f.originalname), stored, IMAGE_TYPES[ext], f.size, now);
      }
    })();
  } catch (err) {
    for (const w of written) fs.rmSync(w, { force: true });
    throw err;
  }
  return listComments(db, taskId, user).at(-1);
}

export function updateComment(db: DB, taskId: number, commentId: number, input: unknown, user: AuthUser) {
  const c = loadComment(db, taskId, commentId);
  if (c.author_id !== user.id) throw new HttpError(403, 'Somente quem escreveu pode editar o comentário.');
  const { body } = bodySchema.parse(input);
  const hasImages = db.prepare('SELECT 1 FROM task_comment_images WHERE comment_id = ? LIMIT 1').get(commentId);
  if (!body && !hasImages) throw badRequest('O comentário não pode ficar vazio.');
  db.prepare('UPDATE task_comments SET body = ?, updated_at = ? WHERE id = ?').run(body, nowIso(), commentId);
  return listComments(db, taskId, user).find((x) => x.id === commentId);
}

export function deleteComment(db: DB, taskId: number, commentId: number, user: AuthUser) {
  const c = loadComment(db, taskId, commentId);
  if (c.author_id !== user.id && user.role !== 'admin') {
    throw new HttpError(403, 'Somente quem escreveu ou um administrador pode excluir o comentário.');
  }
  const images = db.prepare('SELECT stored_name FROM task_comment_images WHERE comment_id = ?').all(commentId) as {
    stored_name: string;
  }[];
  db.prepare('DELETE FROM task_comments WHERE id = ?').run(commentId);
  for (const i of images) fs.rmSync(path.join(taskUploadsDir(taskId), i.stored_name), { force: true });
}

function imageFile(db: DB, taskId: number, commentId: number, imageId: number) {
  assertTask(db, taskId);
  loadComment(db, taskId, commentId);
  const i = db
    .prepare('SELECT * FROM task_comment_images WHERE id = ? AND comment_id = ?')
    .get(imageId, commentId) as ImageRow | undefined;
  if (!i) throw notFound('Imagem');
  const full = path.join(taskUploadsDir(taskId), i.stored_name);
  if (!fs.existsSync(full)) throw notFound('Arquivo da imagem');
  return { path: full, mime: i.mime_type, filename: i.filename };
}

// ---------------- Rotas (/api/tasks/:id/comments) ----------------

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: MAX_IMAGES, fileSize: MAX_TOTAL_BYTES, fields: 5, fieldSize: 20_000 },
}).array('images', MAX_IMAGES);

function receiveImages(req: Request, res: Response, next: NextFunction) {
  upload(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const msg =
        err.code === 'LIMIT_FILE_SIZE'
          ? 'As imagens somam mais de 10 MB; o limite é 10 MB por comentário.'
          : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE'
            ? `Máximo de ${MAX_IMAGES} imagens por comentário.`
            : 'Envio de imagens inválido.';
      return next(badRequest(msg));
    }
    next(err);
  });
}

/** O multer entrega os nomes em latin1; converte para UTF-8 (acentos em nomes de arquivo). */
function filesOf(req: Request): UploadedFile[] {
  return ((req.files as Express.Multer.File[] | undefined) ?? []).map((f) => ({
    originalname: Buffer.from(f.originalname, 'latin1').toString('utf8'),
    size: f.size,
    buffer: f.buffer,
  }));
}

const num = (v: unknown) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw badRequest('ID inválido.');
  return n;
};

/** Id da tarefa vem da rota-mãe (/tasks/:id/comments). */
const taskIdOf = (req: Request) => num((req.params as Record<string, string>).id);

export function commentsRouter(db: DB) {
  const r = Router({ mergeParams: true });
  r.get('/', (req, res) => res.json(listComments(db, taskIdOf(req), req.user!)));
  r.post('/', receiveImages, (req, res) => {
    res.status(201).json(createComment(db, taskIdOf(req), req.body ?? {}, filesOf(req), req.user!));
  });
  r.put('/:cid', (req, res) => res.json(updateComment(db, taskIdOf(req), num(req.params.cid), req.body, req.user!)));
  r.delete('/:cid', (req, res) => {
    deleteComment(db, taskIdOf(req), num(req.params.cid), req.user!);
    res.status(204).end();
  });
  r.get('/:cid/images/:iid', (req, res, next) => {
    const file = imageFile(db, taskIdOf(req), num(req.params.cid), num(req.params.iid));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
    res.type(file.mime);
    res.sendFile(file.path, (err) => err && next(err));
  });
  return r;
}
