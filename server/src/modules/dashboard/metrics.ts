/**
 * Cálculo dos indicadores de fluxo — funções puras (testáveis sem banco).
 *
 * Definições (ver docs/ARQUITETURA.md, seção "Indicadores"):
 *  - Tarefa concluída: status atual com is_completion_status = 1 e completed_at preenchido.
 *  - Cycle Time: completed_at − started_at (dias), tarefas concluídas no período e com started_at.
 *  - Lead Time:  completed_at − created_at (dias), tarefas concluídas no período.
 *  - Throughput: nº de tarefas concluídas cujo completed_at (data local) cai no período.
 *  - Criadas: nº de tarefas cujo created_at (data local) cai no período.
 *  - Atrasadas: não concluídas, com prazo, hoje (local) > prazo. Retrato atual (ignora período).
 *  - WIP: nº de tarefas não concluídas em status marcados como "conta no WIP" (por padrão, todos
 *    exceto o Backlog). Retrato atual (ignora período).
 *  - Tempo em cada coluna: ver computeTimeInStatus.
 *  - Aging: para não concluídas, agora − (started_at ?? created_at), em dias.
 */
import { addDays, daysBetween, startOfMonth, startOfWeek, toLocalDate } from '../../lib/time.js';

export interface MetricTask {
  id: number;
  status_id: number;
  status_name: string;
  status_color: string;
  status_position: number;
  is_completed: boolean;
  /** Status atual marcado como "conta no WIP". */
  counts_in_wip: boolean;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  planned_end_date: string | null;
}

export type Granularity = 'week' | 'month';

/** Períodos acima deste tamanho são agrupados por mês nos gráficos de evolução; até ele, por semana. */
export const WEEKLY_MAX_DAYS = 120;

/** Agrupamento automático das séries temporais, pelo tamanho do período. */
export function autoGranularity(from: string, to: string): Granularity {
  const days = daysBetween(`${from}T00:00:00Z`, `${addDays(to, 1)}T00:00:00Z`);
  return days > WEEKLY_MAX_DAYS ? 'month' : 'week';
}

export interface MetricsInput {
  tasks: MetricTask[];
  from: string; // YYYY-MM-DD (inclusive, fuso da aplicação)
  to: string; // YYYY-MM-DD (inclusive)
  today: string; // YYYY-MM-DD no fuso da aplicação
  now: Date;
}

export interface Stats {
  count: number;
  avg: number | null;
  median: number | null;
}

export function stats(values: number[]): Stats {
  if (values.length === 0) return { count: 0, avg: null, median: null };
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const avg = sorted.reduce((s, v) => s + v, 0) / sorted.length;
  return { count: sorted.length, avg: round(avg), median: round(median) };
}

const round = (n: number) => Math.round(n * 10) / 10;

export const AGING_BUCKETS = [
  { key: '0-7', label: '0–7 dias', min: 0, max: 7 },
  { key: '8-15', label: '8–15 dias', min: 8, max: 15 },
  { key: '16-30', label: '16–30 dias', min: 16, max: 30 },
  { key: '30+', label: '+30 dias', min: 31, max: Infinity },
] as const;

export function bucketStart(date: string, g: Granularity): string {
  return g === 'week' ? startOfWeek(date) : startOfMonth(date);
}

