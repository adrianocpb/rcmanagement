import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Flag, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Board, BoardCard, byBoardPosition } from '../components/Board';
import { DataTable, type Column } from '../components/DataTable';
import { boardOrderKey, StatusSelect } from '../components/StatusSelect';
import { TrashButton } from '../components/TrashButton';
import { Avatar, EmptyState, ErrorText, Field, Modal, PageHeader, ProgressBar, Spinner, StatusPill, ViewToggle, type BoardView } from '../components/ui';
import { api, type Epic } from '../lib/api';
import { fmtDate, fmtDateOfInstant } from '../lib/format';
import { usePersistentState } from '../lib/prefs';
import { useEpics, useOutcomes, useStatuses, useUserOptions } from '../lib/queries';
import { OriginRequestCard } from '../components/Requests';
import { OutcomeCard, OutcomeFormModal } from './OutcomesPage';

/** Ordena pela data de criação, do mais recente para o mais antigo. */
export function sortByCreatedDesc<T extends { created_at: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export const pct = (done: number, total: number) => (total ? Math.round((done / total) * 100) : 0);

type EpicSort = 'manual' | 'name' | 'created_at';

const epicProgress = (e: Epic) => pct(e.tasks_done, e.tasks_count);

function EpicBoardCard({ epic: e, overlay }: { epic: Epic; overlay?: boolean }) {
  const progress = epicProgress(e);
  return (
    <BoardCard overlay={overlay} dim={!e.active}>
      <div className="mb-1.5 flex items-start gap-2">
        <Flag size={14} className="mt-0.5 shrink-0 text-slate-500" />
        <h3 className="flex-1 text-sm leading-snug font-medium text-slate-700">{e.name}</h3>
        {e.owner_name && <Avatar name={e.owner_name} id={e.owner_id} />}
      </div>
      {e.okr && <p className="mb-2 line-clamp-2 text-[11px] text-slate-500">🎯 {e.okr}</p>}
      <div className="flex items-center gap-2 text-[11px] text-slate-500">
        <ProgressBar value={progress} />
        <span className="font-medium text-slate-700 tabular-nums">{progress}%</span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] text-slate-500">
        <span>
          <b className="text-slate-700">{e.outcomes_count}</b> outcomes
        </span>
        <span>
          <b className="text-slate-700">{e.tasks_done}</b>/{e.tasks_count} tarefas
        </span>
        {!e.active && <span className="ml-auto">Inativo</span>}
      </div>
    </BoardCard>
  );
}

