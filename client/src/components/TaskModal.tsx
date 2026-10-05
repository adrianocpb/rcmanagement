import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type Priority, type TaskDetail } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PRIORITY, PRIORITY_KEYS, fmtDate, fmtDateTime, fmtNumber, isoToLocalInput, localInputToIso } from '../lib/format';
import { useEpics, useOutcomes, useSectors, useStatuses, useUserOptions } from '../lib/queries';
import { IceBadge, IceFields, IceStrip, type IceKey } from './Ice';
import { Avatar, DeadlineBadge, ErrorText, Field, Modal, PriorityBadge, Spinner, StatusPill } from './ui';

/** Invalida tudo o que depende de tarefas. */
export function useInvalidateTasks() {
  const qc = useQueryClient();
  return () =>
    Promise.all(
      [['tasks'], ['task'], ['epics'], ['outcomes'], ['dashboard'], ['epic'], ['outcome']].map((k) =>
        qc.invalidateQueries({ queryKey: k }),
      ),
    );
}

/** Abre/fecha o modal de tarefa via parâmetro de URL (?task=ID ou ?task=new). */
export function useTaskModal() {
  const [params, setParams] = useSearchParams();
  return {
    current: params.get('task'),
    open: (id: number | 'new', defaults?: Record<string, string | number>) =>
      setParams((p) => {
        p.set('task', String(id));
        if (defaults) p.set('defaults', JSON.stringify(defaults));
        else p.delete('defaults');
        return p;
      }),
    close: () =>
      setParams((p) => {
        p.delete('task');
        p.delete('defaults');
        p.delete('edit');
        return p;
      }),
  };
}

export function TaskModal() {
  const { current, close } = useTaskModal();
  const [params] = useSearchParams();
  if (!current) return null;
  if (current === 'new') {
    let defaults: Record<string, string | number> = {};
    try {
      defaults = JSON.parse(params.get('defaults') ?? '{}');
    } catch {
      /* ignora */
    }
    return (
      <Modal open onClose={close} title="Nova tarefa" size="lg">
        <TaskForm defaults={defaults} onDone={close} onCancel={close} />
      </Modal>
    );
  }
  return <TaskDetailModal id={Number(current)} onClose={close} />;
}

