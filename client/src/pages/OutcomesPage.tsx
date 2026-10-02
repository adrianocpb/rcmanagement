import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Pencil, Plus, Target } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { TaskTable } from '../components/TaskTable';
import { useTaskModal } from '../components/TaskModal';
import { EmptyState, ErrorText, Field, Modal, PageHeader, ProgressBar, Spinner } from '../components/ui';
import { api, type Outcome, type Task } from '../lib/api';
import { PLAN_STATUS, fmtDate, fmtNumber } from '../lib/format';
import { useEpics, useOutcomes, useUserOptions } from '../lib/queries';
import { Info, PlanStatusBadge, pct } from './EpicsPage';

/** Progresso do indicador de negócio: quanto do caminho baseline → meta já foi percorrido. */
export function indicatorProgress(o: Outcome): number | null {
  const { baseline_value: b, target_value: t, current_value: c } = o;
  if (b == null || t == null || c == null || b === t) return null;
  return Math.max(0, Math.min(100, Math.round(((c - b) / (t - b)) * 100)));
}

function fmtValue(v: number | null, unit: string | null) {
  if (v == null) return '—';
  return `${fmtNumber(v)}${unit ? ` ${unit}` : ''}`;
}

export function IndicatorStrip({ outcome, large }: { outcome: Outcome; large?: boolean }) {
  if (!outcome.indicator_name) return <p className="text-xs text-slate-400">Sem indicador definido.</p>;
  const prog = indicatorProgress(outcome);
  const val = large ? 'text-2xl' : 'text-base';
  return (
    <div>
      <div className="mb-2 text-xs text-slate-500">
        Indicador: <span className="font-medium text-slate-700">{outcome.indicator_name}</span>
        {outcome.indicator_unit && ` (${outcome.indicator_unit})`}
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 rounded-lg bg-slate-50 p-2 text-center">
          <div className="text-[11px] text-slate-500 uppercase">Baseline</div>
          <div className={`${val} font-semibold text-slate-600 tabular-nums`}>{fmtValue(outcome.baseline_value, large ? outcome.indicator_unit : null)}</div>
        </div>
        <ArrowRight size={16} className="shrink-0 text-slate-300" />
        <div className="flex-1 rounded-lg bg-blue-50 p-2 text-center ring-1 ring-blue-200">
          <div className="text-[11px] text-blue-700 uppercase">Atual</div>
          <div className={`${val} font-bold text-blue-700 tabular-nums`}>{fmtValue(outcome.current_value, large ? outcome.indicator_unit : null)}</div>
        </div>
        <ArrowRight size={16} className="shrink-0 text-slate-300" />
        <div className="flex-1 rounded-lg bg-green-50 p-2 text-center">
          <div className="text-[11px] text-green-700 uppercase">Meta</div>
          <div className={`${val} font-semibold text-green-700 tabular-nums`}>{fmtValue(outcome.target_value, large ? outcome.indicator_unit : null)}</div>
        </div>
      </div>
      {prog !== null && (
        <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
          <ProgressBar value={prog} />
          <span className="font-medium whitespace-nowrap text-slate-700">{prog}% da meta</span>
        </div>
      )}
    </div>
  );
}

export function OutcomeCard({ outcome: o }: { outcome: Outcome }) {
  return (
    <Link to={`/outcomes/${o.id}`} className={`card group block p-4 transition hover:border-blue-300 hover:shadow-md ${o.active ? '' : 'opacity-60'}`}>
      <div className="mb-1 flex items-start gap-2">
        <Target size={16} className="mt-0.5 shrink-0 text-violet-600" />
        <h3 className="flex-1 font-semibold text-slate-900 group-hover:text-blue-700">{o.name}</h3>
        <PlanStatusBadge status={o.status} />
      </div>
      <div className="mb-3 ml-6 text-xs text-slate-500">
        {o.epic_name} · {o.owner_name ?? 'Sem responsável'}
      </div>
      <IndicatorStrip outcome={o} />
      <div className="mt-3 flex gap-4 border-t border-slate-100 pt-2 text-xs text-slate-500">
        <span>
          <b className="text-slate-700">{o.tasks_count}</b> tarefas
        </span>
        <span>
          <b className="text-green-700">{o.tasks_done}</b> concluídas
        </span>
        <span>
          <b className="text-slate-700">{o.tasks_count - o.tasks_done}</b> abertas
        </span>
      </div>
    </Link>
  );
}

