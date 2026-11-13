import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Flag, Pencil, Plus, Target } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Board, BoardCard, byBoardPosition } from '../components/Board';
import { DataTable, type Column } from '../components/DataTable';
import { HorizonFilter, HorizonSelect } from '../components/HorizonSelect';
import { boardOrderKey, StatusSelect } from '../components/StatusSelect';
import { ICE_SORT_OPTIONS, IceBadge, IceFields, IceStrip, sortByIce, type IceSortKey } from '../components/Ice';
import { FlagBadge, FlagControl, FlagEventText } from '../components/Flag';
import { OriginRequestCard } from '../components/Requests';
import { TrashButton } from '../components/TrashButton';
import { TaskTable } from '../components/TaskTable';
import { useTaskModal } from '../components/TaskModal';
import { Avatar, ErrorText, HorizonBadge, Field, Modal, OutcomeTag, PageHeader, ProgressBar, Spinner, StatusPill, ViewToggle, type BoardView } from '../components/ui';
import { api, type Outcome, type Task } from '../lib/api';
import { OUTCOME_COLOR, OUTCOME_COLOR_KEYS, fmtDate, fmtDateTime, fmtDateOfInstant, fmtNumber, outcomeColor } from '../lib/format';
import { usePersistentState } from '../lib/prefs';
import { useEpics, useOutcomes, useStatuses, useUserOptions } from '../lib/queries';
import { Info, pct, sortByCreatedDesc } from './EpicsPage';

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
        <Target size={16} className="mt-0.5 shrink-0" style={{ color: outcomeColor(o.color).dot }} />
        <h3 className="flex-1 font-semibold text-slate-900 group-hover:text-blue-700">{o.name}</h3>
        <HorizonBadge horizon={o.horizon} />
        <IceBadge score={o.ice_score} />
        <StatusPill name={o.status_name} color={o.status_color} />
      </div>
      <div className="mb-3 ml-6 text-xs text-slate-500">
        {o.epic_name} · {o.owner_name ?? 'Sem responsável'} · Criado em {fmtDateOfInstant(o.created_at)}
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

type OutcomeSort = 'manual' | 'epic' | 'created_at' | IceSortKey;
const isOutcomeSort = (v: unknown): v is OutcomeSort =>
  v === 'manual' || v === 'epic' || v === 'created_at' || ICE_SORT_OPTIONS.some((o) => o.key === v);

