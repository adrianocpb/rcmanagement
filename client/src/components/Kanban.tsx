import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CalendarDays, Plus, Target } from 'lucide-react';
import { useState } from 'react';
import { api, type Status, type Task } from '../lib/api';
import { fmtShortDate } from '../lib/format';
import { IceBadge, sortByIce, type IceSortKey } from './Ice';
import { useInvalidateTasks, useTaskModal } from './TaskModal';
import { Avatar, DeadlineBadge, PriorityBadge } from './ui';

export function Kanban({
  tasks,
  statuses,
  queryKey,
  sortKey = '',
  statusFilter,
}: {
  tasks: Task[];
  statuses: Status[];
  queryKey: unknown[];
  /** Ordenação dos cards dentro de cada coluna; vazio = padrão (prioridade e prazo). */
  sortKey?: IceSortKey | '';
  /** Filtro de status ativo: mostra somente a coluna desse status. */
  statusFilter?: number;
}) {
  const qc = useQueryClient();
  const invalidate = useInvalidateTasks();
  const { open } = useTaskModal();
  const [dragging, setDragging] = useState<Task | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const move = useMutation({
    mutationFn: ({ id, status_id }: { id: number; status_id: number }) => api.patch(`/tasks/${id}/status`, { status_id }),
    onMutate: async ({ id, status_id }) => {
      // Atualização otimista: o card muda de coluna imediatamente.
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<Task[]>(queryKey);
      const st = statuses.find((s) => s.id === status_id)!;
      qc.setQueryData<Task[]>(queryKey, (old) =>
        old?.map((t) => (t.id === id ? { ...t, status_id, status_name: st.name, status_color: st.color } : t)),
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
    const task = tasks.find((t) => t.id === e.active.id);
    const statusId = e.over?.id as number | undefined;
    if (task && statusId && statusId !== task.status_id) {
      setError(null);
      move.mutate({ id: task.id, status_id: statusId });
    }
  };

  const columns = statuses.filter(
    (s) => (statusFilter ? s.id === statusFilter : s.active || tasks.some((t) => t.status_id === s.id)),
  );

  return (
    <>
      {error && (
        <div className="mb-3 flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle size={14} /> {error}
        </div>
      )}
      <DndContext
        sensors={sensors}
        onDragStart={(e) => setDragging(tasks.find((t) => t.id === e.active.id) ?? null)}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        <div className="flex gap-3 overflow-x-auto pb-3" style={{ minHeight: 'calc(100vh - 230px)' }}>
          {columns.map((s) => (
            <Column
              key={s.id}
              status={s}
              tasks={sortByIce(tasks.filter((t) => t.status_id === s.id), sortKey)}
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

function Column({
  status,
  tasks,
  onOpen,
  onAdd,
  single,
}: {
  status: Status;
  tasks: Task[];
  onOpen: (id: number) => void;
  onAdd: () => void;
  /** Coluna exibida sozinha (filtro de status): mantém a largura de uma coluna normal. */
  single?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status.id });
  const overdue = tasks.filter((t) => t.is_overdue).length;
  return (
    <div
      ref={setNodeRef}
      className={`flex min-w-60 flex-1 basis-0 flex-col rounded-xl border transition-colors ${single ? 'max-w-sm' : ''} ${
        isOver ? 'border-blue-400 bg-blue-50/70' : 'border-slate-200 bg-slate-100/70'
      }`}
    >
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <span className="size-2.5 rounded-full" style={{ background: status.color }} />
        <h2 className="truncate text-[12px] font-semibold tracking-wide text-slate-700 uppercase" title={status.name}>
          {status.name}
        </h2>
        <span className="shrink-0 rounded-full bg-white px-1.5 text-xs font-medium text-slate-500 ring-1 ring-slate-200">{tasks.length}</span>
        {overdue > 0 && (
          <span
            className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-red-100 px-1.5 text-xs font-semibold text-red-700"
            title={`${overdue} tarefa(s) atrasada(s)`}
          >
            <AlertCircle size={11} /> {overdue}
          </span>
        )}
        <button className="ml-auto rounded p-0.5 text-slate-400 hover:bg-white hover:text-slate-700" onClick={onAdd} title="Nova tarefa neste status">
          <Plus size={16} />
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {tasks.map((t) => (
          <DraggableCard key={t.id} task={t} onOpen={onOpen} />
        ))}
        {tasks.length === 0 && <div className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-xs text-slate-400">Arraste tarefas para cá</div>}
      </div>
    </div>
  );
}

function DraggableCard({ task, onOpen }: { task: Task; onOpen: (id: number) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className={isDragging ? 'opacity-30' : ''} onClick={() => onOpen(task.id)}>
      <Card task={task} />
    </div>
  );
}

export function Card({ task, overlay }: { task: Task; overlay?: boolean }) {
  const late = task.is_overdue;
  return (
    <article
      className={`cursor-grab rounded-lg border bg-white p-2.5 shadow-xs transition hover:shadow-md active:cursor-grabbing ${
        late ? 'border-red-300 border-l-4 border-l-red-500' : 'border-slate-200'
      } ${overlay ? 'rotate-2 shadow-xl' : ''}`}
    >
      <div className="mb-1.5 flex items-start gap-2">
        <h3 className="flex-1 text-[13px] leading-snug font-medium text-slate-900">{task.title}</h3>
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
        <IceBadge score={task.ice_score} compact />
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{task.sector_name}</span>
        {(task.deadline_state === 'atrasada' || task.deadline_state === 'concluida_com_atraso') && (
          <DeadlineBadge state={task.deadline_state} />
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
