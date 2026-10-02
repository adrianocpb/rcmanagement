import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Clock, Hourglass, Inbox, Layers } from 'lucide-react';
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
import { api, qs, type DashboardData } from '../lib/api';
import { addDays, fmtDate, fmtDays, fmtShortDate, todayLocal } from '../lib/format';
import { useEpics, useOutcomes, useSectors, useUserOptions } from '../lib/queries';

// Paleta categórica validada (ver skill de dataviz): slot 1 azul, 2 laranja, 3 verde-água.
const C = {
  created: '#2a78d6',
  completed: '#1baf7a',
  avg: '#2a78d6',
  aging: ['#86b6ef', '#3987e5', '#256abf', '#0d366b'],
  grid: '#e7e6e2',
  axis: '#6b6a66',
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

export function DashboardPage() {
  const [preset, setPreset] = useState<Preset>('90');
  const [range, setRange] = useState(presetRange('90'));
  const [granularity, setGranularity] = useState<'week' | 'month'>('week');
  const [dims, setDims] = useState({ assignee_id: '', sector_id: '', epic_id: '', outcome_id: '' });
  const { data: users } = useUserOptions();
  const { data: sectors } = useSectors();
  const { data: epics } = useEpics();
  const { data: outcomes } = useOutcomes();

  const params = { ...range, granularity, ...dims };
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard', params],
    queryFn: () => api.get<DashboardData>(`/dashboard${qs(params)}`),
    placeholderData: (p) => p,
  });

  const onPreset = (p: Preset) => {
    setPreset(p);
    if (p !== 'custom') setRange(presetRange(p));
    if (p === 'week') setGranularity('week');
  };
  const sel = 'input w-auto py-1 text-[13px]';
  const setDim = (k: keyof typeof dims) => (e: { target: { value: string } }) => setDims((d) => ({ ...d, [k]: e.target.value }));

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Indicadores de fluxo da área de Desenvolvimento" />
      <div className="card mb-4 flex flex-wrap items-center gap-2 p-2.5">
        <select className={sel} value={preset} onChange={(e) => onPreset(e.target.value as Preset)} aria-label="Período">
          {PRESETS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
        {preset === 'custom' && (
          <>
            <input type="date" className={sel} value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} aria-label="De" />
            <span className="text-xs text-slate-400">até</span>
            <input type="date" className={sel} value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} aria-label="Até" />
          </>
        )}
        <div className="inline-flex rounded-md border border-slate-300 p-0.5">
          {(['week', 'month'] as const).map((g) => (
            <button
              key={g}
              onClick={() => setGranularity(g)}
              className={`rounded px-2.5 py-0.5 text-[13px] font-medium ${granularity === g ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              {g === 'week' ? 'Semanal' : 'Mensal'}
            </button>
          ))}
        </div>
        <span className="mx-1 h-5 w-px bg-slate-200" />
        <select className={sel} value={dims.assignee_id} onChange={setDim('assignee_id')} aria-label="Responsável">
          <option value="">Responsável: todos</option>
          {users?.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <select className={sel} value={dims.sector_id} onChange={setDim('sector_id')} aria-label="Setor">
          <option value="">Setor: todos</option>
          {sectors?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select className={`${sel} max-w-48`} value={dims.epic_id} onChange={(e) => setDims((d) => ({ ...d, epic_id: e.target.value, outcome_id: '' }))} aria-label="Épico">
          <option value="">Épico: todos</option>
          {epics?.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <select className={`${sel} max-w-48`} value={dims.outcome_id} onChange={setDim('outcome_id')} aria-label="Outcome">
          <option value="">Outcome: todos</option>
          {outcomes
            ?.filter((o) => !dims.epic_id || String(o.epic_id) === dims.epic_id)
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
        </select>
        {data && (
          <span className="ml-auto text-xs text-slate-500">
            {fmtDate(data.period.from)} – {fmtDate(data.period.to)}
          </span>
        )}
      </div>

      <ErrorText error={error} />
      {isLoading && <Spinner />}
      {data && <DashboardBody data={data} />}
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
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi icon={<Clock size={16} />} label="Cycle Time médio" value={fmtDays(data.cycle_time.avg)} hint={`Mediana ${fmtDays(data.cycle_time.median)} · ${data.cycle_time.count} tarefas`} />
        <Kpi icon={<Hourglass size={16} />} label="Lead Time médio" value={fmtDays(data.lead_time.avg)} hint={`Mediana ${fmtDays(data.lead_time.median)} · ${data.lead_time.count} tarefas`} />
        <Kpi icon={<CheckCircle2 size={16} />} label="Throughput" value={String(data.throughput.count)} hint={`concluídas · ${data.throughput.per_week.toLocaleString('pt-BR')}/semana`} />
        <Kpi icon={<Inbox size={16} />} label="Tarefas criadas" value={String(data.created.count)} hint="no período" />
        <Kpi icon={<Layers size={16} />} label="WIP" value={String(data.wip.count)} hint={`não concluídas · ${data.wip.started} iniciadas`} />
        <Kpi
          icon={<AlertTriangle size={16} />}
          label="Atrasadas"
          value={String(data.overdue.count)}
          hint="agora, não concluídas"
          tone={data.overdue.count > 0 ? 'critical' : undefined}
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
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
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

        <ChartCard title="Distribuição por status" subtitle="Situação atual das tarefas (com os filtros aplicados)">
          <ResponsiveContainer width="100%" height={Math.max(160, data.status_distribution.length * 40)}>
            <BarChart data={data.status_distribution} layout="vertical" margin={{ top: 0, right: 32, left: 8, bottom: 0 }}>
              <XAxis type="number" hide allowDecimals={false} />
              <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 12, fill: '#334155' }} tickLine={false} axisLine={false} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(15,23,42,0.04)' }} />
              <Bar dataKey="count" name="Tarefas" radius={[0, 4, 4, 0]} maxBarSize={22} label={{ position: 'right', fontSize: 12, fill: '#334155' }}>
                {data.status_distribution.map((s) => (
                  <Cell key={s.status_id} fill={s.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Aging das tarefas abertas" subtitle="Dias desde o início real (ou criação, se ainda não iniciada)">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.aging} margin={{ top: 16, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={C.grid} />
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: C.axis }} tickLine={false} axisLine={{ stroke: C.grid }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: C.axis }} tickLine={false} axisLine={false} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(15,23,42,0.04)' }} />
              <Bar dataKey="count" name="Tarefas" radius={[4, 4, 0, 0]} maxBarSize={56} label={{ position: 'top', fontSize: 12, fill: '#334155' }}>
                {data.aging.map((a, i) => (
                  <Cell key={a.key} fill={C.aging[i]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
      <p className="text-xs text-slate-400">
        Cycle Time, Lead Time, Throughput e Criadas consideram o período selecionado. WIP, Atrasadas, Aging e Distribuição por status
        são o retrato atual. Fórmulas detalhadas em docs/ARQUITETURA.md.
      </p>
    </div>
  );
}

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const monthLabel = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]}/${d.slice(2, 4)}`;

function Kpi({ icon, label, value, hint, tone }: { icon: ReactNode; label: string; value: string; hint: string; tone?: 'critical' }) {
  return (
    <div className={`card p-3.5 ${tone === 'critical' ? 'border-red-200 bg-red-50/60' : ''}`}>
      <div className={`mb-1 flex items-center gap-1.5 text-xs font-medium ${tone === 'critical' ? 'text-red-700' : 'text-slate-500'}`}>
        {icon}
        {label}
      </div>
      <div className={`text-2xl font-semibold tabular-nums ${tone === 'critical' ? 'text-red-700' : 'text-slate-900'}`}>{value}</div>
      <div className="mt-0.5 text-xs text-slate-500">{hint}</div>
    </div>
  );
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="card p-4">
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
