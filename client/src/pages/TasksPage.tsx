import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CARD_SORT_OPTIONS, isCardSort, Kanban, type CardSort } from '../components/Kanban';
import { EMPTY_FILTERS, TaskFilters, type TaskFilterValues } from '../components/TaskFilters';
import { TaskTable } from '../components/TaskTable';
import { useTaskModal } from '../components/TaskModal';
import { ErrorText, PageHeader, Spinner, ViewToggle, type BoardView } from '../components/ui';
import { api, qs, type Task } from '../lib/api';
import { usePersistentState } from '../lib/prefs';
import { useStatuses } from '../lib/queries';

export function TasksPage() {
  const [prefs, setPrefs] = usePersistentState('tasks.prefs', {
    view: 'kanban' as BoardView,
    cardSort: 'manual' as CardSort,
  });
  const [filters, setFilters] = usePersistentState<TaskFilterValues>('tasks.filters', EMPTY_FILTERS);
  // Preferência salva no navegador pode ter um valor antigo (ex.: ordenação por ICE): volta à ordem do quadro.
  const cardSort: CardSort = isCardSort(prefs.cardSort) ? prefs.cardSort : 'manual';
  const { open } = useTaskModal();
  const { data: statuses } = useStatuses();
  const [params, setParams] = useSearchParams();

  // Busca vinda da barra superior (?q=...): aplica no filtro de título e limpa a URL.
  const searched = params.get('q');
  useEffect(() => {
    if (searched === null) return;
    setFilters((f) => ({ ...f, q: searched }));
    setParams(
      (p) => {
        p.delete('q');
        return p;
      },
      { replace: true },
    );
  }, [searched, setFilters, setParams]);

  const queryKey = ['tasks', filters];
  const { data: tasks, isLoading, error } = useQuery({
    queryKey,
    queryFn: () => api.get<Task[]>(`/tasks${qs({ ...filters, period_field: filters.from || filters.to ? filters.period_field : '' })}`),
    placeholderData: (prev) => prev,
  });

  const overdue = tasks?.filter((t) => t.is_overdue).length ?? 0;
  const inProgress = tasks?.filter((t) => t.started_at && !t.is_completed && !t.is_canceled).length ?? 0;

  return (
    <div>
      <PageHeader
        title="Tarefas"
        subtitle={
          tasks && (
            <>
              {tasks.length} tarefas · {inProgress} em andamento ·{' '}
              <span className={overdue ? 'font-semibold text-red-600' : ''}>{overdue} atrasada(s)</span>
            </>
          )
        }
        actions={
          <>
            <ViewToggle value={prefs.view} onChange={(view) => setPrefs((p) => ({ ...p, view }))} />
            {prefs.view === 'kanban' && (
              <select
                className="input w-auto py-1.5"
                value={cardSort}
                onChange={(e) => setPrefs((p) => ({ ...p, cardSort: e.target.value as CardSort }))}
                aria-label="Ordenar cards"
                title="Na ordem do quadro, arraste os cards para definir a prioridade dentro de cada coluna"
              >
                {CARD_SORT_OPTIONS.map((o) => (
                  <option key={o.key} value={o.key}>
                    Ordenar: {o.label}
                  </option>
                ))}
              </select>
            )}
            <button className="btn-primary" onClick={() => open('new')}>
              <Plus size={16} /> Nova tarefa
            </button>
          </>
        }
      />
      <TaskFilters value={filters} onChange={setFilters} />
      <ErrorText error={error} />
      {isLoading || !statuses ? (
        <Spinner />
      ) : prefs.view === 'kanban' ? (
        <Kanban
          tasks={tasks ?? []}
          statuses={statuses}
          queryKey={queryKey}
          sort={cardSort}
          statusFilter={filters.status_id ? Number(filters.status_id) : undefined}
        />
      ) : (
        <TaskTable tasks={tasks ?? []} />
      )}
    </div>
  );
}
