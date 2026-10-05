import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Flag, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ErrorText, Field, Modal, PageHeader, ProgressBar, Spinner, EmptyState } from '../components/ui';
import { api, type Epic, type PlanStatus } from '../lib/api';
import { PLAN_STATUS, fmtDate } from '../lib/format';
import { useEpics, useOutcomes, useUserOptions } from '../lib/queries';
import { OutcomeCard, OutcomeFormModal } from './OutcomesPage';

export const pct = (done: number, total: number) => (total ? Math.round((done / total) * 100) : 0);

export function PlanStatusBadge({ status }: { status: PlanStatus }) {
  const s = PLAN_STATUS[status];
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${s.cls}`}>{s.label}</span>;
}

export function EpicsPage() {
  const [showInactive, setShowInactive] = useState(false);
  const { data: epics, isLoading, error } = useEpics(showInactive);
  const [editing, setEditing] = useState<Epic | 'new' | null>(null);

  return (
    <div>
      <PageHeader
        title="Épicos"
        subtitle="Nível estratégico: cada épico agrupa outcomes e se conecta a um objetivo/OKR."
        actions={
          <>
            <label
              className={`flex items-center gap-1.5 rounded-md border border-transparent px-1.5 py-1 text-sm text-slate-600${showInactive ? ' filter-active' : ''}`}
            >
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Mostrar inativos
            </label>
            <button className="btn-primary" onClick={() => setEditing('new')}>
              <Plus size={16} /> Novo épico
            </button>
          </>
        }
      />
      <ErrorText error={error} />
      {isLoading && <Spinner />}
      {epics?.length === 0 && <EmptyState>Nenhum épico cadastrado.</EmptyState>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {epics?.map((e) => (
          <Link key={e.id} to={`/epicos/${e.id}`} className={`card group block p-4 transition hover:border-blue-300 hover:shadow-md ${e.active ? '' : 'opacity-60'}`}>
            <div className="mb-2 flex items-start gap-2">
              <Flag size={16} className="mt-0.5 shrink-0 text-blue-600" />
              <h2 className="flex-1 font-semibold text-slate-900 group-hover:text-blue-700">{e.name}</h2>
              <PlanStatusBadge status={e.status} />
            </div>
            {e.okr && <p className="mb-3 line-clamp-2 text-xs text-slate-500">🎯 {e.okr}</p>}
            <div className="mb-1 flex justify-between text-xs text-slate-500">
              <span>Progresso</span>
              <span className="font-medium text-slate-700">{pct(e.tasks_done, e.tasks_count)}%</span>
            </div>
            <ProgressBar value={pct(e.tasks_done, e.tasks_count)} />
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
              <span>
                <b className="text-slate-700">{e.outcomes_count}</b> outcomes
              </span>
              <span>
                <b className="text-slate-700">{e.tasks_done}</b>/{e.tasks_count} tarefas concluídas
              </span>
              <span className="ml-auto">{e.owner_name ?? 'Sem responsável'}</span>
            </div>
          </Link>
        ))}
      </div>
      {editing && <EpicFormModal epic={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

export function EpicDetailPage() {
  const id = Number(useParams().id);
  const { data: epic, isLoading, error } = useQuery({ queryKey: ['epic', id], queryFn: () => api.get<Epic>(`/epics/${id}`) });
  const { data: outcomes } = useOutcomes(true);
  const [editing, setEditing] = useState(false);
  const [newOutcome, setNewOutcome] = useState(false);
  const list = outcomes?.filter((o) => o.epic_id === id) ?? [];

  if (isLoading) return <Spinner />;
  if (error || !epic) return <ErrorText error={error ?? 'Épico não encontrado'} />;
  const progress = pct(epic.tasks_done, epic.tasks_count);

  return (
    <div>
      <Link to="/epicos" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft size={14} /> Épicos
      </Link>
      <div className="card mb-5 p-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2">
              <h1 className="text-xl font-semibold text-slate-900">{epic.name}</h1>
              <PlanStatusBadge status={epic.status} />
              {!epic.active && <span className="rounded bg-slate-200 px-1.5 text-xs">Inativo</span>}
            </div>
            {epic.okr && <p className="text-sm text-slate-600">🎯 {epic.okr}</p>}
            {epic.description && <p className="mt-2 text-sm whitespace-pre-wrap text-slate-600">{epic.description}</p>}
          </div>
          <button className="btn-secondary" onClick={() => setEditing(true)}>
            <Pencil size={14} /> Editar
          </button>
        </div>
        <div className="mt-4 grid gap-4 text-sm sm:grid-cols-4">
          <Info label="Responsável" value={epic.owner_name ?? '—'} />
          <Info label="Período" value={`${fmtDate(epic.start_date)} → ${fmtDate(epic.end_date)}`} />
          <Info label="Outcomes / tarefas" value={`${epic.outcomes_count} / ${epic.tasks_count}`} />
          <div>
            <div className="text-xs text-slate-500">Progresso geral ({epic.tasks_done}/{epic.tasks_count})</div>
            <div className="mt-1 flex items-center gap-2">
              <ProgressBar value={progress} />
              <span className="font-semibold">{progress}%</span>
            </div>
          </div>
        </div>
      </div>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold text-slate-900">Outcomes</h2>
        <button className="btn-secondary" onClick={() => setNewOutcome(true)}>
          <Plus size={14} /> Novo outcome
        </button>
      </div>
      {list.length === 0 && <EmptyState>Este épico ainda não possui outcomes.</EmptyState>}
      <div className="grid gap-4 md:grid-cols-2">
        {list.map((o) => (
          <OutcomeCard key={o.id} outcome={o} />
        ))}
      </div>
      {editing && <EpicFormModal epic={epic} onClose={() => setEditing(false)} />}
      {newOutcome && <OutcomeFormModal defaultEpicId={id} onClose={() => setNewOutcome(false)} />}
    </div>
  );
}

export function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-0.5 font-medium text-slate-800">{value}</div>
    </div>
  );
}

export function EpicFormModal({ epic, onClose }: { epic?: Epic; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: users } = useUserOptions();
  const [f, setF] = useState({
    name: epic?.name ?? '',
    description: epic?.description ?? '',
    okr: epic?.okr ?? '',
    owner_id: epic?.owner_id ? String(epic.owner_id) : '',
    status: epic?.status ?? 'planejado',
    start_date: epic?.start_date ?? '',
    end_date: epic?.end_date ?? '',
    active: epic ? !!epic.active : true,
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: () => (epic ? api.put(`/epics/${epic.id}`, f) : api.post('/epics', f)),
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: ['epics'] }), qc.invalidateQueries({ queryKey: ['epic'] })]);
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={epic ? 'Editar épico' : 'Novo épico'}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn-primary" form="epic-form" disabled={save.isPending}>
            Salvar
          </button>
        </>
      }
    >
      <form
        id="epic-form"
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Nome" required>
          <input className="input" value={f.name} onChange={set('name')} required autoFocus />
        </Field>
        <Field label="Objetivo / OKR relacionado">
          <input className="input" value={f.okr} onChange={set('okr')} placeholder="Ex.: O1 2026 — Elevar NPS para 70" />
        </Field>
        <Field label="Descrição">
          <textarea className="input min-h-20" value={f.description} onChange={set('description')} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
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
          <Field label="Data final">
            <input className="input" type="date" value={f.end_date} onChange={set('end_date')} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.active} onChange={(e) => setF((p) => ({ ...p, active: e.target.checked }))} /> Ativo
        </label>
        <ErrorText error={save.error} />
      </form>
    </Modal>
  );
}
