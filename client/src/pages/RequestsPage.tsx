import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Flag, HelpCircle, KanbanSquare, Paperclip, Pencil, Plus, Target, XCircle } from 'lucide-react';
import { useState } from 'react';
import {
  AttachmentList,
  ConvertedProgressView,
  RequestFormModal,
  RequestLink,
  RequestStatusBadge,
} from '../components/Requests';
import { TaskForm } from '../components/TaskModal';
import { EmptyState, ErrorText, Field, Modal, PageHeader, Spinner } from '../components/ui';
import { api, type ConvertType, type ImprovementRequest, type ImprovementRequestDetail, type RequestStatus } from '../lib/api';
import { useAuth } from '../lib/auth';
import { CONVERT_LABEL, REQUEST_STATUS, fmtDateOfInstant, fmtDateTime } from '../lib/format';
import { EpicFormModal } from './EpicsPage';
import { OutcomeFormModal } from './OutcomesPage';

/** "Minhas solicitações": disponível a todos os perfis. */
export function RequestsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['requests', 'mine'],
    queryFn: () => api.get<ImprovementRequest[]>('/requests/mine'),
  });
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Minhas solicitações"
        subtitle="Envie ideias de melhoria e acompanhe a análise e o andamento de cada uma."
        actions={
          <button className="btn-primary" onClick={() => setCreating(true)}>
            <Plus size={16} /> Nova solicitação
          </button>
        }
      />
      <ErrorText error={error} />
      {isLoading && <Spinner />}
      {data?.length === 0 && <EmptyState>Você ainda não enviou nenhuma solicitação. Clique em “Nova solicitação” para começar.</EmptyState>}
      <div className="space-y-3">
        {data?.map((r) => (
          <RequestCard key={r.id} request={r} onOpen={() => setOpenId(r.id)} />
        ))}
      </div>
      {creating && <RequestFormModal onClose={() => setCreating(false)} />}
      {openId != null && <RequestDetailModal id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function RequestCard({ request: r, onOpen, showRequester }: { request: ImprovementRequest; onOpen: () => void; showRequester?: boolean }) {
  return (
    <button onClick={onOpen} className="card block w-full p-4 text-left transition hover:border-blue-300 hover:shadow-md">
      <div className="flex flex-wrap items-start gap-2">
        <span className="text-sm text-slate-400">#{r.id}</span>
        <h2 className="min-w-0 flex-1 font-semibold text-slate-900">{r.title}</h2>
        <RequestStatusBadge status={r.status} />
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-500">
        {showRequester && <span className="font-medium text-slate-700">{r.requester_name}</span>}
        <span>{r.sector_name ?? 'Sem setor'}</span>
        <span>Enviada em {fmtDateOfInstant(r.created_at)}</span>
        {r.attachments_count > 0 && (
          <span className="inline-flex items-center gap-0.5">
            <Paperclip size={12} /> {r.attachments_count}
          </span>
        )}
      </div>
      {(r.status === 'info' || r.status === 'recusada') && r.decision_note && (
        <p className={`mt-2 rounded-md px-3 py-1.5 text-sm ${r.status === 'info' ? 'bg-blue-50 text-blue-800' : 'bg-slate-100 text-slate-700'}`}>
          <b>{r.status === 'info' ? 'Mais informação: ' : 'Motivo: '}</b>
          {r.decision_note}
        </p>
      )}
      {r.converted && (
        <div className="mt-2 border-t border-slate-100 pt-2">
          <ConvertedProgressView progress={r.converted} />
        </div>
      )}
    </button>
  );
}

// ---------------- Aprovações (administrador) ----------------

const TABS: RequestStatus[] = ['aguardando', 'info', 'aprovada', 'recusada'];

export function ApprovalsPage() {
  const [tab, setTab] = useState<RequestStatus>('aguardando');
  const [openId, setOpenId] = useState<number | null>(null);
  const counts = useRequestCounts();
  const { data, isLoading, error } = useQuery({
    queryKey: ['requests', 'all', tab],
    queryFn: () => api.get<ImprovementRequest[]>(`/requests?status=${tab}`),
  });
  return (
    <div className="max-w-5xl">
      <PageHeader title="Aprovações" subtitle="Analise as solicitações de melhoria e transforme as aprovadas em tarefa, outcome ou épico." />
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap ${
              tab === k ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {REQUEST_STATUS[k].label}
            <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 text-xs text-slate-600">{counts.data?.[k] ?? 0}</span>
          </button>
        ))}
      </div>
      <ErrorText error={error} />
      {isLoading && <Spinner />}
      {data?.length === 0 && <EmptyState>Nenhuma solicitação nesta situação.</EmptyState>}
      <div className="space-y-3">
        {data?.map((r) => (
          <RequestCard key={r.id} request={r} showRequester onOpen={() => setOpenId(r.id)} />
        ))}
      </div>
      {openId != null && <RequestDetailModal id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

export function useRequestCounts(enabled = true) {
  return useQuery({
    queryKey: ['requests', 'counts'],
    queryFn: () => api.get<Record<RequestStatus, number>>('/requests/counts'),
    enabled,
    refetchInterval: 60_000,
  });
}

// ---------------- Detalhe ----------------

function RequestDetailModal({ id, onClose }: { id: number; onClose: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isAdmin = user?.role === 'admin';
  const { data: r, isLoading, error } = useQuery({
    queryKey: ['requests', 'detail', id],
    queryFn: () => api.get<ImprovementRequestDetail>(`/requests/${id}`),
  });
  const [editing, setEditing] = useState(false);
  const [decision, setDecision] = useState<'info' | 'reject' | null>(null);
  const [converting, setConverting] = useState<ConvertType | null>(null);

  if (editing && r) return <RequestFormModal request={r} onClose={() => setEditing(false)} />;
  if (converting && r) {
    return (
      <ConvertModal
        request={r}
        type={converting}
        onCancel={() => setConverting(null)}
        onDone={async () => {
          await qc.invalidateQueries({ queryKey: ['requests'] });
          setConverting(null);
        }}
      />
    );
  }

  const pending = r && (r.status === 'aguardando' || r.status === 'info');
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={
        r ? (
          <div className="flex items-center gap-2">
            <span className="text-slate-400">#{r.id}</span>
            <span className="truncate">{r.title}</span>
          </div>
        ) : (
          'Solicitação'
        )
      }
    >
      {isLoading && <Spinner />}
      <ErrorText error={error} />
      {r && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <RequestStatusBadge status={r.status} />
            <span className="text-sm text-slate-500">
              {r.requester_name} · {r.sector_name ?? 'Sem setor'} · {fmtDateTime(r.created_at)}
            </span>
            {r.can_edit && (
              <button className="btn-secondary ml-auto" onClick={() => setEditing(true)}>
                <Pencil size={14} /> {r.status === 'info' ? 'Complementar e reenviar' : 'Editar'}
              </button>
            )}
          </div>

          {r.decision_note && (
            <div className={`rounded-md px-3 py-2 text-sm ${r.status === 'info' ? 'bg-blue-50 text-blue-800' : 'bg-slate-100 text-slate-700'}`}>
              <b>{r.status === 'info' ? 'Mais informação solicitada' : 'Motivo da recusa'}</b>
              {r.decided_by_name && ` (${r.decided_by_name}, ${fmtDateTime(r.decided_at)})`}: {r.decision_note}
            </div>
          )}

          <Block label="Descrição">{r.description}</Block>
          <Block label="Como melhora o dia a dia ou a empresa">{r.benefit}</Block>
          {r.success_indicator && <Block label="Como saberemos que deu certo">{r.success_indicator}</Block>}
          {r.link && (
            <div>
              <div className="text-xs text-slate-500">Link</div>
              <RequestLink href={r.link} />
            </div>
          )}
          <div>
            <div className="mb-1 text-xs text-slate-500">Anexos</div>
            <AttachmentList attachments={r.attachments} />
          </div>

          {r.converted && (
            <div className="rounded-lg bg-green-50/60 p-3">
              <div className="mb-1 text-xs font-semibold text-green-800">
                Aprovada{r.decided_by_name && ` por ${r.decided_by_name}`} em {fmtDateTime(r.decided_at)} · virou {CONVERT_LABEL[r.converted.type]}
              </div>
              <ConvertedProgressView progress={r.converted} linkable={user?.role !== 'requester'} />
            </div>
          )}

          {isAdmin && pending && (
            <div className="border-t border-slate-200 pt-4">
              {decision ? (
                <DecisionForm id={r.id} action={decision} onCancel={() => setDecision(null)} onDone={() => setDecision(null)} />
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="mr-1 text-sm font-medium text-slate-700">Aprovar como:</span>
                  <button className="btn-primary" onClick={() => setConverting('task')}>
                    <KanbanSquare size={14} /> Tarefa
                  </button>
                  <button className="btn-primary" onClick={() => setConverting('outcome')}>
                    <Target size={14} /> Outcome
                  </button>
                  <button className="btn-primary" onClick={() => setConverting('epic')}>
                    <Flag size={14} /> Épico
                  </button>
                  <div className="ml-auto flex flex-wrap gap-2">
                    {r.status === 'aguardando' && (
                      <button className="btn-secondary" onClick={() => setDecision('info')}>
                        <HelpCircle size={14} /> Pedir informação
                      </button>
                    )}
                    <button className="btn-danger" onClick={() => setDecision('reject')}>
                      <XCircle size={14} /> Recusar
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function Block({ label, children }: { label: string; children: string }) {
  return (
    <div className="text-sm">
      <div className="text-xs text-slate-500">{label}</div>
      <p className="whitespace-pre-wrap text-slate-800">{children}</p>
    </div>
  );
}

function DecisionForm({ id, action, onCancel, onDone }: { id: number; action: 'info' | 'reject'; onCancel: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const save = useMutation({
    mutationFn: () => api.post(`/requests/${id}/decision`, { action, note }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['requests'] });
      onDone();
    },
  });
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Field label={action === 'info' ? 'O que precisa ser complementado?' : 'Motivo da recusa (visível ao solicitante)'} required>
        <textarea className="input min-h-20" value={note} onChange={(e) => setNote(e.target.value)} required autoFocus />
      </Field>
      <ErrorText error={save.error} />
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Voltar
        </button>
        <button className={action === 'info' ? 'btn-primary' : 'btn-danger'} disabled={save.isPending}>
          {action === 'info' ? 'Devolver ao solicitante' : 'Recusar solicitação'}
        </button>
      </div>
    </form>
  );
}

// ---------------- Conversão ----------------

function noteFrom(r: ImprovementRequestDetail) {
  return [
    `Solicitação #${r.id} de ${r.requester_name}.`,
    `Benefício esperado: ${r.benefit}`,
    r.success_indicator && `Como saberemos que deu certo: ${r.success_indicator}`,
    r.link && `Link: ${r.link}`,
  ]
    .filter(Boolean)
    .join('\n');
}

function ConvertModal({
  request: r,
  type,
  onCancel,
  onDone,
}: {
  request: ImprovementRequestDetail;
  type: ConvertType;
  onCancel: () => void;
  onDone: () => void;
}) {
  const submit = (data: Record<string, unknown>) => api.post(`/requests/${r.id}/convert`, { type, data });
  const banner = (
    <div className="mb-3 flex items-center gap-2 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
      <CheckCircle2 size={16} /> Revise os dados: ao salvar, a solicitação #{r.id} será aprovada e vinculada a este item.
    </div>
  );
  if (type === 'task') {
    return (
      <Modal open onClose={onCancel} title={`Aprovar solicitação #${r.id} como tarefa`} size="lg">
        {banner}
        <TaskForm
          defaults={{ requester_id: r.requester_id, ...(r.sector_id ? { sector_id: r.sector_id } : {}) }}
          prefill={{ title: r.title, description: r.description, notes: noteFrom(r) }}
          submit={submit}
          submitLabel="Aprovar e criar tarefa"
          onDone={onDone}
          onCancel={onCancel}
        />
      </Modal>
    );
  }
  const description = `${r.description}\n\n${noteFrom(r)}`;
  if (type === 'outcome') {
    return (
      <OutcomeFormModal
        title={`Aprovar solicitação #${r.id} como outcome`}
        banner={banner}
        prefill={{ name: r.title, description, indicator_name: r.success_indicator ?? '' }}
        submit={submit}
        onClose={onCancel}
        onSaved={onDone}
      />
    );
  }
  return (
    <EpicFormModal
      title={`Aprovar solicitação #${r.id} como épico`}
      banner={banner}
      prefill={{ name: r.title, description }}
      submit={submit}
      onClose={onCancel}
      onSaved={onDone}
    />
  );
}
