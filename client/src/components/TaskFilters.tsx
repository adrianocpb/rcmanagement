import { FilterX, Search } from 'lucide-react';
import { PRIORITY, PRIORITY_KEYS } from '../lib/format';
import { useEpics, useOutcomes, useSectors, useStatuses, useUserOptions } from '../lib/queries';

export interface TaskFilterValues {
  q: string;
  status_id: string;
  assignee_id: string;
  requester_id: string;
  sector_id: string;
  priority: string;
  epic_id: string;
  outcome_id: string;
  period_field: string;
  from: string;
  to: string;
  overdue: boolean;
}

export const EMPTY_FILTERS: TaskFilterValues = {
  q: '',
  status_id: '',
  assignee_id: '',
  requester_id: '',
  sector_id: '',
  priority: '',
  epic_id: '',
  outcome_id: '',
  period_field: 'planned_end',
  from: '',
  to: '',
  overdue: false,
};

export function activeFilterCount(f: TaskFilterValues) {
  return Object.entries(f).filter(([k, v]) => k !== 'period_field' && v !== '' && v !== false).length;
}

export function TaskFilters({
  value,
  onChange,
}: {
  value: TaskFilterValues;
  onChange: (v: TaskFilterValues) => void;
}) {
  const { data: statuses } = useStatuses();
  const { data: users } = useUserOptions();
  const { data: sectors } = useSectors();
  const { data: epics } = useEpics();
  const { data: outcomes } = useOutcomes();
  const set = (k: keyof TaskFilterValues) => (e: { target: { value: string } }) => {
    const next = { ...value, [k]: e.target.value };
    if (k === 'epic_id' && value.outcome_id) {
      const o = outcomes?.find((x) => String(x.id) === value.outcome_id);
      if (o && String(o.epic_id) !== e.target.value && e.target.value) next.outcome_id = '';
    }
    onChange(next);
  };
  const sel = 'input w-auto min-w-0 py-1 text-[13px]';
  /** Destaca o filtro quando ele está em uso. */
  const on = (active: unknown) => (active ? ' filter-active' : '');
  const count = activeFilterCount(value);

  return (
    <div className="card mb-4 flex flex-wrap items-center gap-2 p-2.5">
      <div className="relative">
        <Search size={14} className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-slate-400" />
        <input className={`input w-44 py-1 pl-7 text-[13px]${on(value.q)}`} placeholder="Buscar título…" value={value.q} onChange={set('q')} />
      </div>
      <select className={sel + on(value.status_id)} value={value.status_id} onChange={set('status_id')} aria-label="Status">
        <option value="">Status: todos</option>
        {statuses?.filter((s) => s.active).map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <select className={sel + on(value.assignee_id)} value={value.assignee_id} onChange={set('assignee_id')} aria-label="Responsável">
        <option value="">Responsável: todos</option>
        {users?.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>
      <select className={sel + on(value.requester_id)} value={value.requester_id} onChange={set('requester_id')} aria-label="Solicitante">
        <option value="">Solicitante: todos</option>
        {users?.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>
      <select className={sel + on(value.sector_id)} value={value.sector_id} onChange={set('sector_id')} aria-label="Setor">
        <option value="">Setor: todos</option>
        {sectors?.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <select className={sel + on(value.priority)} value={value.priority} onChange={set('priority')} aria-label="Prioridade">
        <option value="">Prioridade: todas</option>
        {PRIORITY_KEYS.map((k) => (
          <option key={k} value={k}>
            {PRIORITY[k].label}
          </option>
        ))}
      </select>
      <select className={`${sel} max-w-44${on(value.epic_id)}`} value={value.epic_id} onChange={set('epic_id')} aria-label="Épico">
        <option value="">Épico: todos</option>
        {epics?.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
      </select>
      <select className={`${sel} max-w-44${on(value.outcome_id)}`} value={value.outcome_id} onChange={set('outcome_id')} aria-label="Outcome">
        <option value="">Outcome: todos</option>
        {outcomes
          ?.filter((o) => !value.epic_id || String(o.epic_id) === value.epic_id)
          .map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
      </select>
      <div
        className={`flex max-w-full flex-wrap items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5${on(value.from || value.to)}`}
      >
        <select
          className="bg-transparent py-0.5 text-[13px] text-slate-600 outline-none"
          value={value.period_field}
          onChange={set('period_field')}
          aria-label="Campo do período"
        >
          <option value="planned_end">Prazo</option>
          <option value="created">Criação</option>
          <option value="completed">Conclusão</option>
        </select>
        <input type="date" className="input w-auto py-0.5 text-[13px]" value={value.from} onChange={set('from')} aria-label="De" />
        <span className="text-xs text-slate-400">até</span>
        <input type="date" className="input w-auto py-0.5 text-[13px]" value={value.to} onChange={set('to')} aria-label="Até" />
      </div>
      <label
        className={`flex cursor-pointer items-center gap-1.5 rounded-md border border-transparent px-1.5 py-1 text-[13px] text-slate-700 select-none hover:bg-slate-50${on(value.overdue)}`}
      >
        <input
          type="checkbox"
          className="accent-red-600"
          checked={value.overdue}
          onChange={(e) => onChange({ ...value, overdue: e.target.checked })}
        />
        Somente atrasadas
      </label>
      {count > 0 && (
        <button className="btn-ghost ml-auto py-1 text-[13px]" onClick={() => onChange(EMPTY_FILTERS)}>
          <FilterX size={14} /> Limpar ({count})
        </button>
      )}
    </div>
  );
}
