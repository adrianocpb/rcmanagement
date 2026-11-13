import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Clock, Flag, Gauge, Hourglass, Inbox, KanbanSquare, Layers, Target, Trophy } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ErrorText, PageHeader, Spinner } from '../components/ui';
import { api, qs, type DashboardData, type OutcomeDashboardData } from '../lib/api';
import { HORIZON, HORIZON_KEYS, addDays, fmtDate, fmtDays, fmtHours, fmtNumber, fmtShortDate, outcomeColor, todayLocal } from '../lib/format';
import { usePersistentState } from '../lib/prefs';
import { useEpics, useOutcomes, useSectors, useTags, useUserOptions } from '../lib/queries';

// Cores do design system RC+ apps (monocromático): série principal em preto, contexto em cinza, grade em border.
const C = {
  created: '#a3a39d',
  completed: '#0e0e0e',
  avg: '#0e0e0e',
  aging: ['#d6d6d0', '#a3a39d', '#5c5c58', '#0e0e0e'],
  grid: '#d6d6d0',
  axis: '#5c5c58',
};

type Preset = 'week' | 'month' | '30' | '90' | '180' | 'custom';
const PRESETS: { key: Preset; label: string }[] = [
  { key: 'week', label: 'Semana atual' },
  { key: 'month', label: 'Mês atual' },
  { key: '30', label: 'Últimos 30 dias' },
  { key: '90', label: 'Últimos 90 dias' },
  { key: '180', label: 'Últimos 6 meses' },
  { key: 'custom', label: 'Personalizado' },
];

const DEFAULT_PRESET: Preset = '90';

function presetRange(p: Preset): { from: string; to: string } {
  const today = todayLocal();
  if (p === 'week') {
    const [y, m, d] = today.split('-').map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return { from: addDays(today, dow === 0 ? -6 : 1 - dow), to: today };
  }
  if (p === 'month') return { from: `${today.slice(0, 7)}-01`, to: today };
  const days = p === 'custom' ? 90 : Number(p);
  return { from: addDays(today, -(days - 1)), to: today };
}

type Kind = 'tasks' | 'outcomes';

