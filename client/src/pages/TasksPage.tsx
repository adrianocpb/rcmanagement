import { useQuery } from '@tanstack/react-query';
import { Columns3, List, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Kanban } from '../components/Kanban';
import { EMPTY_FILTERS, TaskFilters, type TaskFilterValues } from '../components/TaskFilters';
import { TaskTable } from '../components/TaskTable';
import { useTaskModal } from '../components/TaskModal';
import { ErrorText, PageHeader, Spinner } from '../components/ui';
import { api, qs, type Task } from '../lib/api';
import { useStatuses } from '../lib/queries';

/** Preferências por usuário no navegador (visualização e filtros). Falhas de storage são ignoradas. */
function usePersistentState<T>(key: string, initial: T) {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? { ...initial, ...JSON.parse(raw) } : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      /* ignora */
    }
  }, [key, v]);
  return [v, setV] as const;
}

export function TasksPage() {
  const [prefs, setPrefs] = usePersistentState('tasks.prefs', { view: 'kanban' as 'kanban' | 'list' });
  const [filters, setFilters] = usePersistentState<TaskFilterValues>('tasks.filters', EMPTY_FILTERS);
  const { open } = useTaskModal();
  const { data: statuses } = useStatuses();

  const queryKey = ['tasks', filters];
  const { data: tasks, isLoading, error } = useQuery({
    queryKey,
    queryFn: () => api.get<Task[]>(`/tasks${qs({ ...filters, period_field: filters.from || filters.to ? filters.period_field : '' })}`),
    placeholderData: (prev) => prev,
  });

  const overdue = tasks?.filter((t) => t.is_overdue).length ?? 0;
  const inProgress = tasks?.filter((t) => t.started_at && !t.is_completed).length ?? 0;

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
            <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5 shadow-xs" role="tablist">
              {(
                [
                  ['kanban', 'Kanban', Columns3],
                  ['list', 'Lista', List],
                ] as const
              ).map(([key, label, Icon]) => (
                <button
                  key={key}
                  role="tab"
                  aria-selected={prefs.view === key}
                  onClick={() => setPrefs({ view: key })}
                  className={`inline-flex items-center gap-1.5 rounded px-3 py-1 text-sm font-medium ${
                    prefs.view === key ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <Icon size={14} /> {label}
                </button>
              ))}
            </div>
            <button className="btn-primary" onClick={() => open('new')}>
              <Plus size={16} /> Nova tarefa
            </button>
          </>
        }
      />
      <TaskFilters value={filters} onChange={setFilters} hideStatus={prefs.view === 'kanban'} />
      <ErrorText error={error} />
      {isLoading || !statuses ? (
        <Spinner />
      ) : prefs.view === 'kanban' ? (
        <Kanban tasks={tasks ?? []} statuses={statuses} queryKey={queryKey} />
      ) : (
        <TaskTable tasks={tasks ?? []} />
      )}
    </div>
  );
}