export function OutcomesPage() {
  const [showInactive, setShowInactive] = useState(false);
  const { data: outcomes, isLoading, error } = useOutcomes(showInactive);
  const { data: epics } = useEpics();
  const [epicFilter, setEpicFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const list = outcomes?.filter((o) => !epicFilter || String(o.epic_id) === epicFilter) ?? [];

  return (
    <div>
      <PageHeader
        title="Outcomes"
        subtitle="Resultados de negócio que as tarefas ajudam a produzir."
        actions={
          <>
            <select className="input w-auto py-1" value={epicFilter} onChange={(e) => setEpicFilter(e.target.value)}>
              <option value="">Épico: todos</option>
              {epics?.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-sm text-slate-600">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Inativos
            </label>
            <button className="btn-primary" onClick={() => setCreating(true)}>
              <Plus size={16} /> Novo outcome
            </button>
          </>
        }
      />
      <ErrorText error={error} />
      {isLoading && <Spinner />}
      {outcomes && list.length === 0 && <EmptyState>Nenhum outcome encontrado.</EmptyState>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {list.map((o) => (
          <OutcomeCard key={o.id} outcome={o} />
        ))}
      </div>
      {creating && <OutcomeFormModal onClose={() => setCreating(false)} defaultEpicId={epicFilter ? Number(epicFilter) : undefined} />}
    </div>
  );
}

export function OutcomeDetailPage() {
  const id = Number(useParams().id);
  const { open } = useTaskModal();
  const [editing, setEditing] = useState(false);
  const { data: o, isLoading, error } = useQuery({ queryKey: ['outcome', id], queryFn: () => api.get<Outcome>(`/outcomes/${id}`) });
  const { data: tasks } = useQuery({ queryKey: ['tasks', { outcome_id: id }], queryFn: () => api.get<Task[]>(`/tasks?outcome_id=${id}`) });

  if (isLoading) return <Spinner />;
  if (error || !o) return <ErrorText error={error ?? 'Outcome não encontrado'} />;
  const progress = pct(o.tasks_done, o.tasks_count);

  return (
    <div>
      <Link to="/outcomes" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft size={14} /> Outcomes
      </Link>
      <div className="mb-5 grid gap-4 lg:grid-cols-5">
        <div className="card p-5 lg:col-span-3">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold text-slate-900">{o.name}</h1>
                <PlanStatusBadge status={o.status} />
              </div>
              <p className="text-sm text-slate-500">
                Épico:{' '}
                <Link to={`/epicos/${o.epic_id}`} className="text-blue-700 hover:underline">
                  {o.epic_name}
                </Link>
              </p>
              {o.description && <p className="mt-2 text-sm whitespace-pre-wrap text-slate-600">{o.description}</p>}
            </div>
            <button className="btn-secondary" onClick={() => setEditing(true)}>
              <Pencil size={14} /> Editar
            </button>
          </div>
          <div className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
            <Info label="Responsável" value={o.owner_name ?? '—'} />
            <Info label="Período" value={`${fmtDate(o.start_date)} → ${fmtDate(o.target_date)}`} />
            <div>
              <div className="text-xs text-slate-500">
                Tarefas concluídas ({o.tasks_done}/{o.tasks_count})
              </div>
              <div className="mt-1 flex items-center gap-2">
                <ProgressBar value={progress} />
                <span className="font-semibold">{progress}%</span>
              </div>
            </div>
          </div>
        </div>
        <div className="card p-5 lg:col-span-2">
          <h2 className="mb-3 text-xs font-semibold tracking-wide text-slate-400 uppercase">Indicador de negócio</h2>
          <IndicatorStrip outcome={o} large />
        </div>
      </div>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold text-slate-900">Tarefas relacionadas</h2>
        <button className="btn-secondary" onClick={() => open('new', { outcome_id: o.id, epic_id: o.epic_id })}>
          <Plus size={14} /> Nova tarefa
        </button>
      </div>
      {tasks ? <TaskTable tasks={tasks} hide={['outcome']} /> : <Spinner />}
      {editing && <OutcomeFormModal outcome={o} onClose={() => setEditing(false)} />}
    </div>
  );
}

export function OutcomeFormModal({ outcome, defaultEpicId, onClose }: { outcome?: Outcome; defaultEpicId?: number; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: users } = useUserOptions();
  const { data: epics } = useEpics(true);
  const s = (v: unknown) => (v == null ? '' : String(v));
  const [f, setF] = useState({
    name: s(outcome?.name),
    description: s(outcome?.description),
    epic_id: s(outcome?.epic_id ?? defaultEpicId),
    owner_id: s(outcome?.owner_id),
    status: outcome?.status ?? 'planejado',
    start_date: s(outcome?.start_date),
    target_date: s(outcome?.target_date),
    indicator_name: s(outcome?.indicator_name),
    indicator_unit: s(outcome?.indicator_unit),
    baseline_value: s(outcome?.baseline_value),
    target_value: s(outcome?.target_value),
    current_value: s(outcome?.current_value),
    active: outcome ? !!outcome.active : true,
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: () => (outcome ? api.put(`/outcomes/${outcome.id}`, f) : api.post('/outcomes', f)),
    onSuccess: async () => {
      await Promise.all(['outcomes', 'outcome', 'epics', 'epic', 'tasks'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={outcome ? 'Editar outcome' : 'Novo outcome'}
      size="lg"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn-primary" form="outcome-form" disabled={save.isPending}>
            Salvar
          </button>
        </>
      }
    >
      <form
        id="outcome-form"
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Nome" required>
          <input className="input" value={f.name} onChange={set('name')} required autoFocus placeholder="Ex.: Reduzir tempo médio de atendimento" />
        </Field>
        <Field label="Descrição">
          <textarea className="input min-h-16" value={f.description} onChange={set('description')} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Épico" required>
            <select className="input" value={f.epic_id} onChange={set('epic_id')} required>
              <option value="">Selecione…</option>
              {epics?.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Responsável">
            <select className="input" value={f.owner_id} onChange={set('owner_id')}>
              <option value="">—</option>
              {users?.filter((u) => u.active || String(u.id) === f.owner_id).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select className="input" value={f.status} onChange={set('status')}>
              {Object.entries(PLAN_STATUS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Data inicial">
            <input className="input" type="date" value={f.start_date} onChange={set('start_date')} />
          </Field>
          <Field label="Data alvo">
            <input className="input" type="date" value={f.target_date} onChange={set('target_date')} />
          </Field>
        </div>
        <fieldset className="rounded-lg border border-slate-200 p-3">
          <legend className="px-1 text-xs font-semibold text-slate-500 uppercase">Indicador principal</legend>
          <div className="grid gap-3 sm:grid-cols-5">
            <Field label="Nome do indicador" className="sm:col-span-3">
              <input className="input" value={f.indicator_name} onChange={set('indicator_name')} placeholder="Ex.: Tempo médio de atendimento" />
            </Field>
            <Field label="Unidade" className="sm:col-span-2">
              <input className="input" value={f.indicator_unit} onChange={set('indicator_unit')} placeholder="horas, %, R$…" />
            </Field>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <Field label="Baseline">
              <input className="input" type="number" step="any" value={f.baseline_value} onChange={set('baseline_value')} />
            </Field>
            <Field label="Atual">
              <input className="input" type="number" step="any" value={f.current_value} onChange={set('current_value')} />
            </Field>
            <Field label="Meta">
              <input className="input" type="number" step="any" value={f.target_value} onChange={set('target_value')} />
            </Field>
          </div>
        </fieldset>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.active} onChange={(e) => setF((p) => ({ ...p, active: e.target.checked }))} /> Ativo
        </label>
        <ErrorText error={save.error} />
      </form>
    </Modal>
  );
}
