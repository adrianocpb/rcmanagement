import { AlertCircle, CalendarDays, MessageSquare } from 'lucide-react';
import { api, type Status, type Task } from '../lib/api';
import { fmtShortDate, PRIORITY } from '../lib/format';
import { Board, BoardCard, byBoardPosition } from './Board';
import { FlagBadge } from './Flag';
import { useInvalidateTasks, useTaskModal } from './TaskModal';
import { Avatar, DeadlineBadge, OutcomeTag, PriorityBadge, TagChip } from './ui';

/** Ordem dos cards dentro de cada coluna. "manual" = ordem definida arrastando (a do PO). */
export type CardSort = 'manual' | 'priority' | 'due' | 'created';
export const CARD_SORT_OPTIONS: { key: CardSort; label: string }[] = [
  { key: 'manual', label: 'Ordem do quadro (arrastar para priorizar)' },
  { key: 'priority', label: 'Prioridade e prazo' },
  { key: 'due', label: 'Conclusão prevista (mais próxima primeiro)' },
  { key: 'created', label: 'Data de criação (mais recente primeiro)' },
];
export const isCardSort = (v: unknown): v is CardSort => CARD_SORT_OPTIONS.some((o) => o.key === v);

const byDue = (a: Task, b: Task) =>
  (a.planned_end_date == null ? 1 : 0) - (b.planned_end_date == null ? 1 : 0) ||
  (a.planned_end_date ?? '').localeCompare(b.planned_end_date ?? '');

export function sortCards(list: Task[], sort: CardSort): Task[] {
  if (sort === 'manual') return byBoardPosition(list);
  const l = [...list];
  if (sort === 'due') return l.sort((a, b) => byDue(a, b) || a.id - b.id);
  if (sort === 'created') return l.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return l.sort((a, b) => PRIORITY[a.priority].order - PRIORITY[b.priority].order || byDue(a, b) || a.id - b.id);
}

/** Quadro das tarefas. */
export function Kanban({
  tasks,
  statuses,
  queryKey,
  sort = 'manual',
  statusFilter,
}: {
  tasks: Task[];
  statuses: Status[];
  queryKey: unknown[];
  sort?: CardSort;
  /** Filtro de status ativo: mostra somente a coluna desse status. */
  statusFilter?: number;
}) {
  const invalidate = useInvalidateTasks();
  const { open } = useTaskModal();
  const manual = sort === 'manual';
  return (
    <Board
      items={tasks}
      statuses={statuses}
      queryKey={queryKey}
      manual={manual}
      sortColumn={(l) => sortCards(l, sort)}
      move={({ id, status_id, before_id }) =>
        manual ? api.patch(`/tasks/${id}/position`, { status_id, before_id }) : api.patch(`/tasks/${id}/status`, { status_id })
      }
      onSettled={invalidate}
      renderCard={(t, overlay) => <Card task={t} overlay={overlay} />}
      onOpen={(t) => open(t.id)}
      onAdd={(statusId) => open('new', { status_id: statusId })}
      noun={{ one: 'tarefa', many: 'tarefas' }}
      columnBadge={(list) => {
        const overdue = list.filter((t) => t.is_overdue).length;
        return (
          overdue > 0 && (
            <span
              className="inline-flex shrink-0 items-center gap-0.5 rounded bg-red-50 px-1.5 text-xs font-medium text-red-700"
              title={`${overdue} tarefa(s) atrasada(s)`}
            >
              <AlertCircle size={11} /> {overdue}
            </span>
          )
        );
      }}
      statusFilter={statusFilter}
    />
  );
}

export function Card({ task, overlay }: { task: Task; overlay?: boolean }) {
  const late = task.is_overdue;
  return (
    <BoardCard overlay={overlay} alert={late}>
      <div className="mb-1.5 flex items-start gap-2">
        <h3 className="flex-1 text-sm leading-snug font-medium text-slate-700">{task.title}</h3>
        <Avatar name={task.assignee_name} id={task.assignee_id} />
      </div>
      {task.outcome_name && (
        <div className="mb-1.5">
          <OutcomeTag name={task.outcome_name} color={task.outcome_color} clamp />
        </div>
      )}
      {task.tags.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {task.tags.map((t) => (
            <TagChip key={t.id} name={t.name} color={t.color} />
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <FlagBadge item={task} />
        <PriorityBadge priority={task.priority} />
        <span className="rounded bg-[rgba(107,107,102,0.16)] px-1.5 py-0.5 text-xs text-slate-600">{task.sector_name}</span>
        {(task.deadline_state === 'atrasada' ||
          task.deadline_state === 'concluida_com_atraso' ||
          task.deadline_state === 'cancelada') && (
          <DeadlineBadge state={task.deadline_state} />
        )}
        {task.comments_count > 0 && (
          <span className="inline-flex items-center gap-0.5 text-[11px] text-slate-500" title={`${task.comments_count} comentário(s)`}>
            <MessageSquare size={12} /> {task.comments_count}
          </span>
        )}
        {task.planned_end_date && (
          <span className={`ml-auto inline-flex items-center gap-1 text-[11px] ${late ? 'font-semibold text-red-600' : 'text-slate-500'}`} title="Conclusão prevista">
            <CalendarDays size={12} />
            {fmtShortDate(task.planned_end_date)}
          </span>
        )}
      </div>
    </BoardCard>
  );
}
