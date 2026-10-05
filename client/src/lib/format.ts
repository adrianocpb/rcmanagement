import type { DeadlineState, PlanStatus, Priority } from './api';

/**
 * Fuso horário da aplicação. Vem do servidor (/api/config) para que toda a exibição use o mesmo
 * fuso configurado no backend — e não o fuso do navegador.
 */
let appTimezone = 'America/Sao_Paulo';
export function setAppTimezone(tz: string) {
  appTimezone = tz;
}
export const getAppTimezone = () => appTimezone;

/** "YYYY-MM-DD" → "dd/mm/aaaa" (datas de calendário não passam por conversão de fuso). */
export function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
}

export function fmtShortDate(d: string | null | undefined): string {
  if (!d) return '—';
  const [, m, day] = d.slice(0, 10).split('-');
  return `${day}/${m}`;
}

/** Instante UTC → data/hora no fuso da aplicação. */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: appTimezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** Instante UTC → somente a data (dd/mm/aaaa) no fuso da aplicação. */
export function fmtDateOfInstant(iso: string | null | undefined): string {
  return iso ? fmtDateTime(iso).slice(0, 10) : '—';
}

function zonedParts(date: Date) {
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat('en-CA', {
    timeZone: appTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date))
    p[x.type] = x.value;
  return p;
}

/** Hoje (YYYY-MM-DD) no fuso da aplicação. */
export function todayLocal(): string {
  const p = zonedParts(new Date());
  return `${p.year}-${p.month}-${p.day}`;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Instante UTC → valor para <input type="datetime-local"> no fuso da aplicação. */
export function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const p = zonedParts(new Date(iso));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** Valor de <input type="datetime-local"> (fuso da aplicação) → instante UTC ISO. */
export function localInputToIso(value: string): string | null {
  if (!value) return null;
  const [date, time] = value.split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const offset = (ts: number) => {
    const p = zonedParts(new Date(ts));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ts;
  };
  let ts = guess - offset(guess);
  ts = guess - offset(ts);
  return new Date(ts).toISOString();
}

export function fmtDays(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${Math.abs(n) === 1 ? 'dia' : 'dias'}`;
}

export function fmtNumber(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('pt-BR', { maximumFractionDigits: digits });
}

export const PRIORITY: Record<Priority, { label: string; cls: string; dot: string; order: number }> = {
  urgente: { label: 'Urgente', cls: 'bg-red-50 text-red-700 ring-red-600/20', dot: 'bg-red-500', order: 0 },
  alta: { label: 'Alta', cls: 'bg-orange-50 text-orange-700 ring-orange-600/20', dot: 'bg-orange-500', order: 1 },
  media: { label: 'Média', cls: 'bg-sky-50 text-sky-700 ring-sky-600/20', dot: 'bg-sky-500', order: 2 },
  baixa: { label: 'Baixa', cls: 'bg-slate-100 text-slate-600 ring-slate-500/20', dot: 'bg-slate-400', order: 3 },
};
export const PRIORITY_KEYS: Priority[] = ['urgente', 'alta', 'media', 'baixa'];

export const PLAN_STATUS: Record<PlanStatus, { label: string; cls: string }> = {
  planejado: { label: 'Planejado', cls: 'bg-slate-100 text-slate-700' },
  em_andamento: { label: 'Em andamento', cls: 'bg-blue-50 text-blue-700' },
  concluido: { label: 'Concluído', cls: 'bg-green-50 text-green-700' },
  cancelado: { label: 'Cancelado', cls: 'bg-slate-100 text-slate-500 line-through' },
};

export const DEADLINE: Record<DeadlineState, { label: string; cls: string } | null> = {
  sem_prazo: null,
  no_prazo: null,
  atrasada: { label: 'Atrasada', cls: 'bg-red-600 text-white' },
  concluida_no_prazo: { label: 'No prazo', cls: 'bg-green-50 text-green-700 ring-1 ring-green-600/20' },
  concluida_com_atraso: { label: 'Concluída c/ atraso', cls: 'bg-amber-50 text-amber-800 ring-1 ring-amber-600/20' },
  concluida: null,
  cancelada: { label: 'Cancelada', cls: 'bg-slate-200 text-slate-600' },
};

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
