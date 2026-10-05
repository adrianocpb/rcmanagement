import { z } from 'zod';
import { isValidDate } from './time.js';

const emptyToNull = (v: unknown) => (v === '' || v === undefined ? null : v);

/** Data de calendário opcional (YYYY-MM-DD); string vazia vira null. */
export const optionalDate = z.preprocess(
  emptyToNull,
  z.string().refine(isValidDate, 'data inválida (use AAAA-MM-DD)').nullable(),
);

/** Instante ISO opcional; string vazia vira null. */
export const optionalInstant = z.preprocess(
  emptyToNull,
  z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), 'data/hora inválida')
    .transform((s) => new Date(s).toISOString())
    .nullable(),
);

export const optionalText = z.preprocess(
  (v) => (typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : (v ?? null)),
  z.string().max(10_000).nullable(),
);

export const requiredText = (max = 200) => z.string().trim().min(1, 'obrigatório').max(max);

export const optionalId = z.preprocess(
  (v) => (v === '' || v === undefined || v === null ? null : Number(v)),
  z.number().int().positive().nullable(),
);

export const requiredId = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : Number(v)),
  z.number({ error: 'obrigatório' }).int().positive(),
);

export const optionalNumber = z.preprocess(
  (v) => (v === '' || v === undefined || v === null ? null : Number(v)),
  z.number().finite().nullable(),
);

export const bool = z.preprocess((v) => v === true || v === 1 || v === '1' || v === 'true', z.boolean());

export const PRIORITIES = ['baixa', 'media', 'alta', 'urgente'] as const;
export const PLAN_STATUSES = ['planejado', 'em_andamento', 'concluido', 'cancelado'] as const;

/**
 * Para atualizações parciais: mantém apenas as chaves enviadas no corpo da requisição.
 * (No Zod 4, `.partial()` ainda aplica `.default()`, o que sobrescreveria campos não enviados.)
 */
export function sentOnly<T extends object>(parsed: T, body: unknown): Partial<T> {
  const sent = body && typeof body === 'object' ? body : {};
  return Object.fromEntries(Object.entries(parsed).filter(([k]) => k in sent)) as Partial<T>;
}

/** Fator ICE opcional: inteiro de 1 a 10 (vazio = não estimado). */
export const iceValue = z.preprocess(
  (v) => (v === '' || v === undefined || v === null ? null : Number(v)),
  z.number().int('use um número inteiro').min(1, 'mínimo 1').max(10, 'máximo 10').nullable(),
);
