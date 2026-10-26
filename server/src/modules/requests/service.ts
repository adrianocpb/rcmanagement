/**
 * Solicitações de melhoria: porta de entrada para ideias de qualquer colaborador.
 *
 * Fluxo: aguardando → (info ⇄ aguardando) → aprovada (vira Tarefa, Outcome ou Épico) | recusada.
 *  - Qualquer perfil cria solicitações e vê as próprias.
 *  - Somente administradores analisam (pedem informação, recusam ou aprovam/convertem).
 *  - O solicitante edita enquanto a solicitação está "aguardando" ou "info" (ao reenviar volta a "aguardando").
 *  - Anexos: até MAX_FILES arquivos, somando no máximo MAX_TOTAL_BYTES por solicitação.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { config } from '../../config.js';
import type { DB } from '../../db/connection.js';
import type { AuthUser } from '../../lib/auth.js';
import { HttpError, badRequest, notFound } from '../../lib/http.js';
import { nowIso, todayLocal } from '../../lib/time.js';
import { optionalId, optionalText, requiredText } from '../../lib/validation.js';
import { createEpic } from '../epics.js';
import { createOutcome } from '../outcomes.js';
import { deadlineState } from '../tasks/rules.js';
import { createTask } from '../tasks/service.js';

export const MAX_FILES = 5;
export const MAX_TOTAL_BYTES = 10 * 1024 * 1024; // 10 MB somando todos os anexos

/** Tipos aceitos (extensão → tipo MIME servido). SVG/HTML ficam de fora por segurança. */
export const ALLOWED_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
};
/** Tipos exibidos no navegador; os demais são baixados. */
const INLINE = /^(image\/(png|jpeg|gif|webp)|application\/pdf|video\/(mp4|webm|quicktime))$/;

export type RequestStatus = 'aguardando' | 'info' | 'aprovada' | 'recusada';
export type ConvertType = 'task' | 'outcome' | 'epic';

export interface UploadedFile {
  originalname: string;
  size: number;
  buffer: Buffer;
}

const linkSchema = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z
    .string()
    .trim()
    .max(2000)
    .refine((s) => /^https?:\/\/\S+$/i.test(s), 'informe um link começando com http:// ou https://')
    .nullable()
    .optional(),
);

export const requestSchema = z.object({
  title: requiredText(200),
  description: requiredText(10_000),
  benefit: requiredText(5_000),
  success_indicator: optionalText,
  link: linkSchema,
  sector_id: optionalId,
});

const SELECT = `
  SELECT r.*, u.name AS requester_name, sec.name AS sector_name, d.name AS decided_by_name,
         (SELECT COUNT(*) FROM request_attachments a WHERE a.request_id = r.id) AS attachments_count
    FROM requests r
    JOIN users u ON u.id = r.requester_id
    LEFT JOIN sectors sec ON sec.id = r.sector_id
    LEFT JOIN users d ON d.id = r.decided_by`;

type RequestRow = {
  id: number;
  requester_id: number;
  status: RequestStatus;
  converted_type: ConvertType | null;
  converted_id: number | null;
} & Record<string, unknown>;

type AttachmentRow = {
  id: number;
  request_id: number;
  filename: string;
  stored_name: string;
  mime_type: string;
  size: number;
  created_at: string;
};

// ---------------- Anexos ----------------

function cleanFilename(name: string) {
  const base = path.basename(name).replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '_').trim();
  return (base || 'arquivo').slice(0, 150);
}

/** Valida tipo, quantidade e tamanho total (somando os anexos que já existem). */
export function validateFiles(files: UploadedFile[], existing: { count: number; bytes: number }) {
  if (existing.count + files.length > MAX_FILES) {
    throw badRequest(`Máximo de ${MAX_FILES} anexos por solicitação.`);
  }
  const total = existing.bytes + files.reduce((s, f) => s + f.size, 0);
  if (total > MAX_TOTAL_BYTES) {
    throw badRequest(`Os anexos somam ${(total / 1024 / 1024).toFixed(1)} MB; o limite é 10 MB por solicitação.`);
  }
  for (const f of files) {
    const ext = path.extname(f.originalname).toLowerCase();
    if (!ALLOWED_TYPES[ext]) {
      throw badRequest(
        `Tipo de arquivo não permitido: "${cleanFilename(f.originalname)}". Use imagens, PDF, Office, CSV/TXT ou vídeos MP4/WEBM/MOV.`,
      );
    }
  }
}

