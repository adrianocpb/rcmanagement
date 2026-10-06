import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Trash2 } from 'lucide-react';
import { useInvalidateTasks } from '../components/TaskModal';
import { EmptyState, ErrorText, PageHeader, Spinner, StatusPill } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDateTime } from '../lib/format';

interface TrashItem {
  id: number;
  title: string;
  deleted_at: string;
  deleted_by_name: string | null;
  status_name: string;
  status_color: string;
  sector_name: string;
  assignee_name: string;
  purge_at: string;
  days_left: number;
}

export function TrashPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const qc = useQueryClient();
  const invalidateTasks = useInvalidateTasks();
  const { data, isLoading, error } = useQuery({
    queryKey: ['trash'],
    queryFn: () => api.get<{ days: number; items: TrashItem[] }>('/tasks/trash'),
  });
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['trash'] }), invalidateTasks()]);

  const restore = useMutation({ mutationFn: (id: number) => api.post(`/tasks/${id}/restore`), onSuccess: refresh });
  const purgeOne = useMutation({ mutationFn: (id: number) => api.del(`/tasks/trash/${id}`), onSuccess: refresh });
  const emptyAll = useMutation({ mutationFn: () => api.del('/tasks/trash'), onSuccess: refresh });

  const items = data?.items ?? [];

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Lixeira"
        subtitle={`Tarefas excluídas ficam aqui por ${data?.days ?? 30} dias e depois são removidas definitivamente.`}
        actions={
          isAdmin && (
            <button
              className="btn border border-red-300 bg-white text-red-700 shadow-xs hover:bg-red-50"
              disabled={!items.length || emptyAll.isPending}
              onClick={() =>
                confirm(`Esvaziar a lixeira? ${items.length} tarefa(s) serão removidas DEFINITIVAMENTE. Não há como desfazer.`) &&
                emptyAll.mutate()
              }
            >
              <Trash2 size={16} /> Esvaziar lixeira
            </button>
          )
        }
      />
      <ErrorText error={error ?? restore.error ?? purgeOne.error ?? emptyAll.error} />
      {isLoading && <Spinner />}
      {data && items.length === 0 && <EmptyState>A lixeira está vazia.</EmptyState>}
      {items.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="th">Tarefa</th>
                <th className="th">Status</th>
                <th className="th">Responsável</th>
                <th className="th">Excluída em</th>
                <th className="th">Por</th>
                <th className="th">Remoção em</th>
                <th className="th" />
              </tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id} className="border-b border-slate-100 last:border-0">
                  <td className="td">
                    <div className="font-medium text-slate-900">{t.title}</div>
                    <div className="text-xs text-slate-500">
                      #{t.id} · {t.sector_name}
                    </div>
                  </td>
                  <td className="td">
                    <StatusPill name={t.status_name} color={t.status_color} />
                  </td>
                  <td className="td whitespace-nowrap">{t.assignee_name}</td>
                  <td className="td whitespace-nowrap text-slate-600">{fmtDateTime(t.deleted_at)}</td>
                  <td className="td whitespace-nowrap text-slate-600">{t.deleted_by_name ?? '—'}</td>
                  <td className="td whitespace-nowrap">
                    <span className={t.days_left <= 3 ? 'font-semibold text-red-600' : 'text-slate-600'}>
                      {t.days_left === 0 ? 'hoje' : `em ${t.days_left} dia${t.days_left > 1 ? 's' : ''}`}
                    </span>
                  </td>
                  <td className="td">
                    <div className="flex justify-end gap-1">
                      <button className="btn-secondary py-1" disabled={restore.isPending} onClick={() => restore.mutate(t.id)}>
                        <RotateCcw size={14} /> Restaurar
                      </button>
                      {isAdmin && (
                        <button
                          className="btn-danger py-1"
                          title="Excluir definitivamente"
                          disabled={purgeOne.isPending}
                          onClick={() =>
                            confirm(`Excluir "${t.title}" DEFINITIVAMENTE? Não há como desfazer.`) && purgeOne.mutate(t.id)
                          }
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!isAdmin && items.length > 0 && (
        <p className="mt-3 text-xs text-slate-500">Somente administradores podem esvaziar a lixeira ou excluir tarefas definitivamente.</p>
      )}
    </div>
  );
}