export function EpicsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [prefs, setPrefs] = usePersistentState('epics.prefs', { view: 'kanban' as BoardView, sort: 'manual' as EpicSort, showInactive: false });
  const { showInactive } = prefs;
  const { data: allEpics, isLoading, error } = useEpics(showInactive);
  const { data: statuses } = useStatuses();
  const [editing, setEditing] = useState<Epic | { status_id: number } | 'new' | null>(null);
  const epics = allEpics ?? [];
  const sortColumn = (l: Epic[]) =>
    prefs.sort === 'name'
      ? [...l].sort((a, b) => a.name.localeCompare(b.name))
      : prefs.sort === 'created_at'
        ? sortByCreatedDesc(l)
        : byBoardPosition(l);
  const order = boardOrderKey(statuses);

  const columns: Column<Epic>[] = [
    { key: 'name', label: 'Épico', sort: (e) => e.name.toLowerCase(), render: (e) => <span className="font-medium text-slate-900">{e.name}</span>, className: 'min-w-56', wrap: true },
    { key: 'status', label: 'Status', sort: order, render: (e) => <StatusPill name={e.status_name} color={e.status_color} /> },
    { key: 'okr', label: 'Objetivo / OKR', sort: (e) => e.okr, render: (e) => <span className="line-clamp-2 text-slate-600">{e.okr ?? '—'}</span>, className: 'min-w-48', wrap: true },
    { key: 'owner', label: 'Responsável', sort: (e) => e.owner_name, render: (e) => e.owner_name ?? '—' },
    { key: 'outcomes', label: 'Outcomes', sort: (e) => e.outcomes_count, render: (e) => e.outcomes_count, defaultDir: -1 },
    {
      key: 'progress',
      label: 'Progresso',
      sort: epicProgress,
      defaultDir: -1,
      render: (e) => (
        <div className="flex min-w-36 items-center gap-2 text-xs">
          <ProgressBar value={epicProgress(e)} />
          <span className="tabular-nums">
            {e.tasks_done}/{e.tasks_count}
          </span>
        </div>
      ),
    },
    { key: 'period', label: 'Período', sort: (e) => e.start_date, render: (e) => `${fmtDate(e.start_date)} → ${fmtDate(e.end_date)}` },
    { key: 'created', label: 'Criado em', sort: (e) => e.created_at, render: (e) => fmtDateOfInstant(e.created_at), defaultDir: -1 },
  ];

  return (
    <div>
      <PageHeader
        title="Épicos"
        subtitle="Nível estratégico: cada épico agrupa outcomes e se conecta a um objetivo/OKR."
        actions={
          <>
            <ViewToggle value={prefs.view} onChange={(view) => setPrefs((p) => ({ ...p, view }))} />
            {prefs.view === 'kanban' && (
              <select
                className="input w-auto py-1.5"
                value={prefs.sort}
                onChange={(e) => setPrefs((p) => ({ ...p, sort: e.target.value as EpicSort }))}
                aria-label="Ordenar épicos"
                title="Na ordem do quadro, arraste os cards para definir a prioridade dentro de cada coluna"
              >
                <option value="manual">Ordenar: Ordem do quadro (arrastar para priorizar)</option>
                <option value="name">Ordenar: nome</option>
                <option value="created_at">Ordenar: Data de criação (mais recente primeiro)</option>
              </select>
            )}
            <label
              className={`flex items-center gap-1.5 rounded-md border border-transparent px-1.5 py-1 text-sm text-slate-600${showInactive ? ' filter-active' : ''}`}
            >
              <input type="checkbox" checked={showInactive} onChange={(e) => setPrefs((p) => ({ ...p, showInactive: e.target.checked }))} /> Mostrar
              inativos
            </label>
            <button className="btn-primary" onClick={() => setEditing('new')}>
              <Plus size={16} /> Novo épico
            </button>
          </>
        }
      />
      <ErrorText error={error} />
      {isLoading || !statuses ? (
        <Spinner />
      ) : prefs.view === 'kanban' ? (
        <Board
          items={epics}
          statuses={statuses}
          queryKey={['epics', { includeInactive: showInactive }]}
          manual={prefs.sort === 'manual'}
          sortColumn={sortColumn}
          move={({ id, status_id, before_id }) => api.patch(`/epics/${id}/position`, { status_id, before_id })}
          onSettled={() => Promise.all([qc.invalidateQueries({ queryKey: ['epics'] }), qc.invalidateQueries({ queryKey: ['epic'] })])}
          renderCard={(e, overlay) => <EpicBoardCard epic={e} overlay={overlay} />}
          onOpen={(e) => navigate(`/epicos/${e.id}`)}
          onAdd={(status_id) => setEditing({ status_id })}
          noun={{ one: 'épico', many: 'épicos' }}
        />
      ) : (
        <DataTable
          rows={epics}
          columns={columns}
          defaultSort={{ key: 'status', dir: 1 }}
          onRowClick={(e) => navigate(`/epicos/${e.id}`)}
          rowClassName={(e) => (e.active ? '' : 'opacity-60')}
          empty="Nenhum épico cadastrado."
          count={(n) => `${n} épico(s)`}
        />
      )}
      {editing && (
        <EpicFormModal
          epic={editing !== 'new' && 'id' in editing ? editing : undefined}
          defaultStatusId={editing !== 'new' && !('id' in editing) ? editing.status_id : undefined}
          onClose={() => setEditing(null)}
        />
      )}
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
              <StatusPill name={epic.status_name} color={epic.status_color} />
              {!epic.active && <span className="rounded bg-slate-200 px-1.5 text-xs">Inativo</span>}
            </div>
            {epic.okr && <p className="text-sm text-slate-600">🎯 {epic.okr}</p>}
            {epic.description && <p className="mt-2 text-sm whitespace-pre-wrap text-slate-600">{epic.description}</p>}
            {epic.origin_request && (
              <div className="mt-3">
                <OriginRequestCard origin={epic.origin_request} />
              </div>
            )}
          </div>
          <div className="flex gap-1">
            <button className="btn-secondary" onClick={() => setEditing(true)}>
              <Pencil size={14} /> Editar
            </button>
            <TrashButton
              url={`/epics/${epic.id}`}
              backTo="/epicos"
              confirmText={`Mover este épico para a lixeira${epic.outcomes_count ? `, junto com ${epic.outcomes_count} outcome(s)` : ''}? As tarefas continuam existindo. Ele poderá ser restaurado por 30 dias.`}
            />
          </div>
        </div>
        <div className="mt-4 grid gap-4 text-sm sm:grid-cols-3 lg:grid-cols-5">
          <Info label="Responsável" value={epic.owner_name ?? '—'} />
          <Info label="Criado em" value={fmtDateOfInstant(epic.created_at)} />
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

export function EpicFormModal({
  epic,
  defaultStatusId,
  onClose,
  title,
  banner,
  prefill,
  submit,
  onSaved,
}: {
  epic?: Epic;
  /** Coluna do quadro de um novo épico (botão + da coluna). */
  defaultStatusId?: number;
  onClose: () => void;
  title?: string;
  banner?: React.ReactNode;
  /** Textos iniciais de um novo épico (ex.: vindos de uma solicitação). */
  prefill?: { name?: string; description?: string };
  /** Substitui a criação padrão (ex.: aprovar uma solicitação convertendo-a em épico). */
  submit?: (body: Record<string, unknown>) => Promise<unknown>;
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const { data: users } = useUserOptions();
  const [f, setF] = useState({
    name: epic?.name ?? prefill?.name ?? '',
    description: epic?.description ?? prefill?.description ?? '',
    okr: epic?.okr ?? '',
    owner_id: epic?.owner_id ? String(epic.owner_id) : '',
    status_id: String(epic?.status_id ?? defaultStatusId ?? ''),
    start_date: epic?.start_date ?? '',
    end_date: epic?.end_date ?? '',
    active: epic ? !!epic.active : true,
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: () => (epic ? api.put(`/epics/${epic.id}`, f) : submit ? submit(f) : api.post('/epics', f)),
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: ['epics'] }), qc.invalidateQueries({ queryKey: ['epic'] })]);
      (onSaved ?? onClose)();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={title ?? (epic ? 'Editar épico' : 'Novo épico')}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn-primary" form="epic-form" disabled={save.isPending}>
            {submit ? 'Aprovar e criar épico' : 'Salvar'}
          </button>
        </>
      }
    >
      {banner}
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
              {users?.filter((u) => (u.active && u.role !== 'requester') || String(u.id) === f.owner_id).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <StatusSelect value={f.status_id} onChange={(v) => setF((p) => ({ ...p, status_id: v }))} />
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
