export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${url}`, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/auth/')) window.dispatchEvent(new Event('auth:expired'));
    throw new ApiError(res.status, data.error ?? `Erro ${res.status}`);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body ?? {}),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body ?? {}),
  del: <T>(url: string) => request<T>('DELETE', url),
};

/** Monta query string ignorando valores vazios. */
export function qs(params: Record<string, unknown>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || v === false) continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

// ---------- Tipos ----------

export type Role = 'admin' | 'user';
export type Priority = 'baixa' | 'media' | 'alta' | 'urgente';
export type PlanStatus = 'planejado' | 'em_andamento' | 'concluido' | 'cancelado';
export type DeadlineState =
  | 'sem_prazo'
  | 'no_prazo'
  | 'atrasada'
  | 'concluida_no_prazo'
  | 'concluida_com_atraso'
  | 'concluida';

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  active?: number;
  created_at?: string;
}
export interface UserOption {
  id: number;
  name: string;
  active: number;
}
export interface Sector {
  id: number;
  name: string;
  active: number;
}
export interface Status {
  id: number;
  name: string;
  color: string;
  position: number;
  is_default: number;
  is_start_status: number;
  is_completion_status: number;
  /** Tarefas abertas neste status contam no WIP. */
  counts_in_wip: number;
  active: number;
}
export interface Epic {
  id: number;
  name: string;
  description: string | null;
  okr: string | null;
  owner_id: number | null;
  owner_name: string | null;
  status: PlanStatus;
  start_date: string | null;
  end_date: string | null;
  active: number;
  outcomes_count: number;
  tasks_count: number;
  tasks_done: number;
}
export interface Outcome {
  id: number;
  epic_id: number;
  epic_name: string;
  name: string;
  description: string | null;
  owner_id: number | null;
  owner_name: string | null;
  status: PlanStatus;
  start_date: string | null;
  target_date: string | null;
  indicator_name: string | null;
  indicator_unit: string | null;
  baseline_value: number | null;
  target_value: number | null;
  current_value: number | null;
  ice_impact: number | null;
  ice_confidence: number | null;
  ice_ease: number | null;
  /** Calculado pelo servidor: impacto × confiança × facilidade (nulo se faltar algum fator). */
  ice_score: number | null;
  active: number;
  tasks_count: number;
  tasks_done: number;
}
export interface Task {
  id: number;
  title: string;
  description: string | null;
  notes: string | null;
  sector_id: number;
  sector_name: string;
  requester_id: number;
  requester_name: string;
  assignee_id: number;
  assignee_name: string;
  epic_id: number | null;
  epic_name: string | null;
  outcome_id: number | null;
  outcome_name: string | null;
  status_id: number;
  status_name: string;
  status_color: string;
  priority: Priority;
  estimated_hours: number | null;
  ice_impact: number | null;
  ice_confidence: number | null;
  ice_ease: number | null;
  /** Calculado pelo servidor: impacto × confiança × facilidade (nulo se faltar algum fator). */
  ice_score: number | null;
  planned_start_date: string | null;
  planned_end_date: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  is_completed: boolean;
  is_overdue: boolean;
  deadline_state: DeadlineState;
}
export interface HistoryEntry {
  id: number;
  changed_at: string;
  from_status_id: number | null;
  to_status_id: number;
  from_status_name: string | null;
  to_status_name: string;
  to_status_color: string;
  changed_by_name: string | null;
}
export interface TaskDetail extends Task {
  history: HistoryEntry[];
}

export interface Stats {
  count: number;
  avg: number | null;
  median: number | null;
}
export interface DashboardData {
  period: { from: string; to: string; granularity: 'week' | 'month'; days: number };
  cycle_time: Stats;
  lead_time: Stats;
  throughput: { count: number; per_week: number };
  created: { count: number };
  wip: { count: number; started: number };
  overdue: { count: number };
  series: { bucket: string; created: number; completed: number; cycle_avg: number | null; cycle_median: number | null }[];
  status_distribution: { status_id: number; name: string; color: string; position: number; count: number }[];
  aging: { key: string; label: string; count: number }[];
  /** Tempo médio (dias) por tarefa em cada status, para passagens encerradas no período. */
  time_in_status: { status_id: number; name: string; color: string; tasks: number; avg_days: number | null; median_days: number | null }[];
  /** Nomes dos status que contam no WIP. */
  wip_statuses: string[];
}
