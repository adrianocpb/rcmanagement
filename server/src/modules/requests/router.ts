import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { DB } from '../../db/connection.js';
import { requireAdmin } from '../../lib/auth.js';
import { badRequest, HttpError, idParam } from '../../lib/http.js';
import {
  attachmentFile,
  convertRequest,
  countByStatus,
  createRequest,
  decideRequest,
  getRequest,
  listAll,
  listMine,
  MAX_FILES,
  MAX_TOTAL_BYTES,
  updateRequest,
  type UploadedFile,
} from './service.js';

/** Recebe os anexos em memória; os limites finos (total por solicitação, tipos) ficam no service. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: MAX_FILES, fileSize: MAX_TOTAL_BYTES, fields: 20, fieldSize: 20_000 },
}).array('files', MAX_FILES);

function receiveFiles(req: Request, res: Response, next: NextFunction) {
  upload(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const msg =
        err.code === 'LIMIT_FILE_SIZE'
          ? 'Os anexos somam mais de 10 MB; o limite é 10 MB por solicitação.'
          : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE'
            ? `Máximo de ${MAX_FILES} anexos por solicitação.`
            : 'Envio de arquivos inválido.';
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

const statusQuery = z.preprocess(
  (v) => (v === '' ? undefined : v),
  z.enum(['aguardando', 'info', 'aprovada', 'recusada']).optional(),
);

function attachmentIdsToRemove(v: unknown): number[] {
  const raw = Array.isArray(v) ? v : typeof v === 'string' && v.trim() ? v.split(',') : [];
  return raw.map(Number).filter((n) => Number.isInteger(n) && n > 0);
}

export function requestsRouter(db: DB) {
  const r = Router();

  r.get('/mine', (req, res) => res.json(listMine(db, req.user!)));

  r.get('/', requireAdmin, (req, res) => res.json(listAll(db, statusQuery.parse(req.query.status))));

  r.get('/counts', requireAdmin, (_req, res) => res.json(countByStatus(db)));

  r.get('/:id', (req, res) => res.json(getRequest(db, idParam(req), req.user!)));

  r.post('/', receiveFiles, (req, res) => {
    res.status(201).json(createRequest(db, req.body, filesOf(req), req.user!));
  });

  r.put('/:id', receiveFiles, (req, res) => {
    const { remove_attachment_ids, ...body } = req.body ?? {};
    res.json(updateRequest(db, idParam(req), body, filesOf(req), attachmentIdsToRemove(remove_attachment_ids), req.user!));
  });

  r.post('/:id/decision', requireAdmin, (req, res) => res.json(decideRequest(db, idParam(req), req.body, req.user!)));

  r.post('/:id/convert', requireAdmin, (req, res) => {
    res.status(201).json(convertRequest(db, idParam(req), req.body, req.user!));
  });

  r.get('/:id/attachments/:aid', (req, res, next) => {
    const aid = Number(req.params.aid);
    if (!Number.isInteger(aid) || aid <= 0) throw new HttpError(400, 'ID inválido.');
    const file = attachmentFile(db, idParam(req), aid, req.user!);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.type(file.mime);
    res.attachment(file.filename);
    if (file.inline) res.setHeader('Content-Disposition', res.getHeader('Content-Disposition')!.toString().replace(/^attachment/, 'inline'));
    res.sendFile(file.path, (err) => err && next(err));
  });

  return r;
}