function nextBucket(start: string, g: Granularity): string {
  if (g === 'week') return addDays(start, 7);
  const [y, m] = start.split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

export function computeMetrics({ tasks, from, to, today, now }: MetricsInput) {
  const granularity = autoGranularity(from, to);
  const inPeriod = (localDate: string) => localDate >= from && localDate <= to;

  const completed = tasks.filter((t) => t.is_completed && t.completed_at && inPeriod(toLocalDate(t.completed_at)));
  const created = tasks.filter((t) => inPeriod(toLocalDate(t.created_at)));
  const open = tasks.filter((t) => !t.is_completed);

  const cycleOf = (t: MetricTask) => daysBetween(t.started_at!, t.completed_at!);
  const leadOf = (t: MetricTask) => daysBetween(t.created_at, t.completed_at!);
  const withStart = completed.filter((t) => t.started_at);

  const overdue = open.filter((t) => t.planned_end_date && today > t.planned_end_date);

  // Séries temporais por semana (segunda-feira) ou mês.
  const series: {
    bucket: string;
    created: number;
    completed: number;
    cycle_avg: number | null;
    cycle_median: number | null;
  }[] = [];
  const index = new Map<string, number>();
  for (let b = bucketStart(from, granularity); b <= to; b = nextBucket(b, granularity)) {
    index.set(b, series.length);
    series.push({ bucket: b, created: 0, completed: 0, cycle_avg: null, cycle_median: null });
  }
  const cyclesByBucket = new Map<string, number[]>();
  for (const t of created) series[index.get(bucketStart(toLocalDate(t.created_at), granularity))!].created++;
  for (const t of completed) {
    const b = bucketStart(toLocalDate(t.completed_at!), granularity);
    series[index.get(b)!].completed++;
    if (t.started_at) {
      const arr = cyclesByBucket.get(b) ?? [];
      arr.push(cycleOf(t));
      cyclesByBucket.set(b, arr);
    }
  }
  for (const s of series) {
    const st = stats(cyclesByBucket.get(s.bucket) ?? []);
    s.cycle_avg = st.avg;
    s.cycle_median = st.median;
  }

  // Distribuição atual por status.
  const byStatus = new Map<number, { status_id: number; name: string; color: string; position: number; count: number }>();
  for (const t of tasks) {
    const cur = byStatus.get(t.status_id) ?? {
      status_id: t.status_id,
      name: t.status_name,
      color: t.status_color,
      position: t.status_position,
      count: 0,
    };
    cur.count++;
    byStatus.set(t.status_id, cur);
  }

  // Aging das tarefas abertas.
  const aging = AGING_BUCKETS.map((b) => ({ key: b.key, label: b.label, count: 0 }));
  for (const t of open) {
    const days = Math.floor(daysBetween(t.started_at ?? t.created_at, now));
    const i = AGING_BUCKETS.findIndex((b) => days >= b.min && days <= b.max);
    aging[i === -1 ? 0 : i].count++;
  }

  const periodDays = daysBetween(`${from}T00:00:00Z`, `${addDays(to, 1)}T00:00:00Z`);

  return {
    period: { from, to, granularity, days: Math.round(periodDays) },
    cycle_time: stats(withStart.map(cycleOf)),
    lead_time: stats(completed.map(leadOf)),
    throughput: {
      count: completed.length,
      per_week: periodDays > 0 ? round((completed.length / periodDays) * 7) : 0,
    },
    created: { count: created.length },
    wip: { count: open.filter((t) => t.counts_in_wip).length, started: open.filter((t) => t.started_at).length },
    overdue: { count: overdue.length },
    series,
    status_distribution: [...byStatus.values()].sort((a, b) => a.position - b.position),
    aging,
  };
}

// ---------------- Tempo médio em cada coluna (status) ----------------

export interface HistoryEvent {
  task_id: number;
  to_status_id: number;
  changed_at: string; // instante UTC
}

export interface StatusInfo {
  id: number;
  name: string;
  color: string;
  position: number;
  is_completion_status: boolean;
}

/**
 * Tempo médio que as tarefas passam em cada status, calculado pelo histórico de movimentações.
 *
 *  - Uma "passagem" vai da entrada no status até a próxima mudança de status da tarefa.
 *  - Se a tarefa passou mais de uma vez pelo mesmo status, os tempos são SOMADOS (tempo total da
 *    tarefa naquela coluna). A média é calculada por tarefa.
 *  - Entram as tarefas que SAÍRAM do status dentro do período (última saída, data local).
 *    A passagem em andamento (status atual) não entra — ela ainda não terminou.
 *  - Status de conclusão não são exibidos (o tempo "parado" em Concluído não é trabalho).
 */
export function computeTimeInStatus(
  events: HistoryEvent[],
  statuses: StatusInfo[],
  from: string,
  to: string,
) {
  const byTask = new Map<number, HistoryEvent[]>();
  for (const e of events) {
    const list = byTask.get(e.task_id) ?? [];
    list.push(e);
    byTask.set(e.task_id, list);
  }
  // (tarefa, status) → tempo total e última saída
  const perTaskStatus = new Map<string, { status_id: number; days: number; lastExit: string }>();
  for (const list of byTask.values()) {
    list.sort((a, b) => a.changed_at.localeCompare(b.changed_at));
    for (let i = 0; i < list.length - 1; i++) {
      const cur = list[i];
      const exit = list[i + 1].changed_at;
      const key = `${cur.task_id}:${cur.to_status_id}`;
      const acc = perTaskStatus.get(key) ?? { status_id: cur.to_status_id, days: 0, lastExit: exit };
      acc.days += daysBetween(cur.changed_at, exit);
      if (exit > acc.lastExit) acc.lastExit = exit;
      perTaskStatus.set(key, acc);
    }
  }
  const values = new Map<number, number[]>();
  for (const v of perTaskStatus.values()) {
    const exitDay = toLocalDate(v.lastExit);
    if (exitDay < from || exitDay > to) continue;
    const arr = values.get(v.status_id) ?? [];
    arr.push(v.days);
    values.set(v.status_id, arr);
  }
  return statuses
    .filter((s) => !s.is_completion_status && values.has(s.id))
    .sort((a, b) => a.position - b.position)
    .map((s) => {
      const st = stats(values.get(s.id)!);
      return { status_id: s.id, name: s.name, color: s.color, tasks: st.count, avg_days: st.avg, median_days: st.median };
    });
}
