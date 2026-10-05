import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodType } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Registro') => new HttpError(404, `${what} não encontrado.`);
export const badRequest = (msg: string) => new HttpError(400, msg);

export function parse<T>(schema: ZodType<T>, data: unknown): T {
  return schema.parse(data);
}

export function idParam(req: Request): number {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('ID inválido.');
  return id;
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    const first = err.issues[0];
    const field = first?.path.join('.');
    return res.status(400).json({
      error: field ? `Campo "${field}": ${first.message}` : (first?.message ?? 'Dados inválidos.'),
      issues: err.issues,
    });
  }
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  // Erros do SQLite (node:sqlite): a mensagem traz o tipo da restrição violada.
  const message = (err as { message?: string })?.message ?? '';
  if (message.includes('UNIQUE constraint failed')) {
    return res.status(409).json({ error: 'Já existe um registro com esse valor.' });
  }
  if (/(FOREIGN KEY|CHECK|NOT NULL) constraint failed/.test(message)) {
    return res.status(400).json({ error: 'Referência inválida ou restrição violada.' });
  }
  console.error(err);
  return res.status(500).json({ error: 'Erro interno.' });
}
