import { ArrowDown, ArrowUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Task } from '../lib/api';
import { PRIORITY, fmtDate, fmtDateTime, fmtNumber } from '../lib/format';
import { useTaskModal } from './TaskModal';
import { DeadlineBadge, EmptyState, PriorityBadge, StatusPill } from './ui';

type Col = {
  key: string;
  label: string;
  sort?: (t: Task) => string | number | null;
  render: (t: Task) => React.ReactNode;
  className?: string;
};

const COLUMNS: Col[] = [
  { key: 'title', label: 'Título', sort: (t) => t.title.toLowerCase(), render: (t) => <span className="font-medium text-slate-900">{t.title}</span>, className: 'min-w-56' },
  { key: 'status', label: 'Status', sort: (t) => t.status_name, render: (t) => <StatusPill name={t.status_name} color={t.status_color} /> },
  { key: 'priority', label: 'Prioridade', sort: (t) => PRIORITY[t.priority].order, render: (t) => <PriorityBadge priority={t.priority} /> },
  { key: 'sector', label: 'Setor', sort: (t) => t.sector_name, render: (t) => t.sector_name },
  { key: 'requester', label: 'Solicitante', sort: (t) => t.requester_name, render: (t) => t.requester_name },
  { key: 'assignee', label: 'Responsável', sort: (t) => t.assignee_name, render: (t) => t.assignee_name },
  { key: 'outcome', label: 'Outcome', sort: (t) => t.outcome_name, render: (t) => <span className="text-slate-600">{t.outcome_name ?? '—'}</span>, className: 'min-w-44' },
  { key: 'planned_start', label: 'Início prev.', sort: (t) => t.planned_start_date, render: (t) => fmtDate(t.planned_start_date) },
  {
    key: 'planned_end',
    label: 'Conclusão prev.',
    sort: (t) => t.planned_end_date,
    render: (t) => <span className={t.is_overdue ? 'font-semibold text-red-600' : ''}>{fmtDate(t.planned_end_date)}</span>,
  },
  { key: 'completed', label: 'Conclusão real', sort: (t) => t.completed_at, render: (t) => (t.completed_at ? fmtDateTime(t.completed_at).slice(0, 10) : '—') },
  { key: 'hours', label: 'Estim. (h)', sort: (t) => t.estimated_hours, render: (t) => fmtNumber(t.estimated_hours) },
  { key: 'deadline', label: 'Prazo', sort: (t) => (t.is_overdue ? 0 : t.deadline_state === 'concluida_com_atraso' ? 1 : 2), render: (t) => <DeadlineBadge state={t.deadline_state} /> },
];

export function TaskTable({ tasks, hide = [] }: { tasks: Task[]; hide?: string[] }) {
  const columns = COLUMNS.filter((c) => !hide.includes(c.key));
  const { open } = useTaskModal();
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'planned_end', dir: 1 });

  const sorted = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sort.key);
    if (!col?.sort) return tasks;
    return [...tasks].sort((a, b) => {
      const va = col.sort!(a);
      const vb = col.sort!(b);
      if (va === vb) return 0;
      if (va === null || va === '') return 1; // vazios sempre no fim
      if (vb === null || vb === '') return -1;
      return (va < vb ? -1 : 1) * sort.dir;
    });
  }, [tasks, sort]);

  if (tasks.length === 0) return <EmptyState>Nenhuma tarefa encontrada com os filtros atuais.</EmptyState>;

  return (
    <div className="card overflow-x-auto">
      <table className="w-full border-collapse">
        <thead className="border-b border-slate-200 bg-slate-50">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={`th ${c.className ?? ''}`}>
                <button
                  className="inline-flex items-center gap-1 uppercase hover:text-slate-800"
                  onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? (s.dir === 1 ? -1 : 1) : 1 }))}
                >
                  {c.label}
                  {sort.key === c.key && (sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((t) => (
            <tr
              key={t.id}
              onClick={() => open(t.id)}
              className={`cursor-pointer border-b border-slate-100 last:border-0 hover:bg-blue-50/50 ${t.is_overdue ? 'bg-red-50/40' : ''}`}
            >
              {columns.map((c) => (
                <td key={c.key} className={`td ${c.key === 'title' ? '' : 'whitespace-nowrap'}`}>
                  {c.render(t)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-slate-200 px-3 py-2 text-xs text-slate-500">{tasks.length} tarefa(s)</div>
    </div>
  );
}