function requestDir(requestId: number) {
  return path.join(config.uploadsDir, String(requestId));
}

/** Grava os arquivos no disco e registra no banco. Em caso de erro, remove o que já foi gravado. */
function saveFiles(db: DB, requestId: number, files: UploadedFile[]) {
  const written: string[] = [];
  try {
    if (files.length) fs.mkdirSync(requestDir(requestId), { recursive: true });
    const insert = db.prepare(
      `INSERT INTO request_attachments (request_id, filename, stored_name, mime_type, size, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const f of files) {
      const ext = path.extname(f.originalname).toLowerCase();
      const stored = `${crypto.randomUUID()}${ext}`;
      const full = path.join(requestDir(requestId), stored);
      fs.writeFileSync(full, f.buffer);
      written.push(full);
      insert.run(requestId, cleanFilename(f.originalname), stored, ALLOWED_TYPES[ext], f.size, nowIso());
    }
  } catch (err) {
    for (const w of written) fs.rmSync(w, { force: true });
    throw err;
  }
}

function attachmentsOf(db: DB, requestId: number) {
  return (
    db
      .prepare('SELECT id, filename, mime_type, size, created_at FROM request_attachments WHERE request_id = ? ORDER BY id')
      .all(requestId) as Omit<AttachmentRow, 'stored_name' | 'request_id'>[]
  ).map((a) => ({ ...a, url: `/api/requests/${requestId}/attachments/${a.id}` }));
}

function usage(db: DB, requestId: number) {
  const r = db
    .prepare('SELECT COUNT(*) AS count, COALESCE(SUM(size), 0) AS bytes FROM request_attachments WHERE request_id = ?')
    .get(requestId) as { count: number; bytes: number };
  return { count: Number(r.count), bytes: Number(r.bytes) };
}

// ---------------- Acesso ----------------

function load(db: DB, id: number): RequestRow {
  const row = db.prepare(`${SELECT} WHERE r.id = ?`).get(id) as RequestRow | undefined;
  if (!row) throw notFound('Solicitação');
  return row;
}

/** Admin vê tudo; o solicitante vê as suas; a equipe vê as aprovadas (origem de itens que ela trabalha). */
function canView(user: AuthUser, row: RequestRow) {
  return user.role === 'admin' || row.requester_id === user.id || (user.role === 'user' && row.status === 'aprovada');
}

function assertAdmin(user: AuthUser) {
  if (user.role !== 'admin') throw new HttpError(403, 'Somente administradores analisam solicitações.');
}

// ---------------- Andamento do item gerado ----------------

function convertedProgress(db: DB, type: ConvertType | null, id: number | null) {
  if (!type || !id) return null;
  if (type === 'task') {
    const t = db
      .prepare(
        `SELECT t.id, t.title, t.planned_end_date, t.completed_at, t.deleted_at, s.name AS status_name, s.color AS status_color,
                s.is_completion_status AS is_completed, s.is_cancel_status AS is_canceled, u.name AS assignee_name
           FROM tasks t JOIN statuses s ON s.id = t.status_id JOIN users u ON u.id = t.assignee_id WHERE t.id = ?`,
      )
      .get(id) as Record<string, unknown> | undefined;
    if (!t) return { type, id, removed: true };
    return {
      type,
      id,
      title: t.title,
      removed: !!t.deleted_at,
      status_name: t.status_name,
      status_color: t.status_color,
      assignee_name: t.assignee_name,
      planned_end_date: t.planned_end_date,
      deadline_state: deadlineState(
        { planned_end_date: t.planned_end_date as string | null, completed_at: t.completed_at as string | null },
        !!t.is_completed,
        todayLocal(),
        !!t.is_canceled,
      ),
    };
  }
  const table = type === 'outcome' ? 'outcomes' : 'epics';
  const key = type === 'outcome' ? 'outcome_id' : 'epic_id';
  const row = db
    .prepare(
      `SELECT x.id, x.name AS title, x.status AS plan_status,
              (SELECT COUNT(*) FROM tasks t JOIN statuses s ON s.id = t.status_id
                WHERE t.${key} = x.id AND t.deleted_at IS NULL AND s.is_cancel_status = 0) AS tasks_count,
              (SELECT COUNT(*) FROM tasks t JOIN statuses s ON s.id = t.status_id
                WHERE t.${key} = x.id AND t.deleted_at IS NULL AND s.is_completion_status = 1) AS tasks_done
         FROM ${table} x WHERE x.id = ?`,
    )
    .get(id) as Record<string, unknown> | undefined;
  if (!row) return { type, id, removed: true };
  return { type, id, removed: false, ...row };
}

// ---------------- Operações ----------------

export function createRequest(db: DB, input: unknown, files: UploadedFile[], user: AuthUser) {
  const d = requestSchema.parse(input);
  validateFiles(files, { count: 0, bytes: 0 });
  const now = nowIso();
  const id = db.transaction(() => {
    const newId = Number(
      db
        .prepare(
          `INSERT INTO requests (title, description, benefit, success_indicator, link, sector_id, requester_id,
                                 status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'aguardando', ?, ?)`,
        )
        .run(d.title, d.description, d.benefit, d.success_indicator, d.link ?? null, d.sector_id ?? user.sector_id, user.id, now, now)
        .lastInsertRowid,
    );
    saveFiles(db, newId, files);
    return newId;
  })();
  return getRequest(db, id, user);
}

export function getRequest(db: DB, id: number, user: AuthUser) {
  const row = load(db, id);
  if (!canView(user, row)) throw notFound('Solicitação');
  return {
    ...row,
    attachments: attachmentsOf(db, id),
    converted: convertedProgress(db, row.converted_type, row.converted_id),
    can_edit: row.requester_id === user.id && (row.status === 'aguardando' || row.status === 'info'),
  };
}

export function listMine(db: DB, user: AuthUser) {
  const rows = db.prepare(`${SELECT} WHERE r.requester_id = ? ORDER BY r.created_at DESC`).all(user.id) as RequestRow[];
  return rows.map((r) => ({ ...r, converted: convertedProgress(db, r.converted_type, r.converted_id) }));
}

export function listAll(db: DB, status?: RequestStatus) {
  const rows = (
    status
      ? db.prepare(`${SELECT} WHERE r.status = ? ORDER BY r.created_at ${status === 'aguardando' ? 'ASC' : 'DESC'}`).all(status)
      : db.prepare(`${SELECT} ORDER BY r.created_at DESC`).all()
  ) as RequestRow[];
  return rows.map((r) => ({ ...r, converted: convertedProgress(db, r.converted_type, r.converted_id) }));
}

export function countByStatus(db: DB) {
  const counts: Record<RequestStatus, number> = { aguardando: 0, info: 0, aprovada: 0, recusada: 0 };
  for (const r of db.prepare('SELECT status, COUNT(*) AS n FROM requests GROUP BY status').all() as { status: RequestStatus; n: number }[]) {
    counts[r.status] = Number(r.n);
  }
  return counts;
}

/** Edição pelo solicitante (texto, novos anexos e remoção de anexos). Reenviar volta para "aguardando". */
export function updateRequest(
  db: DB,
  id: number,
  input: unknown,
  files: UploadedFile[],
  removeIds: number[],
  user: AuthUser,
) {
  const row = load(db, id);
  if (row.requester_id !== user.id) throw new HttpError(403, 'Somente quem solicitou pode editar.');
  if (row.status !== 'aguardando' && row.status !== 'info') {
    throw badRequest('A solicitação já foi analisada e não pode mais ser editada.');
  }
  const d = requestSchema.parse(input);
  const toRemove = (
    db.prepare('SELECT * FROM request_attachments WHERE request_id = ?').all(id) as AttachmentRow[]
  ).filter((a) => removeIds.includes(a.id));
  const current = usage(db, id);
  validateFiles(files, {
    count: current.count - toRemove.length,
    bytes: current.bytes - toRemove.reduce((s, a) => s + a.size, 0),
  });
  db.transaction(() => {
    db.prepare(
      `UPDATE requests SET title = ?, description = ?, benefit = ?, success_indicator = ?, link = ?, sector_id = ?,
                           status = 'aguardando', updated_at = ?
        WHERE id = ?`,
    ).run(d.title, d.description, d.benefit, d.success_indicator, d.link ?? null, d.sector_id ?? row.sector_id, nowIso(), id);
    for (const a of toRemove) db.prepare('DELETE FROM request_attachments WHERE id = ?').run(a.id);
    saveFiles(db, id, files);
  })();
  for (const a of toRemove) fs.rmSync(path.join(requestDir(id), a.stored_name), { force: true });
  return getRequest(db, id, user);
}

/** Pedir mais informação ou recusar (motivo obrigatório). */
export function decideRequest(db: DB, id: number, input: unknown, user: AuthUser) {
  assertAdmin(user);
  const { action, note } = z
    .object({ action: z.enum(['info', 'reject']), note: requiredText(5_000) })
    .parse(input);
  const row = load(db, id);
  if (row.status !== 'aguardando' && !(row.status === 'info' && action === 'reject')) {
    throw badRequest('Esta solicitação não está aguardando análise.');
  }
  db.prepare(
    'UPDATE requests SET status = ?, decision_note = ?, decided_by = ?, decided_at = ?, updated_at = ? WHERE id = ?',
  ).run(action === 'info' ? 'info' : 'recusada', note, user.id, nowIso(), nowIso(), id);
  return getRequest(db, id, user);
}

/** Aprova convertendo em Tarefa, Outcome ou Épico (com os dados revisados pelo administrador). */
export function convertRequest(db: DB, id: number, input: unknown, user: AuthUser) {
  assertAdmin(user);
  const { type, data } = z
    .object({ type: z.enum(['task', 'outcome', 'epic']), data: z.record(z.string(), z.unknown()) })
    .parse(input);
  const row = load(db, id);
  if (row.status !== 'aguardando' && row.status !== 'info') {
    throw badRequest('Esta solicitação já foi analisada.');
  }
  return db.transaction(() => {
    let created: { id: number };
    if (type === 'task') {
      created = createTask(
        db,
        { ...data, requester_id: data.requester_id || row.requester_id, sector_id: data.sector_id || row.sector_id },
        user.id,
      );
    } else if (type === 'outcome') {
      created = createOutcome(db, data);
    } else {
      created = createEpic(db, data);
    }
    db.prepare(
      `UPDATE requests SET status = 'aprovada', decision_note = NULL, decided_by = ?, decided_at = ?,
                           converted_type = ?, converted_id = ?, updated_at = ?
        WHERE id = ?`,
    ).run(user.id, nowIso(), type, created.id, nowIso(), id);
    return { request: getRequest(db, id, user), created: { type, id: created.id } };
  })();
}

/** Solicitação de origem de um item (exibida no detalhe da tarefa, outcome ou épico). */
export function originOf(db: DB, type: ConvertType, id: number) {
  const r = db
    .prepare(
      `SELECT r.id, r.title, r.benefit, r.success_indicator, r.link, r.created_at, u.name AS requester_name
         FROM requests r JOIN users u ON u.id = r.requester_id
        WHERE r.converted_type = ? AND r.converted_id = ?`,
    )
    .get(type, id) as ({ id: number } & Record<string, unknown>) | undefined;
  return r ? { ...r, attachments: attachmentsOf(db, r.id) } : null;
}

/** Arquivo de um anexo, com verificação de acesso. */
export function attachmentFile(db: DB, requestId: number, attachmentId: number, user: AuthUser) {
  const row = load(db, requestId);
  if (!canView(user, row)) throw notFound('Anexo');
  const a = db
    .prepare('SELECT * FROM request_attachments WHERE id = ? AND request_id = ?')
    .get(attachmentId, requestId) as AttachmentRow | undefined;
  if (!a) throw notFound('Anexo');
  const full = path.join(requestDir(requestId), a.stored_name);
  if (!fs.existsSync(full)) throw notFound('Arquivo do anexo');
  return { path: full, filename: a.filename, mime: a.mime_type, inline: INLINE.test(a.mime_type) };
}