export function DashboardPage() {
  const [prefs, setPrefs] = usePersistentState('dashboard.prefs', { kind: 'tasks' as Kind });
  const kind: Kind = prefs.kind === 'outcomes' ? 'outcomes' : 'tasks';
  const [preset, setPreset] = useState<Preset>(DEFAULT_PRESET);
  const [range, setRange] = useState(presetRange(DEFAULT_PRESET));
  const [dims, setDims] = useState({ assignee_id: '', sector_id: '', epic_id: '', outcome_id: '', tag_id: '', horizon: '' });
  const { data: tags } = useTags();
  const { data: users } = useUserOptions();
  const { data: sectors } = useSectors();
  const { data: epics } = useEpics();
  const { data: outcomes } = useOutcomes();

  const params = { ...range, ...dims };
  const tasksQ = useQuery({
    queryKey: ['dashboard', params],
    queryFn: () => api.get<DashboardData>(`/dashboard${qs(params)}`),
    placeholderData: (p) => p,
    enabled: kind === 'tasks',
  });
  // Na visão Outcomes, "Responsável" é o responsável do outcome; setor e outcome não se aplicam.
  const outcomeParams = { ...range, epic_id: dims.epic_id, owner_id: dims.assignee_id, horizon: dims.horizon };
  const outcomesQ = useQuery({
    queryKey: ['dashboard', 'outcomes', outcomeParams],
    queryFn: () => api.get<OutcomeDashboardData>(`/dashboard/outcomes${qs(outcomeParams)}`),
    placeholderData: (p) => p,
    enabled: kind === 'outcomes',
  });
  const { isLoading, error } = kind === 'tasks' ? tasksQ : outcomesQ;
  const period = kind === 'tasks' ? tasksQ.data?.period : outcomesQ.data?.period;

  const onPreset = (p: Preset) => {
    setPreset(p);
    if (p !== 'custom') setRange(presetRange(p));
  };
  const sel = 'input w-auto py-1 text-[13px]';
  /** Destaca o filtro quando ele está em uso (diferente do padrão). */
  const on = (active: unknown) => (active ? ' filter-active' : '');
  const setDim = (k: keyof typeof dims) => (e: { target: { value: string } }) => setDims((d) => ({ ...d, [k]: e.target.value }));

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={kind === 'tasks' ? 'Indicadores de fluxo das tarefas da área de Desenvolvimento' : 'Indicadores dos outcomes: resultados de negócio e entregas'}
        actions={
          <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5 shadow-xs" role="tablist" aria-label="Indicadores de">
            {(
              [
                ['tasks', 'Tarefas', KanbanSquare],
                ['outcomes', 'Outcomes', Target],
              ] as const
            ).map(([key, label, Icon]) => (
              <button
                key={key}
                role="tab"
                aria-selected={kind === key}
                onClick={() => setPrefs({ kind: key })}
                className={`inline-flex items-center gap-1.5 rounded px-3 py-1 text-sm font-medium ${
                  kind === key ? 'bg-blue-600 text-[#eff0eb] shadow-[0_2px_6px_0_rgba(14,14,14,0.24)]' : 'text-slate-600 hover:bg-[rgba(14,14,14,0.05)]'
                }`}
              >
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>
        }
      />
      <div className="card mb-4 flex flex-wrap items-center gap-2 p-2.5">
        <select className={sel + on(preset !== DEFAULT_PRESET)} value={preset} onChange={(e) => onPreset(e.target.value as Preset)} aria-label="Período">
          {PRESETS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
        {preset === 'custom' && (
          <>
            <input type="date" className={sel + on(true)} value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} aria-label="De" />
            <span className="text-xs text-slate-400">até</span>
            <input type="date" className={sel + on(true)} value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} aria-label="Até" />
          </>
        )}
        <span className="mx-1 h-5 w-px bg-slate-200" />
        <select className={sel + on(dims.assignee_id)} value={dims.assignee_id} onChange={setDim('assignee_id')} aria-label="Responsável">
          <option value="">Responsável: todos</option>
          {users?.filter((u) => kind === 'tasks' || u.role !== 'requester').map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        {kind === 'tasks' && (
          <select className={sel + on(dims.sector_id)} value={dims.sector_id} onChange={setDim('sector_id')} aria-label="Setor">
            <option value="">Setor: todos</option>
            {sectors?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        <select className={`${sel} max-w-48${on(dims.epic_id)}`} value={dims.epic_id} onChange={(e) => setDims((d) => ({ ...d, epic_id: e.target.value, outcome_id: '' }))} aria-label="Épico">
          <option value="">Épico: todos</option>
          {epics?.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        {kind === 'tasks' && (
          <select className={`${sel} max-w-48${on(dims.outcome_id)}`} value={dims.outcome_id} onChange={setDim('outcome_id')} aria-label="Outcome">
            <option value="">Outcome: todos</option>
            {outcomes
              ?.filter((o) => !dims.epic_id || String(o.epic_id) === dims.epic_id)
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
          </select>
        )}
        <select
          className={sel + on(dims.horizon)}
          value={dims.horizon}
          onChange={setDim('horizon')}
          aria-label="Horizonte"
          title={kind === 'tasks' ? 'Horizonte do outcome da tarefa (ou do épico, se não houver outcome)' : 'Horizonte do outcome'}
        >
          <option value="">Horizonte: todos</option>
          {HORIZON_KEYS.map((k) => (
            <option key={k} value={k}>
              {HORIZON[k].label}
            </option>
          ))}
        </select>
        {kind === 'tasks' && (
          <select className={`${sel} max-w-40${on(dims.tag_id)}`} value={dims.tag_id} onChange={setDim('tag_id')} aria-label="Tag">
            <option value="">Tag: todas</option>
            {tags?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
        {period && (
          <span className="ml-auto text-xs text-slate-500">
            {fmtDate(period.from)} – {fmtDate(period.to)}
          </span>
        )}
      </div>

      <ErrorText error={error} />
      {isLoading && <Spinner />}
      {kind === 'tasks' && tasksQ.data && <DashboardBody data={tasksQ.data} />}
      {kind === 'outcomes' && outcomesQ.data && <OutcomesBody data={outcomesQ.data} />}
    </div>
  );
}

function DashboardBody({ data }: { data: DashboardData }) {
  const series = useMemo(
    () =>
      data.series.map((s) => ({
        ...s,
        label: data.period.granularity === 'month' ? monthLabel(s.bucket) : fmtShortDate(s.bucket),
      })),
    [data],
  );
  const hasCycle = series.some((s) => s.cycle_avg !== null);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-7">
        <Kpi icon={<Clock size={16} />} label="Cycle Time médio" value={fmtDays(data.cycle_time.avg)} hint={`Mediana ${fmtDays(data.cycle_time.median)} · ${data.cycle_time.count} tarefas`} />
        <Kpi icon={<Hourglass size={16} />} label="Lead Time médio" value={fmtDays(data.lead_time.avg)} hint={`Mediana ${fmtDays(data.lead_time.median)} · ${data.lead_time.count} tarefas`} />
        <Kpi icon={<CheckCircle2 size={16} />} label="Throughput" value={String(data.throughput.count)} hint={`concluídas · ${data.throughput.per_week.toLocaleString('pt-BR')}/semana`} />
        <Kpi icon={<Inbox size={16} />} label="Tarefas criadas" value={String(data.created.count)} hint="no período" />
        <Kpi
          icon={<Layers size={16} />}
          label="WIP"
          value={String(data.wip.count)}
          hint={wipHint(data.wip_statuses)}
          title={`Tarefas abertas nos status: ${data.wip_statuses.join(', ') || 'nenhum'} (configurável em Administração → Status)`}
        />
        <Kpi
          icon={<AlertTriangle size={16} />}
          label="Atrasadas"
          value={String(data.overdue.count)}
          hint="agora, não concluídas"
          tone={data.overdue.count > 0 ? 'critical' : undefined}
        />
        <Kpi
          icon={<Flag size={16} />}
          label="Tempo médio com flag"
          value={fmtHours(data.flag_time.avg_hours)}
          hint={
            data.flag_time.periods
              ? `${data.flag_time.periods} bloqueio(s) em ${data.flag_time.tasks} tarefa(s) · ${data.flag_time.active} ativo(s) agora`
              : 'nenhum bloqueio no período'
          }
          title={`Tempo entre colocar e retirar a flag (bloqueio). Flags ainda ativas contam até agora. Mediana: ${fmtHours(data.flag_time.median_hours)}.`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Throughput: criadas × concluídas" subtitle={`Por ${data.period.granularity === 'week' ? 'semana' : 'mês'}`}>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={series} barGap={2} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={C.grid} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: C.axis }} tickLine={false} axisLine={{ stroke: C.grid }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: C.axis }} tickLine={false} axisLine={false} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(15,23,42,0.04)' }} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} formatter={(v) => <span style={{ color: C.axis }}>{v}</span>} />
              <Bar dataKey="created" name="Criadas" fill={C.created} radius={[4, 4, 0, 0]} maxBarSize={22} />
              <Bar dataKey="completed" name="Concluídas" fill={C.completed} radius={[4, 4, 0, 0]} maxBarSize={22} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Cycle Time ao longo do tempo" subtitle="Média de dias entre início real e conclusão, por período de conclusão">
          {hasCycle ? (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={series} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={C.grid} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: C.axis }} tickLine={false} axisLine={{ stroke: C.grid }} />
                <YAxis tick={{ fontSize: 11, fill: C.axis }} tickLine={false} axisLine={false} unit="d" />
                <Tooltip content={<ChartTooltip unit=" dias" />} />
                {data.cycle_time.median != null && (
                  <ReferenceLine
                    y={data.cycle_time.median}
                    stroke={C.axis}
                    strokeDasharray="4 4"
                    label={{ value: `Mediana do período: ${fmtDays(data.cycle_time.median)}`, position: 'insideBottomLeft', fontSize: 11, fill: C.axis }}
                  />
                )}
                <Line
                  dataKey="cycle_avg"
                  name="Cycle Time médio"
                  stroke={C.avg}
                  strokeWidth={2}
                  dot={{ r: 4, fill: C.avg, stroke: '#fff', strokeWidth: 2 }}
                  activeDot={{ r: 6 }}
                  connectNulls
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <NoData />
          )}
        </ChartCard>

        <ChartCard
          title="Tempo médio em cada coluna"
          subtitle="Dias que cada tarefa passou em cada status (somando idas e voltas), para tarefas que saíram do status no período"
          className="lg:col-span-2"
        >
          {data.time_in_status.length ? (
            <ResponsiveContainer width="100%" height={Math.max(140, data.time_in_status.length * 44)}>
              <BarChart data={data.time_in_status} layout="vertical" margin={{ top: 0, right: 56, left: 8, bottom: 0 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 12, fill: '#2e2e2c' }} tickLine={false} axisLine={false} />
                <Tooltip content={<TimeInStatusTooltip />} cursor={{ fill: 'rgba(15,23,42,0.04)' }} />
                <Bar
                  dataKey="avg_days"
                  name="Tempo médio"
                  radius={[0, 4, 4, 0]}
                  maxBarSize={22}
                  isAnimationActive={false}
                  label={{ position: 'right', fontSize: 12, fill: '#2e2e2c', formatter: (v: unknown) => fmtDays(v as number) }}
                >
                  {data.time_in_status.map((s) => (
                    <Cell key={s.status_id} fill={s.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[140px] items-center justify-center text-sm text-slate-400">Sem movimentações de status no período.</div>
          )}
        </ChartCard>

        <ChartCard title="Distribuição por status" subtitle="Situação atual das tarefas (com os filtros aplicados)">
          <ResponsiveContainer width="100%" height={Math.max(160, data.status_distribution.length * 40)}>
            <BarChart data={data.status_distribution} layout="vertical" margin={{ top: 0, right: 32, left: 8, bottom: 0 }}>
              <XAxis type="number" hide allowDecimals={false} />
              <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 12, fill: '#2e2e2c' }} tickLine={false} axisLine={false} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(15,23,42,0.04)' }} />
              <Bar dataKey="count" name="Tarefas" radius={[0, 4, 4, 0]} maxBarSize={22} label={{ position: 'right', fontSize: 12, fill: '#2e2e2c' }}>
                {data.status_distribution.map((s) => (
                  <Cell key={s.status_id} fill={s.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Tarefas por tag" subtitle="Abertas agora × concluídas no período (com os filtros aplicados)">
          {data.by_tag.length ? (
            <ResponsiveContainer width="100%" height={Math.max(160, data.by_tag.length * 40 + 30)}>
              <BarChart data={data.by_tag} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
                <XAxis type="number" hide allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 12, fill: '#2e2e2c' }} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(15,23,42,0.04)' }} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} formatter={(v) => <span style={{ color: C.axis }}>{v}</span>} />
                <Bar dataKey="open" name="Abertas" stackId="t" fill={C.created} maxBarSize={22} isAnimationActive={false} />
                <Bar dataKey="completed" name="Concluídas no período" stackId="t" fill={C.completed} radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[160px] items-center justify-center text-sm text-slate-400">Nenhuma tarefa com tag nos filtros aplicados.</div>
          )}
        </ChartCard>

        <ChartCard title="Aging das tarefas abertas" subtitle="Dias desde o início real (ou criação, se ainda não iniciada)" className="lg:col-span-2">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.aging} margin={{ top: 16, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={C.grid} />
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: C.axis }} tickLine={false} axisLine={{ stroke: C.grid }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: C.axis }} tickLine={false} axisLine={false} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(15,23,42,0.04)' }} />
              <Bar dataKey="count" name="Tarefas" radius={[4, 4, 0, 0]} maxBarSize={56} label={{ position: 'top', fontSize: 12, fill: '#2e2e2c' }}>
                {data.aging.map((a, i) => (
                  <Cell key={a.key} fill={C.aging[i]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
      <p className="text-xs text-slate-400">
        Cycle Time, Lead Time, Throughput, Criadas e Tempo em cada coluna consideram o período selecionado. WIP, Atrasadas, Aging e Distribuição por status
        são o retrato atual. Fórmulas detalhadas em docs/ARQUITETURA.md.
      </p>
    </div>
  );
}

function OutcomesBody({ data }: { data: OutcomeDashboardData }) {
  const ind = data.indicator;
  const val = (v: number | null, unit: string | null) => (v == null ? '—' : `${fmtNumber(v)}${unit ? ` ${unit}` : ''}`);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi icon={<Target size={16} />} label="Outcomes abertos" value={String(data.open)} hint={`de ${data.total} ativos`} />
        <Kpi icon={<CheckCircle2 size={16} />} label="Concluídos" value={String(data.completed)} hint={`${data.created} criado(s) no período`} />
        <Kpi
          icon={<Gauge size={16} />}
          label="Progresso médio do indicador"
          value={ind.avg_progress_open == null ? '—' : `${ind.avg_progress_open}%`}
          hint={`${ind.open_measured} aberto(s) medido(s)${ind.open_without_indicator ? ` · ${ind.open_without_indicator} sem indicador` : ''}`}
          title="Quanto do caminho Atual → Meta o Resultado dos outcomes abertos já percorreu (média)."
        />
        <Kpi icon={<Trophy size={16} />} label="Meta atingida" value={String(ind.reached)} hint={`de ${ind.measured} com indicador completo`} />
        <Kpi
          icon={<AlertTriangle size={16} />}
          label="Atrasados"
          value={String(data.overdue)}
          hint="abertos com data alvo vencida"
          tone={data.overdue > 0 ? 'critical' : undefined}
        />
        <Kpi
          icon={<Flag size={16} />}
          label="Tempo médio com flag"
          value={fmtHours(data.flag_time.avg_hours)}
          hint={`${data.flag_time.periods ? `${data.flag_time.periods} bloqueio(s)` : 'nenhum bloqueio no período'} · ${data.flagged_now} com flag agora`}
          title="Tempo entre colocar e retirar a flag (bloqueio) dos outcomes. Flags ainda ativas contam até agora."
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Progresso do indicador" subtitle="Outcomes abertos: quanto do caminho Atual → Meta o Resultado já percorreu" className="lg:col-span-2">
          {data.progress.length ? (
            <ResponsiveContainer width="100%" height={Math.max(140, data.progress.length * 40)}>
              <BarChart data={data.progress} layout="vertical" margin={{ top: 0, right: 48, left: 8, bottom: 0 }}>
                <XAxis type="number" hide domain={[0, 100]} />
                <YAxis type="category" dataKey="name" width={240} tick={{ fontSize: 12, fill: '#2e2e2c' }} tickLine={false} axisLine={false} />
                <Tooltip
                  cursor={{ fill: 'rgba(15,23,42,0.04)' }}
                  content={({ active, payload }) => {
                    const p = active ? (payload?.[0]?.payload as OutcomeDashboardData['progress'][number] | undefined) : undefined;
                    if (!p) return null;
                    return (
                      <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
                        <div className="font-medium text-slate-900">{p.name}</div>
                        <div className="mb-1 text-slate-500">Épico: {p.epic_name}</div>
                        <div className="text-slate-600">
                          {p.indicator_name}: atual {val(p.baseline, p.unit)} → meta {val(p.target, p.unit)} · resultado{' '}
                          <b className="text-slate-900">{val(p.current, p.unit)}</b>
                        </div>
                        <div className="text-slate-600">
                          Progresso: <b className="text-slate-900">{p.progress}%</b>
                        </div>
                      </div>
                    );
                  }}
                />
                <Bar
                  dataKey="progress"
                  radius={[0, 4, 4, 0]}
                  maxBarSize={22}
                  isAnimationActive={false}
                  label={{ position: 'right', fontSize: 12, fill: '#2e2e2c', formatter: (v: unknown) => `${v}%` }}
                >
                  {data.progress.map((p) => (
                    <Cell key={p.id} fill={outcomeColor(p.color).dot} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[140px] items-center justify-center text-sm text-slate-400">
              Nenhum outcome aberto com indicador completo (atual, meta e resultado).
            </div>
          )}
        </ChartCard>

        <ChartCard title="Entregas por outcome" subtitle="Tarefas concluídas × em aberto dos outcomes abertos">
          {data.deliveries.length ? (
            <ResponsiveContainer width="100%" height={Math.max(160, data.deliveries.length * 40 + 30)}>
              <BarChart data={data.deliveries} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
                <XAxis type="number" hide allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={180} tick={{ fontSize: 12, fill: '#2e2e2c' }} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(15,23,42,0.04)' }} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} formatter={(v) => <span style={{ color: C.axis }}>{v}</span>} />
                <Bar dataKey="done" name="Concluídas" stackId="t" fill={C.completed} maxBarSize={22} isAnimationActive={false} />
                <Bar dataKey="open" name="Em aberto" stackId="t" fill={C.created} radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[160px] items-center justify-center text-sm text-slate-400">Nenhum outcome aberto com tarefas.</div>
          )}
        </ChartCard>

        <ChartCard title="Distribuição por status" subtitle="Situação atual dos outcomes (com os filtros aplicados)">
          {data.status_distribution.length ? (
            <ResponsiveContainer width="100%" height={Math.max(160, data.status_distribution.length * 40)}>
              <BarChart data={data.status_distribution} layout="vertical" margin={{ top: 0, right: 32, left: 8, bottom: 0 }}>
                <XAxis type="number" hide allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 12, fill: '#2e2e2c' }} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(15,23,42,0.04)' }} />
                <Bar dataKey="count" name="Outcomes" radius={[0, 4, 4, 0]} maxBarSize={22} label={{ position: 'right', fontSize: 12, fill: '#2e2e2c' }}>
                  {data.status_distribution.map((s) => (
                    <Cell key={s.status_id} fill={s.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[160px] items-center justify-center text-sm text-slate-400">Nenhum outcome com os filtros aplicados.</div>
          )}
        </ChartCard>
      </div>
      <p className="text-xs text-slate-400">
        "Criados no período" e "Tempo médio com flag" consideram o período selecionado; os demais indicadores são o retrato atual dos outcomes ativos.
      </p>
    </div>
  );
}

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const monthLabel = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]}/${d.slice(2, 4)}`;

function wipHint(statuses: string[]) {
  if (statuses.length === 0) return 'nenhum status conta no WIP';
  if (statuses.length === 1) return `abertas em ${statuses[0]}`;
  return `abertas de ${statuses[0]} a ${statuses[statuses.length - 1]}`;
}

function TimeInStatusTooltip({ active, payload }: { active?: boolean; payload?: { payload?: DashboardData['time_in_status'][number] }[] }) {
  const s = active ? payload?.[0]?.payload : undefined;
  if (!s) return null;
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 flex items-center gap-2 font-medium text-slate-900">
        <span className="size-2 rounded-full" style={{ background: s.color }} />
        {s.name}
      </div>
      <div className="text-slate-600">
        Média: <b className="text-slate-900">{fmtDays(s.avg_days)}</b>
      </div>
      <div className="text-slate-600">
        Mediana: <b className="text-slate-900">{fmtDays(s.median_days)}</b>
      </div>
      <div className="text-slate-600">
        Tarefas: <b className="text-slate-900">{s.tasks}</b>
      </div>
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  hint,
  tone,
  title,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint: string;
  tone?: 'critical';
  title?: string;
}) {
  return (
    <div title={title} className={`card p-3.5 ${tone === 'critical' ? 'border-red-200 bg-red-50/60' : ''}`}>
      <div className={`mb-1 flex items-center gap-1.5 text-xs font-medium ${tone === 'critical' ? 'text-red-700' : 'text-slate-500'}`}>
        {icon}
        {label}
      </div>
      <div className={`text-2xl font-semibold tabular-nums ${tone === 'critical' ? 'text-red-700' : 'text-slate-900'}`}>{value}</div>
      <div className="mt-0.5 text-xs text-slate-500">{hint}</div>
    </div>
  );
}

function ChartCard({ title, subtitle, children, className = '' }: { title: string; subtitle?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`card p-4 ${className}`}>
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      {subtitle && <p className="mb-3 text-xs text-slate-500">{subtitle}</p>}
      {children}
    </section>
  );
}

function NoData() {
  return <div className="flex h-[260px] items-center justify-center text-sm text-slate-400">Sem tarefas concluídas no período.</div>;
}

interface TooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: { name?: string; value?: number | null; color?: string; payload?: Record<string, unknown> }[];
  unit?: string;
}
function ChartTooltip({ active, payload, label, unit = '' }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const title = label ?? (payload[0].payload?.name as string) ?? (payload[0].payload?.label as string);
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-medium text-slate-900">{title}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 text-slate-600">
          <span className="size-2 rounded-full" style={{ background: p.color ?? (p.payload?.color as string) }} />
          {p.name}: <b className="text-slate-900">{p.value == null ? '—' : `${p.value.toLocaleString('pt-BR')}${unit}`}</b>
        </div>
      ))}
    </div>
  );
}
