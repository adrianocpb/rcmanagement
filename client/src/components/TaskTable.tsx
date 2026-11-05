import type { Task } from '../lib/api';
import { PRIORITY, fmtDate, fmtDateOfInstant, fmtNumber } from '../lib/format';
import { useTaskModal } from './TaskModal';
import { DataTable, type Column } from './DataTable';
import { DeadlineBadge, OutcomeTag, PriorityBadge, StatusPill } from './ui';

const COLUMNS: Column<Task>[] = [
  { key: 'title', label: 'Título', sort: (t) => t.title.toLowerCase(), render: (t) => <span className="font-medium text-slate-900">{t.title}</span>, className: 'min-w-56', wrap: true },
  { key: 'status', label: 'Status', sort: (t) => t.status_name, render: (t) => <StatusPill name={t.status_name} color={t.status_color} /> },
  { key: 'priority', label: 'Prioridade', sort: (t) => PRIORITY[t.priority].order, render: (t) => <PriorityBadge priority={t.priority} /> },
  { key: 'sector', label: 'Setor', sort: (t) => t.sector_name, render: (t) => t.sector_name },
  { key: 'requester', label: 'Solicitante', sort: (t) => t.requester_name, render: (t) => t.requester_name },
  { key: 'assignee', label: 'Responsável', sort: (t) => t.assignee_name, render: (t) => t.assignee_name },
  { key: 'outcome', label: 'Outcome', sort: (t) => t.outcome_name, render: (t) => (t.outcome_name ? <OutcomeTag name={t.outcome_name} color={t.outcome_color} clamp /> : <span className="text-slate-600">—</span>), className: 'min-w-44' },
  {
    key: 'created',
    label: 'Criada em',
    sort: (t) => t.created_at,
    render: (t) => fmtDateOfInstant(t.created_at),
    defaultDir: -1,
  },
  { key: 'planned_start', label: 'Início prev.', sort: (t) => t.planned_start_date, render: (t) => fmtDate(t.planned_start_date) },
  {
    key: 'planned_end',
    label: 'Conclusão prev.',
    sort: (t) => t.planned_end_date,
    render: (t) => <span className={t.is_overdue ? 'font-semibold text-red-600' : ''}>{fmtDate(t.planned_end_date)}</span>,
  },
  { key: 'completed', label: 'Conclusão real', sort: (t) => t.completed_at, render: (t) => fmtDateOfInstant(t.completed_at) },
  { key: 'hours', label: 'Estim. (h)', sort: (t) => t.estimated_hours, render: (t) => fmtNumber(t.estimated_hours) },
  { key: 'deadline', label: 'Prazo', sort: (t) => (t.is_overdue ? 0 : t.deadline_state === 'concluida_com_atraso' ? 1 : 2), render: (t) => <DeadlineBadge state={t.deadline_state} /> },
];

export function TaskTable({ tasks, hide = [] }: { tasks: Task[]; hide?: string[] }) {
  const { open } = useTaskModal();
  return (
    <DataTable
      rows={tasks}
      columns={COLUMNS.filter((c) => !hide.includes(c.key))}
      defaultSort={{ key: 'planned_end', dir: 1 }}
      onRowClick={(t) => open(t.id)}
      rowClassName={(t) => (t.is_overdue ? 'bg-red-50/40' : '')}
      empty="Nenhuma tarefa encontrada com os filtros atuais."
      count={(n) => `${n} tarefa(s)`}
    />
  );
}
