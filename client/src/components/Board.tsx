/**
 * Quadro Kanban genérico (tarefas, outcomes e épicos): uma coluna por status, cards arrastáveis
 * entre colunas e — na ordem do quadro — reordenáveis dentro da coluna.
 */
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
import { AlertCircle, Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { Status } from '../lib/api';

export interface BoardItem {
  id: number;
  status_id: number | null;
  board_position: number | null;
}

export type BoardMove = { id: number; status_id: number; before_id: number | null };

/** Ordem do quadro: posição manual (definida arrastando). */
export const byBoardPosition = <T extends BoardItem>(list: T[]) =>
  [...list].sort((a, b) => (a.board_position ?? Infinity) - (b.board_position ?? Infinity) || a.id - b.id);

// Ids do arrastar: cards e colunas usam prefixos para não colidir (ambos são números no banco).
const cardId = (id: number) => `item-${id}`;
const columnId = (id: number) => `col-${id}`;
const parseId = (id: unknown) => {
  const [kind, n] = String(id).split('-');
  return { kind, id: Number(n) };
};

export function Board<T extends BoardItem>({
  items,
  statuses,
  queryKey,
  manual,
  sortColumn,
  move,
  onSettled,
  renderCard,
  onOpen,
  onAdd,
  noun,
  columnBadge,
  statusFilter,
}: {
  items: T[];
  statuses: Status[];
  /** Consulta cujo cache recebe a atualização otimista (lista com estes itens). */
  queryKey: unknown[];
  /** Ordem do quadro: permite reordenar dentro da coluna. */
  manual: boolean;
  /** Ordena os cards de uma coluna (na ordem do quadro, use byBoardPosition). */
  sortColumn: (list: T[]) => T[];
  /** Chamada à API que grava a mudança. */
  move: (m: BoardMove) => Promise<unknown>;
  /** Depois de gravar (ou falhar): recarrega o que depende do item. */
  onSettled: () => unknown;
  renderCard: (item: T, overlay?: boolean) => ReactNode;
  onOpen: (item: T) => void;
  onAdd?: (statusId: number) => void;
  /** Como chamar os itens nos textos: "tarefa", "outcome", "épico". */
  noun: { one: string; many: string };
  /** Selo extra no cabeçalho da coluna (ex.: tarefas atrasadas). */
  columnBadge?: (items: T[]) => ReactNode;
  /** Filtro de status ativo: mostra somente a coluna desse status. */
  statusFilter?: number;
}) {
  const qc = useQueryClient();
  const [dragging, setDragging] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const columns = statuses.filter((s) => (statusFilter ? s.id === statusFilter : s.active || items.some((t) => t.status_id === s.id)));
  const columnItems = (statusId: number) => sortColumn(items.filter((t) => t.status_id === statusId));

  const mutation = useMutation({
    mutationFn: move,
    onMutate: async ({ id, status_id, before_id }) => {
      // Atualização otimista: o card muda de lugar imediatamente; o servidor confirma em seguida.
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<T[]>(queryKey);
      const st = statuses.find((s) => s.id === status_id)!;
      const target = byBoardPosition((prev ?? []).filter((t) => t.status_id === status_id && t.id !== id));
      const at = before_id == null ? target.length : target.findIndex((t) => t.id === before_id);
      const lower = target[at - 1]?.board_position ?? null;
      const upper = target[at]?.board_position ?? null;
      const position = upper == null ? (lower ?? 0) + 1024 : lower == null ? upper - 1024 : (lower + upper) / 2;
      qc.setQueryData<T[]>(queryKey, (old) =>
        old?.map((t) => (t.id === id ? { ...t, status_id, status_name: st.name, status_color: st.color, board_position: position } : t)),
      );
      return { prev };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev);
      setError(err.message);
    },
    onSettled,
  });

  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    if (!e.over) return;
    const item = items.find((t) => t.id === parseId(e.active.id).id);
    if (!item) return;
    const over = parseId(e.over.id);
    let statusId: number;
    let beforeId: number | null = null;

    if (over.kind === 'col') {
      // Área vazia da coluna: vai para o fim.
      statusId = over.id;
    } else {
      const overItem = items.find((t) => t.id === over.id);
      if (!overItem?.status_id) return;
      statusId = overItem.status_id;
      if (statusId === item.status_id) {
        // Mesma coluna: reordena (só na ordem do quadro).
        if (!manual) return;
        const list = columnItems(statusId);
        const from = list.findIndex((t) => t.id === item.id);
        const to = list.findIndex((t) => t.id === overItem.id);
        if (from === to) return;
        beforeId = arrayMove(list, from, to)[to + 1]?.id ?? null;
      } else {
        // Outra coluna: entra no lugar do card sob o cursor.
        beforeId = overItem.id;
      }
    }
    if (statusId === item.status_id && (!manual || over.kind === 'col')) return;
    setError(null);
    mutation.mutate({ id: item.id, status_id: statusId, before_id: beforeId });
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
        onDragStart={(e) => setDragging(items.find((t) => t.id === parseId(e.active.id).id) ?? null)}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        <div className="flex gap-3 overflow-x-auto pb-3" style={{ minHeight: 'calc(100vh - 230px)' }}>
          {columns.map((s) => (
            <Column
              key={s.id}
              status={s}
              items={columnItems(s.id)}
              manual={manual}
              renderCard={renderCard}
              onOpen={onOpen}
              onAdd={onAdd && (() => onAdd(s.id))}
              noun={noun}
              badge={columnBadge}
              single={!!statusFilter}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={null}>{dragging && renderCard(dragging, true)}</DragOverlay>
      </DndContext>
    </>
  );
}

/** Sem reordenação visual dentro da coluna (ordenações automáticas): os cards ficam parados. */
const noReorder = () => null;

function Column<T extends BoardItem>({
  status,
  items,
  manual,
  renderCard,
  onOpen,
  onAdd,
  noun,
  badge,
  single,
}: {
  status: Status;
  items: T[];
  manual: boolean;
  renderCard: (item: T) => ReactNode;
  onOpen: (item: T) => void;
  onAdd?: () => void;
  noun: { one: string; many: string };
  badge?: (items: T[]) => ReactNode;
  /** Coluna exibida sozinha (filtro de status): mantém a largura de uma coluna normal. */
  single?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: columnId(status.id) });
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
        <span className="shrink-0 rounded bg-[rgba(107,107,102,0.16)] px-1.5 text-xs font-medium text-slate-600">{items.length}</span>
        {badge?.(items)}
        {onAdd && (
          <button
            className="ml-auto rounded p-0.5 text-slate-400 hover:bg-white hover:text-slate-700"
            onClick={onAdd}
            title={`Novo(a) ${noun.one} neste status`}
          >
            <Plus size={16} />
          </button>
        )}
      </div>
      <SortableContext items={items.map((t) => cardId(t.id))} strategy={manual ? verticalListSortingStrategy : noReorder}>
        <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
          {items.map((t) => (
            <SortableCard key={t.id} id={t.id} onOpen={() => onOpen(t)}>
              {renderCard(t)}
            </SortableCard>
          ))}
          {items.length === 0 && (
            <div className="rounded-md border border-dashed border-slate-300 p-4 text-center text-xs text-slate-500">Arraste {noun.many} para cá</div>
          )}
        </div>
      </SortableContext>
    </div>
  );
}

function SortableCard({ id, onOpen, children }: { id: number; onOpen: () => void; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: cardId(id) });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={isDragging ? 'opacity-30' : ''}
      onClick={onOpen}
    >
      {children}
    </div>
  );
}

/** Moldura padrão dos cards do quadro. */
export function BoardCard({ overlay, alert, dim, children }: { overlay?: boolean; alert?: boolean; dim?: boolean; children: ReactNode }) {
  return (
    <article
      className={`cursor-grab rounded-md bg-white p-3 elev-card transition hover:elev-float active:cursor-grabbing ${alert ? 'ring-1 ring-red-300' : ''} ${
        overlay ? 'rotate-2 elev-float' : ''
      } ${dim ? 'opacity-60' : ''}`}
    >
      {children}
    </article>
  );
}