function OutcomeBoardCard({ outcome: o, overlay }: { outcome: Outcome; overlay?: boolean }) {
  const c = outcomeColor(o.color);
  const prog = indicatorProgress(o);
  return (
    <BoardCard overlay={overlay} dim={!o.active}>
      <div className="mb-1.5 flex items-start gap-2">
        <Target size={14} className="mt-0.5 shrink-0" style={{ color: c.dot }} />
        <h3 className="flex-1 text-sm leading-snug font-medium text-slate-700">{o.name}</h3>
        <HorizonBadge horizon={o.horizon} />
        {o.owner_name && <Avatar name={o.owner_name} id={o.owner_id} />}
      </div>
      <p className="mb-2 flex items-center gap-1 text-[11px] text-slate-500" title="Épico">
        <Flag size={11} className="shrink-0" /> <span className="truncate">{o.epic_name}</span>
      </p>
      {o.indicator_name && (
        <div className="mb-1.5 text-[11px] text-slate-500">
          <div className="truncate" title={o.indicator_name}>
            {o.indicator_name}: <b className="text-slate-700">{fmtValue(o.current_value, o.indicator_unit)}</b> → {fmtValue(o.target_value, o.indicator_unit)}
          </div>
          {prog !== null && (
            <div className="mt-1 flex items-center gap-2">
              <ProgressBar value={prog} />
              <span className="tabular-nums">{prog}%</span>
            </div>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
        <span className="rounded px-1.5 py-0.5 font-medium" style={{ background: c.bg, color: c.text }}>
          {o.tasks_done}/{o.tasks_count} tarefas
        </span>
        <IceBadge score={o.ice_score} compact />
        <FlagBadge item={o} />
        {!o.active && <span className="ml-auto">Inativo</span>}
      </div>
    </BoardCard>
  );
}

export function OutcomesPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [prefs, setPrefs] = usePersistentState('outcomes.prefs', {
    view: 'kanban' as BoardView,
    sort: 'manual' as OutcomeSort,
    showInactive: false,
    epic: '',
    horizon: '',
  });
  const { showInactive } = prefs;
  const sort: OutcomeSort = isOutcomeSort(prefs.sort) ? prefs.sort : 'manual';
  const { data: outcomes, isLoading, error } = useOutcomes(showInactive);
  const { data: epics } = useEpics();
  const { data: statuses } = useStatuses();
  const [editing, setEditing] = useState<{ status_id?: number } | null>(null);
  const list = outcomes?.filter((o) => (!prefs.epic || String(o.epic_id) === prefs.epic) && (!prefs.horizon || o.horizon === prefs.horizon)) ?? [];
  const sortColumn = (l: Outcome[]) =>
    sort === 'manual'
      ? byBoardPosition(l)
      : sort === 'created_at'
        ? sortByCreatedDesc(l)
        : sort === 'epic'
          ? [...l].sort((a, b) => a.epic_name.localeCompare(b.epic_name) || a.name.localeCompare(b.name))
          : sortByIce(l, sort);
  const order = boardOrderKey(statuses);

  const columns: Column<Outcome>[] = [
    { key: 'name', label: 'Outcome', sort: (o) => o.name.toLowerCase(), render: (o) => <OutcomeTag name={o.name} color={o.color} className="text-xs" />, className: 'min-w-56', wrap: true },
    { key: 'epic', label: 'Épico', sort: (o) => o.epic_name, render: (o) => o.epic_name, wrap: true, className: 'min-w-40' },
    { key: 'horizon', label: 'Horizonte', sort: (o) => o.horizon, render: (o) => (o.horizon ? <HorizonBadge horizon={o.horizon} full /> : '—') },
    { key: 'status', label: 'Status', sort: order, render: (o) => <StatusPill name={o.status_name} color={o.status_color} /> },
    { key: 'owner', label: 'Responsável', sort: (o) => o.owner_name, render: (o) => o.owner_name ?? '—' },
    {
      key: 'indicator',
      label: 'Indicador (atual → meta)',
      sort: (o) => indicatorProgress(o),
      defaultDir: -1,
      render: (o) =>
        o.indicator_name ? (
          <span title={o.indicator_name}>
            {fmtValue(o.current_value, o.indicator_unit)} → {fmtValue(o.target_value, o.indicator_unit)}
            {indicatorProgress(o) !== null && <span className="ml-1 text-xs text-slate-500">({indicatorProgress(o)}%)</span>}
          </span>
        ) : (
          '—'
        ),
    },
    {
      key: 'tasks',
      label: 'Tarefas',
      sort: (o) => pct(o.tasks_done, o.tasks_count),
      defaultDir: -1,
      render: (o) => (
        <div className="flex min-w-32 items-center gap-2 text-xs">
          <ProgressBar value={pct(o.tasks_done, o.tasks_count)} />
          <span className="tabular-nums">
            {o.tasks_done}/{o.tasks_count}
          </span>
        </div>
      ),
    },
    { key: 'flag', label: 'Flag', sort: (o) => (o.flagged_at ? 0 : 1), render: (o) => <FlagBadge item={o} /> },
    { key: 'ice', label: 'ICE', sort: (o) => o.ice_score, render: (o) => <IceBadge score={o.ice_score} compact />, defaultDir: -1 },
    { key: 'target', label: 'Data alvo', sort: (o) => o.target_date, render: (o) => fmtDate(o.target_date) },
    { key: 'created', label: 'Criado em', sort: (o) => o.created_at, render: (o) => fmtDateOfInstant(o.created_at), defaultDir: -1 },
  ];

  return (
    <div>
      <PageHeader
        title="Outcomes"
        subtitle="Resultados de negócio que as tarefas ajudam a produzir."
        actions={
          <>
            <ViewToggle value={prefs.view} onChange={(view) => setPrefs((p) => ({ ...p, view }))} />
            {prefs.view === 'kanban' && (
              <select
                className="input w-auto py-1.5"
                value={sort}
                onChange={(e) => setPrefs((p) => ({ ...p, sort: e.target.value as OutcomeSort }))}
                aria-label="Ordenar outcomes"
                title="Na ordem do quadro, arraste os cards para definir a prioridade dentro de cada coluna"
              >
                <option value="manual">Ordenar: Ordem do quadro (arrastar para priorizar)</option>
                <option value="epic">Ordenar: épico e nome</option>
                <option value="created_at">Ordenar: Data de criação (mais recente primeiro)</option>
                {ICE_SORT_OPTIONS.map((opt) => (
                  <option key={opt.key} value={opt.key}>
                    Ordenar: {opt.label} (maior primeiro)
                  </option>
                ))}
              </select>
            )}
            <select
              className={`input w-auto py-1.5${prefs.epic ? ' filter-active' : ''}`}
              value={prefs.epic}
              onChange={(e) => setPrefs((p) => ({ ...p, epic: e.target.value }))}
              aria-label="Filtrar por épico"
            >
              <option value="">Épico: todos</option>
              {epics?.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
            <HorizonFilter value={prefs.horizon} onChange={(horizon) => setPrefs((p) => ({ ...p, horizon }))} />
            <label
              className={`flex items-center gap-1.5 rounded-md border border-transparent px-1.5 py-1 text-sm text-slate-600${showInactive ? ' filter-active' : ''}`}
            >
              <input type="checkbox" checked={showInactive} onChange={(e) => setPrefs((p) => ({ ...p, showInactive: e.target.checked }))} /> Inativos
            </label>
            <button className="btn-primary" onClick={() => setEditing({})}>
              <Plus size={16} /> Novo outcome
            </button>
          </>
        }
      />
      <ErrorText error={error} />
      {isLoading || !statuses ? (
        <Spinner />
      ) : prefs.view === 'kanban' ? (
        <Board
          items={list}
          statuses={statuses}
          queryKey={['outcomes', { includeInactive: showInactive }]}
          manual={sort === 'manual'}
          sortColumn={sortColumn}
          move={({ id, status_id, before_id }) => api.patch(`/outcomes/${id}/position`, { status_id, before_id })}
          onSettled={() => Promise.all(['outcomes', 'outcome', 'epic'].map((k) => qc.invalidateQueries({ queryKey: [k] })))}
          renderCard={(o, overlay) => <OutcomeBoardCard outcome={o} overlay={overlay} />}
          onOpen={(o) => navigate(`/outcomes/${o.id}`)}
          onAdd={(status_id) => setEditing({ status_id })}
          noun={{ one: 'outcome', many: 'outcomes' }}
        />
      ) : (
        <DataTable
          rows={list}
          columns={columns}
          defaultSort={{ key: 'status', dir: 1 }}
          onRowClick={(o) => navigate(`/outcomes/${o.id}`)}
          rowClassName={(o) => (o.active ? '' : 'opacity-60')}
          empty="Nenhum outcome encontrado."
          count={(n) => `${n} outcome(s)`}
        />
      )}
      {editing && (
        <OutcomeFormModal
          onClose={() => setEditing(null)}
          defaultEpicId={prefs.epic ? Number(prefs.epic) : undefined}
          defaultStatusId={editing.status_id}
        />
      )}
    </div>
  );
}

export function OutcomeDetailPage() {
  const id = Number(useParams().id);
  const { open } = useTaskModal();
  const qc = useQueryClient();
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
                <span className="size-3 shrink-0 rounded-full" style={{ background: outcomeColor(o.color).dot }} title={`Cor: ${outcomeColor(o.color).label}`} />
                <h1 className="text-xl font-semibold text-slate-900">{o.name}</h1>
                <StatusPill name={o.status_name} color={o.status_color} />
                <HorizonBadge horizon={o.horizon} full />
              </div>
              <p className="text-sm text-slate-500">
                Épico:{' '}
                <Link to={`/epicos/${o.epic_id}`} className="text-slate-900 underline underline-offset-2 hover:text-slate-500">
                  {o.epic_name}
                </Link>
              </p>
              {o.description && <p className="mt-2 text-sm whitespace-pre-wrap text-slate-600">{o.description}</p>}
              {o.origin_request && (
                <div className="mt-3">
                  <OriginRequestCard origin={o.origin_request} />
                </div>
              )}
            </div>
            <div className="flex gap-1">
              <button className="btn-secondary" onClick={() => setEditing(true)}>
                <Pencil size={14} /> Editar
              </button>
              <TrashButton
                url={`/outcomes/${o.id}`}
                backTo="/outcomes"
                confirmText="Mover este outcome para a lixeira? As tarefas continuam existindo, só deixam de mostrá-lo. Ele poderá ser restaurado por 30 dias."
              />
            </div>
          </div>
          <div className="mt-3">
            <FlagControl item={o} url={`/outcomes/${o.id}/flag`} onChanged={() => Promise.all(['outcome', 'outcomes'].map((k) => qc.invalidateQueries({ queryKey: [k] })))} />
          </div>
          <div className="mt-4 grid gap-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
            <Info label="Responsável" value={o.owner_name ?? '—'} />
            <Info label="Criado em" value={fmtDateOfInstant(o.created_at)} />
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
          <h2 className="mt-5 mb-2 text-xs font-semibold tracking-wide text-slate-400 uppercase">Priorização (ICE)</h2>
          <IceStrip item={o} />
          {!!o.flag_events?.length && (
            <>
              <h2 className="mt-5 mb-2 text-xs font-semibold tracking-wide text-slate-400 uppercase">Histórico de flags</h2>
              <ol className="space-y-2">
                {o.flag_events.map((e) => (
                  <li key={e.id} className="text-sm text-slate-800">
                    <FlagEventText e={e} />
                    <div className="text-xs text-slate-500">
                      {fmtDateTime(e.created_at)} · {e.user_name ?? '—'}
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}
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

export function OutcomeFormModal({
  outcome,
  defaultEpicId,
  defaultStatusId,
  onClose,
  title,
  banner,
  prefill,
  submit,
  onSaved,
}: {
  outcome?: Outcome;
  defaultEpicId?: number;
  /** Coluna do quadro de um novo outcome (botão + da coluna). */
  defaultStatusId?: number;
  onClose: () => void;
  title?: string;
  banner?: ReactNode;
  /** Textos iniciais de um novo outcome (ex.: vindos de uma solicitação). */
  prefill?: { name?: string; description?: string; indicator_name?: string };
  /** Substitui a criação padrão (ex.: aprovar uma solicitação convertendo-a em outcome). */
  submit?: (body: Record<string, unknown>) => Promise<unknown>;
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const { data: users } = useUserOptions();
  const { data: epics } = useEpics(true);
  // Novo outcome já num épico (ex.: botão no detalhe do épico): sugere o horizonte do épico.
  useEffect(() => {
    if (outcome || !defaultEpicId) return;
    const h = epics?.find((x) => x.id === defaultEpicId)?.horizon;
    if (h) setF((p) => (p.horizon ? p : { ...p, horizon: h }));
  }, [epics, outcome, defaultEpicId]);
  const s = (v: unknown) => (v == null ? '' : String(v));
  const [f, setF] = useState({
    name: s(outcome?.name ?? prefill?.name),
    description: s(outcome?.description ?? prefill?.description),
    epic_id: s(outcome?.epic_id ?? defaultEpicId),
    owner_id: s(outcome?.owner_id),
    status_id: s(outcome?.status_id ?? defaultStatusId),
    horizon: s(outcome?.horizon),
    start_date: s(outcome?.start_date),
    target_date: s(outcome?.target_date),
    indicator_name: s(outcome?.indicator_name ?? prefill?.indicator_name),
    indicator_unit: s(outcome?.indicator_unit),
    baseline_value: s(outcome?.baseline_value),
    target_value: s(outcome?.target_value),
    current_value: s(outcome?.current_value),
    ice_impact: s(outcome?.ice_impact),
    ice_confidence: s(outcome?.ice_confidence),
    ice_ease: s(outcome?.ice_ease),
    active: outcome ? !!outcome.active : true,
    color: outcome?.color ?? '',
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: () => (outcome ? api.put(`/outcomes/${outcome.id}`, f) : submit ? submit(f) : api.post('/outcomes', f)),
    onSuccess: async () => {
      await Promise.all(['outcomes', 'outcome', 'epics', 'epic', 'tasks'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      (onSaved ?? onClose)();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={title ?? (outcome ? 'Editar outcome' : 'Novo outcome')}
      size="lg"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn-primary" form="outcome-form" disabled={save.isPending}>
            {submit ? 'Aprovar e criar outcome' : 'Salvar'}
          </button>
        </>
      }
    >
      {banner}
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
        <Field label="Cor (identifica o outcome nas tarefas)">
          <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Cor do outcome">
            {!outcome && (
              <button
                type="button"
                role="radio"
                aria-checked={!f.color}
                onClick={() => setF((p) => ({ ...p, color: '' }))}
                className={`rounded-full border px-2.5 py-1 text-xs ${!f.color ? 'border-slate-900 text-slate-900' : 'border-slate-200 text-slate-500'}`}
              >
                Automática
              </button>
            )}
            {OUTCOME_COLOR_KEYS.map((k) => {
              const c = OUTCOME_COLOR[k];
              const on = f.color === k;
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={c.label}
                  title={c.label}
                  onClick={() => setF((p) => ({ ...p, color: k }))}
                  className={`size-7 rounded-full ring-offset-2 transition ${on ? 'ring-2 ring-slate-900' : 'hover:ring-2 hover:ring-slate-300'}`}
                  style={{ background: c.dot }}
                />
              );
            })}
            {f.name && <OutcomeTag name={f.name} color={f.color || null} className="ml-1" />}
          </div>
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Épico" required>
            <select
              className="input"
              value={f.epic_id}
              onChange={(e) => {
                const v = e.target.value;
                // Sem horizonte escolhido, o outcome herda o do épico (pode ser alterado).
                setF((p) => ({ ...p, epic_id: v, horizon: p.horizon || (epics?.find((x) => String(x.id) === v)?.horizon ?? '') }));
              }}
              required
            >
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
          <Field label="Horizonte (3 horizontes)">
            <HorizonSelect value={f.horizon} onChange={(v) => setF((p) => ({ ...p, horizon: v }))} />
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
        <IceFields values={f} onChange={(k, v) => setF((p) => ({ ...p, [k]: v }))} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.active} onChange={(e) => setF((p) => ({ ...p, active: e.target.checked }))} /> Ativo
        </label>
        <ErrorText error={save.error} />
      </form>
    </Modal>
  );
}