function TaskDetailModal({ id, onClose }: { id: number; onClose: () => void }) {
  const [editing, setEditing] = useState(false);
  const invalidate = useInvalidateTasks();
  const { data: task, isLoading, error } = useQuery({
    queryKey: ['task', id],
    queryFn: () => api.get<TaskDetail>(`/tasks/${id}`),
  });
  const { data: statuses } = useStatuses();
  const statusMut = useMutation({
    mutationFn: (status_id: number) => api.patch(`/tasks/${id}/status`, { status_id }),
    onSuccess: invalidate,
  });
  const delMut = useMutation({
    mutationFn: () => api.del(`/tasks/${id}`),
    onSuccess: async () => {
      await invalidate();
      onClose();
    },
  });

  const title = task ? (
    <div className="flex items-center gap-2">
      <span className="text-slate-400">#{task.id}</span>
      <span className="truncate">{editing ? 'Editar tarefa' : task.title}</span>
    </div>
  ) : (
    'Tarefa'
  );

  return (
    <Modal open onClose={onClose} title={title} size="lg">
      {isLoading && <Spinner />}
      <ErrorText error={error} />
      {task && editing && <TaskForm task={task} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />}
      {task && !editing && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="input w-auto py-1 font-medium"
              value={task.status_id}
              disabled={statusMut.isPending}
              onChange={(e) => statusMut.mutate(Number(e.target.value))}
              aria-label="Status"
            >
              {statuses
                ?.filter((s) => s.active || s.id === task.status_id)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
            <PriorityBadge priority={task.priority} />
            <DeadlineBadge state={task.deadline_state} />
            <IceBadge score={task.ice_score} />
            <div className="ml-auto flex gap-1">
              <button className="btn-secondary" onClick={() => setEditing(true)}>
                <Pencil size={14} /> Editar
              </button>
              <button
                className="btn-danger"
                onClick={() => confirm('Excluir esta tarefa? Ela deixará de aparecer no sistema.') && delMut.mutate()}
                title="Excluir"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
          <ErrorText error={statusMut.error ?? delMut.error} />

          <Section title="Informações">
            <p className="text-lg font-semibold text-slate-900">{task.title}</p>
            <Text label="Descrição" value={task.description} />
            <Text label="Observações" value={task.notes} />
          </Section>

          <div className="grid gap-5 sm:grid-cols-2">
            <Section title="Relacionamentos">
              <Row label="Épico">
                {task.epic_id ? (
                  <Link className="text-blue-700 hover:underline" to={`/epicos/${task.epic_id}`}>
                    {task.epic_name}
                  </Link>
                ) : (
                  '—'
                )}
              </Row>
              <Row label="Outcome">
                {task.outcome_id ? (
                  <Link className="text-blue-700 hover:underline" to={`/outcomes/${task.outcome_id}`}>
                    {task.outcome_name}
                  </Link>
                ) : (
                  '—'
                )}
              </Row>
            </Section>
            <Section title="Pessoas">
              <Row label="Solicitante">
                <Person name={task.requester_name} id={task.requester_id} />
              </Row>
              <Row label="Responsável">
                <Person name={task.assignee_name} id={task.assignee_id} />
              </Row>
              <Row label="Setor">{task.sector_name}</Row>
            </Section>
            <Section title="Planejamento">
              <Row label="Prioridade">{PRIORITY[task.priority].label}</Row>
              <Row label="Tempo estimado">{task.estimated_hours != null ? `${fmtNumber(task.estimated_hours)} h` : '—'}</Row>
              <Row label="Início previsto">{fmtDate(task.planned_start_date)}</Row>
              <Row label="Conclusão prevista">
                <span className={task.is_overdue ? 'font-semibold text-red-600' : ''}>{fmtDate(task.planned_end_date)}</span>
              </Row>
            </Section>
            <Section title="Execução">
              <Row label="Status">
                <StatusPill name={task.status_name} color={task.status_color} />
              </Row>
              <Row label="Criada em">{fmtDateTime(task.created_at)}</Row>
              <Row label="Início real">{fmtDateTime(task.started_at)}</Row>
              <Row label="Conclusão real">{fmtDateTime(task.completed_at)}</Row>
            </Section>
          </div>

          <Section title="Priorização (ICE)">
            <IceStrip item={task} />
          </Section>

          <Section title="Histórico">
            <ol className="relative ml-2 border-l border-slate-200">
              {task.history.map((h) => (
                <li key={h.id} className="mb-3 ml-4 last:mb-0">
                  <span
                    className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full ring-2 ring-white"
                    style={{ background: h.to_status_color }}
                  />
                  <div className="text-sm text-slate-800">
                    {h.from_status_id == null ? (
                      <>
                        <b>Criada</b> em <b>{h.to_status_name}</b>
                      </>
                    ) : (
                      <>
                        {h.from_status_name} → <b>{h.to_status_name}</b>
                      </>
                    )}
                  </div>
                  <div className="text-xs text-slate-500">
                    {fmtDateTime(h.changed_at)} · {h.changed_by_name ?? '—'}
                  </div>
                </li>
              ))}
            </ol>
          </Section>
        </div>
      )}
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-400 uppercase">{title}</h3>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-1.5 text-sm last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="text-right text-slate-800">{children}</span>
    </div>
  );
}
function Text({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="text-sm">
      <div className="text-xs text-slate-500">{label}</div>
      <p className="whitespace-pre-wrap text-slate-700">{value}</p>
    </div>
  );
}
function Person({ name, id }: { name: string; id: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Avatar name={name} id={id} /> {name}
    </span>
  );
}

// ---------------- Formulário ----------------

type FormState = Record<string, string>;

function toForm(t?: TaskDetail, defaults: Record<string, string | number> = {}): FormState {
  const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
  return {
    title: s(t?.title),
    description: s(t?.description),
    notes: s(t?.notes),
    sector_id: s(t?.sector_id ?? defaults.sector_id),
    requester_id: s(t?.requester_id ?? defaults.requester_id),
    assignee_id: s(t?.assignee_id ?? defaults.assignee_id),
    status_id: s(t?.status_id ?? defaults.status_id),
    epic_id: s(t?.epic_id ?? defaults.epic_id),
    outcome_id: s(t?.outcome_id ?? defaults.outcome_id),
    priority: s(t?.priority ?? 'media'),
    estimated_hours: s(t?.estimated_hours),
    ice_impact: s(t?.ice_impact),
    ice_confidence: s(t?.ice_confidence),
    ice_ease: s(t?.ice_ease),
    planned_start_date: s(t?.planned_start_date),
    planned_end_date: s(t?.planned_end_date),
    started_at: isoToLocalInput(t?.started_at ?? null),
    completed_at: isoToLocalInput(t?.completed_at ?? null),
  };
}

