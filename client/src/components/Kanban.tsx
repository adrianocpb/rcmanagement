import {
  closestCorners,
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CalendarDays, MessageSquare, Plus, Target } from 'lucide-react';
import { useState } from 'react';
import { api, type Status, type Task } from '../lib/api';
import { fmtShortDate, PRIORITY } from '../lib/format';
import { useInvalidateTasks, useTaskModal } from './TaskModal';
import { Avatar, DeadlineBadge, PriorityBadge } from './ui';

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
  const l = [...list];
  if (sort === 'manual') {
    return l.sort((a, b) => (a.board_position ?? Infinity) - (b.board_position ?? Infinity) || a.id - b.id);
  }
  if (sort === 'due') return l.sort((a, b) => byDue(a, b) || a.id - b.id);
  if (sort === 'created') return l.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return l.sort((a, b) => PRIORITY[a.priority].order - PRIORITY[b.priority].order || byDue(a, b) || a.id - b.id);
}

// Ids do arrastar: cards e colunas usam prefixos para não colidir (ambos são números no banco).
const cardId = (id: number) => `task-${id}`;
const columnId = (id: number) => `col-${id}`;
const parseId = (id: unknown) => {
  const [kind, n] = String(id).split('-');
  return { kind, id: Number(n) };
};

type Move = { id: number; status_id: number; before_id: number | null };

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
  const qc = useQueryClient();
  const invalidate = useInvalidateTasks();
  const { open } = useTaskModal();
  const [dragging, setDragging] = useState<Task | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const manual = sort === 'manual';

  const columns = statuses.filter(
    (s) => (statusFilter ? s.id === statusFilter : s.active || tasks.some((t) => t.status_id === s.id)),
  );
  const columnTasks = (statusId: number) => sortCards(tasks.filter((t) => t.status_id === statusId), sort);

  const move = useMutation({
    mutationFn: ({ id, status_id, before_id }: Move) =>
      manual ? api.patch(`/tasks/${id}/position`, { status_id, before_id }) : api.patch(`/tasks/${id}/status`, { status_id }),
    onMutate: async ({ id, status_id, before_id }) => {
      // Atualização otimista: o card muda de lugar imediatamente; o servidor confirma em seguida.
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<Task[]>(queryKey);
      const st = statuses.find((s) => s.id === status_id)!;
      const target = sortCards(
        (prev ?? []).filter((t) => t.status_id === status_id && t.id !== id),
        'manual',
      );
      const at = before_id == null ? target.length : target.findIndex((t) => t.id === before_id);
      const lower = target[at - 1]?.board_position ?? null;
      const upper = target[at]?.board_position ?? null;
      const position =
        upper == null ? (lower ?? 0) + 1024 : lower == null ? upper - 1024 : (lower + upper) / 2;
      qc.setQueryData<Task[]>(queryKey, (old) =>
        old?.map((t) =>
          t.id === id ? { ...t, status_id, status_name: st.name, status_color: st.color, board_position: position } : t,
        ),
      );
      return { prev };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev);
      setError(err.message);
    },
    onSettled: invalidate,
  });

  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    if (!e.over) return;
    const task = tasks.find((t) => t.id === parseId(e.active.id).id);
    if (!task) return;
    const over = parseId(e.over.id);
    let statusId: number;
    let beforeId: number | null = null;

    if (over.kind === 'col') {
      // Área vazia da coluna: vai para o fim.
      statusId = over.id;
    } else {
      const overTask = tasks.find((t) => t.id === over.id);
      if (!overTask) return;
      statusId = overTask.status_id;
      if (statusId === task.status_id) {
        // Mesma coluna: reordena (só na ordem do quadro).
        if (!manual) return;
        const list = columnTasks(statusId);
        const from = list.findIndex((t) => t.id === task.id);
        const to = list.findIndex((t) => t.id === overTask.id);
        if (from === to) return;
        const reordered = arrayMove(list, from, to);
        beforeId = reordered[to + 1]?.id ?? null;
      } else {
        // Outra coluna: entra no lugar do card sob o cursor.
        beforeId = overTask.id;
      }
    }
    if (statusId === task.status_id && (!manual || over.kind === 'col')) return;
    setError(null);
    move.mutate({ id: task.id, status_id: statusId, before_id: beforeId });
  };

  return (
    <>
      {error && (
        <div className="mb-3 flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle size={14} /> {error}
        </div>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={(e) => setDragging(tasks.find((t) => t.id === parseId(e.active.id).id) ?? null)}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        <div className="flex gap-3 overflow-x-auto pb-3" style={{ minHeight: 'calc(100vh - 230px)' }}>
          {columns.map((s) => (
            <Column
              key={s.id}
              status={s}
              tasks={columnTasks(s.id)}
              manual={manual}
              onOpen={(id) => open(id)}
              onAdd={() => open('new', { status_id: s.id })}
              single={!!statusFilter}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={null}>{dragging && <Card task={dragging} overlay />}</DragOverlay>
      </DndContext>
    </>
  );
}

/** Sem reordenação visual dentro da coluna (ordenações automáticas): os cards ficam parados. */
const noReorder = () => null;

function Column({
  status,
  tasks,
  manual,
  onOpen,
  onAdd,
  single,
}: {
  status: Status;
  tasks: Task[];
  manual: boolean;
  onOpen: (id: number) => void;
  onAdd: () => void;
  /** Coluna exibida sozinha (filtro de status): mantém a largura de uma coluna normal. */
  single?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: columnId(status.id) });
  const overdue = tasks.filter((t) => t.is_overdue).length;
  return (
    <div
      ref={setNodeRef}
      className={`flex min-w-60 flex-1 basis-0 flex-col rounded-md transition-colors ${single ? 'max-w-sm' : ''} ${
        isOver ? 'bg-blue-50 ring-1 ring-blue-300' : 'bg-transparent'
      }`}
    >
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <span className="size-2.5 rounded-full" style={{ background: status.color }} />
        <h2 className="truncate text-[13px] font-medium tracking-[0.2px] text-slate-700 uppercase" title={status.name}>
          {status.name}
        </h2>
        <span className="shrink-0 rounded bg-[rgba(107,107,102,0.16)] px-1.5 text-xs font-medium text-slate-600">{tasks.length}</span>
        {overdue > 0 && (
          <span
            className="inline-flex shrink-0 items-center gap-0.5 rounded bg-red-50 px-1.5 text-xs font-medium text-red-700"
            title={`${overdue} tarefa(s) atrasada(s)`}
          >
            <AlertCircle size={11} /> {overdue}
          </span>
        )}
        <button className="ml-auto rounded p-0.5 text-slate-400 hover:bg-white hover:text-slate-700" onClick={onAdd} title="Nova tarefa neste status">
          <Plus size={16} />
        </button>
      </div>
      <SortableContext items={tasks.map((t) => cardId(t.id))} strategy={manual ? verticalListSortingStrategy : noReorder}>
        <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
          {tasks.map((t) => (
            <SortableCard key={t.id} task={t} onOpen={onOpen} />
          ))}
          {tasks.length === 0 && <div className="rounded-md border border-dashed border-slate-300 p-4 text-center text-xs text-slate-500">Arraste tarefas para cá</div>}
        </div>
      </SortableContext>
    </div>
  );
}

function SortableCard({ task, onOpen }: { task: Task; onOpen: (id: number) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: cardId(task.id) });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={isDragging ? 'opacity-30' : ''}
      onClick={() => onOpen(task.id)}
    >
      <Card task={task} />
    </div>
  );
}

export function Card({ task, overlay }: { task: Task; overlay?: boolean }) {
  const late = task.is_overdue;
  return (
    <article
      className={`cursor-grab rounded-md bg-white p-3 elev-card transition hover:elev-float active:cursor-grabbing ${
        late ? 'ring-1 ring-red-300' : ''
      } ${overlay ? 'rotate-2 elev-float' : ''}`}
    >
      <div className="mb-1.5 flex items-start gap-2">
        <h3 className="flex-1 text-sm leading-snug font-medium text-slate-700">{task.title}</h3>
        <Avatar name={task.assignee_name} id={task.assignee_id} />
      </div>
      {task.outcome_name && (
        <div className="mb-1.5 flex items-start gap-1 text-[11px] leading-tight text-violet-700" title="Outcome">
          <Target size={12} className="mt-px shrink-0" />
          <span className="line-clamp-2">{task.outcome_name}</span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
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
    </article>
  );
}
