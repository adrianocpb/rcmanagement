/** Administração → Tags: renomear, trocar a cor e excluir tags das tarefas. */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api, type TagWithCount } from '../lib/api';
import { OUTCOME_COLOR, OUTCOME_COLOR_KEYS } from '../lib/format';
import { useTags } from '../lib/queries';
import { useInvalidateTasks } from './TaskModal';
import { ErrorText, Field, Modal, Spinner, TagChip } from './ui';

export function TagsTab() {
  const { data: tags, isLoading, error } = useTags();
  const invalidate = useInvalidateTasks();
  const [editing, setEditing] = useState<TagWithCount | null>(null);
  const del = useMutation({ mutationFn: (id: number) => api.del(`/tags/${id}`), onSuccess: invalidate });

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        Tags são criadas ao digitá-las numa tarefa (ex.: o nome de um fornecedor). Aqui você pode renomear, trocar a cor ou excluir — excluir tira a
        tag de todas as tarefas.
      </p>
      <ErrorText error={error ?? del.error} />
      {isLoading && <Spinner />}
      {tags && (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="th">Tag</th>
                <th className="th">Tarefas</th>
                <th className="th" />
              </tr>
            </thead>
            <tbody>
              {tags.length === 0 && (
                <tr>
                  <td className="td text-slate-500" colSpan={3}>
                    Nenhuma tag ainda. Adicione tags no cadastro das tarefas.
                  </td>
                </tr>
              )}
              {tags.map((t) => (
                <tr key={t.id} className="border-b border-slate-100 last:border-0">
                  <td className="td">
                    <TagChip name={t.name} color={t.color} className="text-xs" />
                  </td>
                  <td className="td text-slate-600">{t.tasks_count}</td>
                  <td className="td text-right whitespace-nowrap">
                    <button className="btn-ghost p-1" onClick={() => setEditing(t)} title="Editar">
                      <Pencil size={14} />
                    </button>
                    <button
                      className="btn-ghost p-1 text-red-700"
                      title="Excluir"
                      disabled={del.isPending}
                      onClick={() =>
                        confirm(`Excluir a tag "${t.name}"? Ela sai de ${t.tasks_count} tarefa(s). As tarefas continuam existindo.`) && del.mutate(t.id)
                      }
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <TagModal tag={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function TagModal({ tag, onClose }: { tag: TagWithCount; onClose: () => void }) {
  const qc = useQueryClient();
  const invalidate = useInvalidateTasks();
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState(tag.color ?? OUTCOME_COLOR_KEYS[0]);
  const save = useMutation({
    mutationFn: () => api.put(`/tags/${tag.id}`, { name, color }),
    onSuccess: async () => {
      await Promise.all([invalidate(), qc.invalidateQueries({ queryKey: ['tags'] })]);
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Editar tag"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn-primary" form="tag-form" disabled={save.isPending}>
            Salvar
          </button>
        </>
      }
    >
      <form
        id="tag-form"
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Nome" required>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} autoFocus />
        </Field>
        <Field label="Cor">
          <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Cor da tag">
            {OUTCOME_COLOR_KEYS.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={color === k}
                aria-label={OUTCOME_COLOR[k].label}
                title={OUTCOME_COLOR[k].label}
                onClick={() => setColor(k)}
                className={`size-7 rounded-full ring-offset-2 transition ${color === k ? 'ring-2 ring-slate-900' : 'hover:ring-2 hover:ring-slate-300'}`}
                style={{ background: OUTCOME_COLOR[k].dot }}
              />
            ))}
            {name.trim() && <TagChip name={name.trim()} color={color} className="ml-1 text-xs" />}
          </div>
        </Field>
        <ErrorText error={save.error} />
      </form>
    </Modal>
  );
}
