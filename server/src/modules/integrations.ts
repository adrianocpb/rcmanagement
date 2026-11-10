/**
 * Tokens de integração: permitem que um sistema externo (ex.: o conector MCP do Claude) use o
 * sistema sem a tela de login. Cada token age em nome de um usuário da equipe — tudo o que for
 * criado ou alterado com ele fica registrado como feito por esse usuário.
 *  - O token é mostrado uma única vez, na criação; o banco guarda só o hash SHA-256.
 *  - Somente administradores criam, listam e revogam tokens.
 */
import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db/connection.js';
import { requireAdmin, type AuthUser } from '../lib/auth.js';
import { badRequest, idParam, notFound } from '../lib/http.js';
import { nowIso } from '../lib/time.js';
import { requiredText } from '../lib/validation.js';

const TOKEN_PREFIX = 'rcm_';
const hash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

const createSchema = z.object({
  name: requiredText(80),
  user_id: z.coerce.number().int().positive(),
});

export function createToken(db: DB, input: unknown, createdBy: number) {
  const d = createSchema.parse(input);
  const user = db.prepare('SELECT id, role, active FROM users WHERE id = ?').get(d.user_id) as
    | { role: string; active: number }
    | undefined;
  if (!user || !user.active) throw badRequest('Usuário inválido ou inativo.');
  if (user.role === 'requester') throw badRequest('O token precisa agir em nome de alguém da equipe (administrador ou usuário).');
  const token = TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
  const info = db
    .prepare('INSERT INTO api_tokens (name, token_hash, token_hint, user_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(d.name, hash(token), token.slice(-4), d.user_id, createdBy, nowIso());
  return { ...getToken(db, Number(info.lastInsertRowid)), token };
}

const SELECT = `SELECT t.id, t.name, t.token_hint, t.user_id, u.name AS user_name, c.name AS created_by_name,
                       t.created_at, t.last_used_at, t.revoked_at
                  FROM api_tokens t JOIN users u ON u.id = t.user_id LEFT JOIN users c ON c.id = t.created_by`;

function getToken(db: DB, id: number) {
  const row = db.prepare(`${SELECT} WHERE t.id = ?`).get(id);
  if (!row) throw notFound('Token');
  return row as Record<string, unknown>;
}

export function listTokens(db: DB) {
  return db.prepare(`${SELECT} ORDER BY t.revoked_at IS NOT NULL, t.created_at DESC`).all();
}

export function revokeToken(db: DB, id: number) {
  const info = db.prepare('UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(nowIso(), id);
  if (info.changes === 0) throw notFound('Token ativo');
}

/** Usuário dono de um token válido (não revogado, usuário ativo e da equipe), ou null. */
export function userFromToken(db: DB, authorization: string | undefined): AuthUser | null {
  const m = /^Bearer\s+(\S+)$/i.exec(authorization ?? '');
  if (!m || !m[1].startsWith(TOKEN_PREFIX)) return null;
  const row = db
    .prepare(
      `SELECT t.id AS token_id, t.last_used_at, u.id, u.name, u.email, u.role, u.sector_id
         FROM api_tokens t JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = ? AND t.revoked_at IS NULL AND u.active = 1 AND u.role <> 'requester'`,
    )
    .get(hash(m[1])) as (AuthUser & { token_id: number; last_used_at: string | null }) | undefined;
  if (!row) return null;
  // Registra o uso (no máximo a cada minuto, para não gravar a cada chamada).
  const now = new Date();
  if (!row.last_used_at || now.getTime() - new Date(row.last_used_at).getTime() > 60_000) {
    db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(now.toISOString(), row.token_id);
  }
  const { token_id: _t, last_used_at: _l, ...user } = row;
  return user;
}

export function integrationsRouter(db: DB) {
  const r = Router();
  r.use(requireAdmin);
  r.get('/tokens', (_req, res) => {
    res.json(listTokens(db));
  });
  r.post('/tokens', (req, res) => {
    res.status(201).json(createToken(db, req.body, req.user!.id));
  });
  r.delete('/tokens/:id', (req, res) => {
    revokeToken(db, idParam(req));
    res.status(204).end();
  });
  return r;
}
