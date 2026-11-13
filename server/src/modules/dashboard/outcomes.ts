/**
 * Indicadores do dashboard na visão "Outcomes" (funções puras, testáveis sem banco).
 *  - Abertos: não estão em status de conclusão nem "encerra sem entrega".
 *  - Progresso do indicador: quanto do caminho Atual (baseline_value) → Meta (target_value) o Resultado
 *    (current_value) já percorreu (0–100%).
 *  - Meta atingida: progresso de 100% (outcomes não cancelados, com indicador completo).
 *  - Atrasados: abertos com data alvo anterior a hoje.
 *  - Criados no período: data de criação (local) dentro do período.
 *  Retrato atual, exceto "Criados no período" e "Tempo médio com flag".
 */
import { toLocalDate } from '../../lib/time.js';

export interface OutcomeRow {
  id: number;
  name: string;
  color: string | null;
  epic_name: string;
  status_id: number | null;
  is_completed: number;
  is_canceled: number;
  created_at: string;
  target_date: string | null;
  indicator_name: string | null;
  indicator_unit: string | null;
  baseline_value: number | null;
  current_value: number | null;
  target_value: number | null;
  tasks_count: number;
  tasks_done: number;
  flagged_at: string | null;
}

export interface StatusLite {
  id: number;
  name: string;
  color: string;
  position: number;
}

export function indicatorProgress(o: Pick<OutcomeRow, 'baseline_value' | 'current_value' | 'target_value'>): number | null {
  const { baseline_value: b, target_value: t, current_value: c } = o;
  if (b == null || t == null || c == null || b === t) return null;
  return Math.max(0, Math.min(100, Math.round(((c - b) / (t - b)) * 100)));
}

const avg = (v: number[]) => (v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null);

export function computeOutcomeMetrics(rows: OutcomeRow[], statuses: StatusLite[], from: string, to: string, today: string) {
  const open = rows.filter((o) => !o.is_completed && !o.is_canceled);
  const withProgress = rows
    .filter((o) => !o.is_canceled)
    .map((o) => ({ o, p: indicatorProgress(o) }))
    .filter((x): x is { o: OutcomeRow; p: number } => x.p !== null);
  const openProgress = withProgress.filter((x) => !x.o.is_completed && !x.o.is_canceled);

  return {
    total: rows.length,
    open: open.length,
    completed: rows.filter((o) => o.is_completed).length,
    created: rows.filter((o) => {
      const d = toLocalDate(o.created_at);
      return d >= from && d <= to;
    }).length,
    overdue: open.filter((o) => o.target_date && o.target_date < today).length,
    flagged_now: open.filter((o) => o.flagged_at).length,
    indicator: {
      avg_progress_open: avg(openProgress.map((x) => x.p)),
      open_measured: openProgress.length,
      open_without_indicator: open.filter((o) => indicatorProgress(o) === null).length,
      reached: withProgress.filter((x) => x.p >= 100).length,
      measured: withProgress.length,
    },
    status_distribution: statuses
      .map((s) => ({ status_id: s.id, name: s.name, color: s.color, position: s.position, count: rows.filter((o) => o.status_id === s.id).length }))
      .filter((s) => s.count > 0),
    /** Progresso do indicador dos outcomes abertos (maior primeiro). */
    progress: openProgress
      .sort((a, b) => b.p - a.p)
      .map(({ o, p }) => ({
        id: o.id,
        name: o.name,
        color: o.color,
        epic_name: o.epic_name,
        progress: p,
        indicator_name: o.indicator_name,
        unit: o.indicator_unit,
        baseline: o.baseline_value,
        current: o.current_value,
        target: o.target_value,
      })),
    /** Entregas (tarefas) dos outcomes abertos: concluídas × em aberto. */
    deliveries: open
      .filter((o) => o.tasks_count > 0)
      .sort((a, b) => b.tasks_count - a.tasks_count)
      .map((o) => ({ id: o.id, name: o.name, color: o.color, done: o.tasks_done, open: o.tasks_count - o.tasks_done })),
  };
}
