import type { ConvertType, DeadlineState, Horizon, Priority, RequestStatus, Role } from './api';

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

/** Duração em horas: até 24 h mostra horas; acima, dias (1 casa). */
export function fmtHours(h: number | null | undefined): string {
  if (h === null || h === undefined) return '—';
  if (h < 24) return `${h.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`;
  return fmtDays(Math.round((h / 24) * 10) / 10);
}

export function fmtNumber(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('pt-BR', { maximumFractionDigits: digits });
}

export const PRIORITY: Record<Priority, { label: string; cls: string; dot: string; order: number }> = {
  urgente: { label: 'Urgente', cls: 'bg-red-50 text-red-700', dot: 'bg-red-500', order: 0 },
  alta: { label: 'Alta', cls: 'bg-orange-50 text-orange-700', dot: 'bg-orange-500', order: 1 },
  media: { label: 'Média', cls: 'bg-sky-50 text-sky-700', dot: 'bg-sky-500', order: 2 },
  baixa: { label: 'Baixa', cls: 'bg-[rgba(107,107,102,0.16)] text-slate-600', dot: 'bg-slate-400', order: 3 },
};
/** Modelo dos 3 horizontes (McKinsey): do negócio atual às apostas de futuro. */
export const HORIZON: Record<Horizon, { label: string; hint: string; cls: string }> = {
  H1: { label: 'H1 — Core', hint: 'Horizonte 1: negócio atual (core), eficiência e melhoria contínua', cls: 'bg-slate-900 text-[#eff0eb]' },
  H2: { label: 'H2 — Expansão', hint: 'Horizonte 2: negócios emergentes, expansão do core', cls: 'bg-slate-500 text-white' },
  H3: { label: 'H3 — Futuro', hint: 'Horizonte 3: novas apostas e opções de futuro', cls: 'border border-dashed border-slate-500 text-slate-700 bg-white' },
};
export const HORIZON_KEYS: Horizon[] = ['H1', 'H2', 'H3'];

export const PRIORITY_KEYS: Priority[] = ['urgente', 'alta', 'media', 'baixa'];

/**
 * Cores dos outcomes (mesmas chaves do servidor: OUTCOME_COLORS em server/src/modules/outcomes.ts).
 * Tons em hex de propósito: a paleta do Tailwind foi remapeada para o tema monocromático.
 */
export const OUTCOME_COLOR: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  azul: { label: 'Azul', bg: '#e3ecfb', text: '#1f4fb5', dot: '#3b6fe0' },
  verde: { label: 'Verde', bg: '#e1f2e7', text: '#1d6f3e', dot: '#2f9e5a' },
  roxo: { label: 'Roxo', bg: '#eee6fb', text: '#6236ad', dot: '#8b5cf6' },
  rosa: { label: 'Rosa', bg: '#fbe5ef', text: '#a72c66', dot: '#db4b8f' },
  laranja: { label: 'Laranja', bg: '#fdebdd', text: '#a84c16', dot: '#ea7a2f' },
  turquesa: { label: 'Turquesa', bg: '#ddf3f0', text: '#11716a', dot: '#1fa89c' },
  amarelo: { label: 'Amarelo', bg: '#faf1cc', text: '#7d6000', dot: '#d4a514' },
  indigo: { label: 'Índigo', bg: '#e5e7fb', text: '#363b9e', dot: '#5b61d6' },
  marrom: { label: 'Marrom', bg: '#f1e7de', text: '#714526', dot: '#a0673d' },
  oliva: { label: 'Oliva', bg: '#ebf0d8', text: '#536219', dot: '#8a9b2e' },
};
export const OUTCOME_COLOR_KEYS = Object.keys(OUTCOME_COLOR);
const NO_COLOR = { label: 'Sem cor', bg: 'rgba(107,107,102,0.16)', text: '#2e2e2c', dot: '#6b6b66' };
export const outcomeColor = (key: string | null | undefined) => (key && OUTCOME_COLOR[key]) || NO_COLOR;

export const DEADLINE: Record<DeadlineState, { label: string; cls: string } | null> = {
  sem_prazo: null,
  no_prazo: null,
  atrasada: { label: 'Atrasada', cls: 'bg-red-50 text-red-700' },
  concluida_no_prazo: { label: 'No prazo', cls: 'bg-green-50 text-green-700' },
  concluida_com_atraso: { label: 'Concluída c/ atraso', cls: 'bg-amber-50 text-amber-800' },
  concluida: null,
  cancelada: { label: 'Cancelada', cls: 'bg-[rgba(107,107,102,0.16)] text-slate-600' },
};

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Administrador',
  user: 'Usuário',
  requester: 'Solicitante',
};

export const REQUEST_STATUS: Record<RequestStatus, { label: string; cls: string }> = {
  aguardando: { label: 'Aguardando aprovação', cls: 'bg-amber-50 text-amber-800' },
  info: { label: 'Precisa de mais informação', cls: 'bg-sky-50 text-sky-700' },
  aprovada: { label: 'Aprovada', cls: 'bg-green-50 text-green-700' },
  recusada: { label: 'Recusada', cls: 'bg-[rgba(107,107,102,0.16)] text-slate-600' },
};

export const CONVERT_LABEL: Record<ConvertType, string> = { task: 'Tarefa', outcome: 'Outcome', epic: 'Épico' };

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