function TaskForm({
  task,
  defaults,
  onDone,
  onCancel,
}: {
  task?: TaskDetail;
  defaults?: Record<string, string | number>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { user } = useAuth();
  const [f, setF] = useState<FormState>(() => toForm(task, defaults));
  const set = (k: string) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const invalidate = useInvalidateTasks();
  const { open } = useTaskModal();

  const { data: statuses } = useStatuses();
  const { data: sectors } = useSectors();
  const { data: users } = useUserOptions();
  const { data: epics } = useEpics();
  const { data: outcomes } = useOutcomes();

  // Valores padrão de uma nova tarefa: status padrão e o próprio usuário como solicitante.
  useEffect(() => {
    if (task) return;
    setF((p) => ({
      ...p,
      status_id: p.status_id || String(statuses?.find((s) => s.is_default && s.active)?.id ?? statuses?.find((s) => s.active)?.id ?? ''),
      requester_id: p.requester_id || String(user?.id ?? ''),
    }));
  }, [statuses, user, task]);

  const filteredOutcomes = useMemo(
    () => (outcomes ?? []).filter((o) => !f.epic_id || String(o.epic_id) === f.epic_id),
    [outcomes, f.epic_id],
  );

  const onOutcome = (value: string) => {
    const o = outcomes?.find((x) => String(x.id) === value);
    setF((p) => ({ ...p, outcome_id: value, epic_id: o ? String(o.epic_id) : p.epic_id }));
  };
  const onEpic = (value: string) =>
    setF((p) => {
      const o = outcomes?.find((x) => String(x.id) === p.outcome_id);
      return { ...p, epic_id: value, outcome_id: o && String(o.epic_id) !== value ? '' : p.outcome_id };
    });

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { ...f };
      if (task) {
        body.started_at = localInputToIso(f.started_at);
        body.completed_at = localInputToIso(f.completed_at);
        return api.put<TaskDetail>(`/tasks/${task.id}`, body);
      }
      delete body.started_at;
      delete body.completed_at;
      return api.post<TaskDetail>('/tasks', body);
    },
    onSuccess: async (saved) => {
      await invalidate();
      if (task) onDone();
      else open(saved.id); // após criar, abre o detalhe da nova tarefa
    },
  });

  const activeOrCurrent = <T extends { id: number; active: number }>(list: T[] | undefined, cur: string) =>
    (list ?? []).filter((x) => x.active || String(x.id) === cur);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Field label="Título" required>
        <input className="input" value={f.title} onChange={set('title')} required autoFocus maxLength={200} />
      </Field>
      <Field label="Descrição">
        <textarea className="input min-h-20" value={f.description} onChange={set('description')} />
      </Field>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Setor interessado" required>
          <select className="input" value={f.sector_id} onChange={set('sector_id')} required>
            <option value="">Selecione…</option>
            {activeOrCurrent(sectors, f.sector_id).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Solicitante" required>
          <select className="input" value={f.requester_id} onChange={set('requester_id')} required>
            <option value="">Selecione…</option>
            {activeOrCurrent(users, f.requester_id).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Responsável" required>
          <select className="input" value={f.assignee_id} onChange={set('assignee_id')} required>
            <option value="">Selecione…</option>
            {activeOrCurrent(users, f.assignee_id).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Épico">
          <select className="input" value={f.epic_id} onChange={(e) => onEpic(e.target.value)}>
            <option value="">— Sem épico —</option>
            {(epics ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Outcome">
          <select className="input" value={f.outcome_id} onChange={(e) => onOutcome(e.target.value)}>
            <option value="">— Sem outcome —</option>
            {filteredOutcomes.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Status" required>
          <select className="input" value={f.status_id} onChange={set('status_id')} required>
            {activeOrCurrent(statuses, f.status_id).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Prioridade">
          <select className="input" value={f.priority} onChange={set('priority')}>
            {PRIORITY_KEYS.map((k) => (
              <option key={k} value={k}>
                {PRIORITY[k as Priority].label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tempo estimado (horas)">
          <input className="input" type="number" min="0" step="0.5" value={f.estimated_hours} onChange={set('estimated_hours')} />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Início previsto">
          <input className="input" type="date" value={f.planned_start_date} onChange={set('planned_start_date')} />
        </Field>
        <Field label="Conclusão prevista" required>
          <input className="input" type="date" value={f.planned_end_date} onChange={set('planned_end_date')} required />
        </Field>
      </div>

      {task && (
        <div className="rounded-lg bg-slate-50 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs text-slate-500">
            <CalendarClock size={14} /> Datas reais — preenchidas automaticamente pelas mudanças de status. Altere apenas
            para corrigir.
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Criada em">
              <input className="input" value={fmtDateTime(task.created_at)} disabled />
            </Field>
            <Field label="Início real">
              <input className="input" type="datetime-local" value={f.started_at} onChange={set('started_at')} />
            </Field>
            <Field label="Conclusão real">
              <input className="input" type="datetime-local" value={f.completed_at} onChange={set('completed_at')} />
            </Field>
          </div>
        </div>
      )}

      <IceFields
        values={f as Record<IceKey, string>}
        onChange={(k, v) => setF((p) => ({ ...p, [k]: v }))}
      />

      <Field label="Observações">
        <textarea className="input min-h-16" value={f.notes} onChange={set('notes')} />
      </Field>

      {save.error && (
        <div className="flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertTriangle size={14} /> {save.error.message}
        </div>
      )}
      <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancelar
        </button>
        <button type="submit" className="btn-primary" disabled={save.isPending}>
          {save.isPending ? 'Salvando…' : task ? 'Salvar alterações' : 'Criar tarefa'}
        </button>
      </div>
    </form>
  );
}
