import { config } from '../config.js';

/**
 * Convenções de data/hora (centralizadas aqui):
 *  - Instantes (criação, início real, conclusão real, histórico) são gravados em UTC, ISO 8601
 *    (ex.: "2026-10-02T13:45:00.000Z").
 *  - Datas de calendário (início/conclusão previstos, datas de épicos/outcomes) são gravadas como
 *    "YYYY-MM-DD", sem horário, e interpretadas no fuso da aplicação (config.timezone).
 *  - "Hoje", atraso e os limites de período do dashboard são sempre calculados no fuso da aplicação,
 *    nunca no fuso do servidor ou do navegador.
 */

const DAY_MS = 86_400_000;

export function nowIso(): string {
  return new Date().toISOString();
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string) {
  let f = dateFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    dateFormatters.set(tz, f);
  }
  return f;
}

function zonedParts(date: Date, tz: string) {
  const p: Record<string, string> = {};
  for (const part of partsFormatter(tz).formatToParts(date)) p[part.type] = part.value;
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
  };
}

/** Data de calendário (YYYY-MM-DD) de um instante, no fuso da aplicação. */
export function toLocalDate(instant: string | Date, tz = config.timezone): string {
  const d = typeof instant === 'string' ? new Date(instant) : instant;
  const p = zonedParts(d, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Hoje (YYYY-MM-DD) no fuso da aplicação. */
export function todayLocal(now: Date = new Date(), tz = config.timezone): string {
  return toLocalDate(now, tz);
}

/** Diferença (ms) entre o horário de parede no fuso e UTC, para um instante. */
function tzOffsetMs(date: Date, tz: string): number {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Converte um horário de parede no fuso da aplicação para um instante UTC. */
export function zonedWallTimeToUtc(
  dateStr: string,
  timeStr = '00:00:00',
  tz = config.timezone,
): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm, ss = 0] = timeStr.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm, ss);
  // Duas iterações resolvem corretamente inclusive transições de horário de verão.
  let ts = guess - tzOffsetMs(new Date(guess), tz);
  ts = guess - tzOffsetMs(new Date(ts), tz);
  return new Date(ts);
}

/** Início do dia (00:00 no fuso da aplicação) em UTC ISO. */
export function startOfLocalDayUtc(dateStr: string, tz = config.timezone): string {
  return zonedWallTimeToUtc(dateStr, '00:00:00', tz).toISOString();
}

export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + days * DAY_MS);
  return dt.toISOString().slice(0, 10);
}

/** Dias corridos (fracionários) entre dois instantes. */
export function daysBetween(fromIso: string, toIso: string | Date): number {
  const to = typeof toIso === 'string' ? new Date(toIso).getTime() : toIso.getTime();
  return (to - new Date(fromIso).getTime()) / DAY_MS;
}

/** Segunda-feira (YYYY-MM-DD) da semana de uma data. */
export function startOfWeek(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = domingo
  const diff = dow === 0 ? -6 : 1 - dow;
  return addDays(dateStr, diff);
}

export function startOfMonth(dateStr: string): string {
  return `${dateStr.slice(0, 7)}-01`;
}

export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
