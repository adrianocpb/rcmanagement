import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, FileText, Film, Image, Inbox, Paperclip, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Attachment, type ConvertedProgress, type ImprovementRequestDetail, type OriginRequest, type RequestStatus } from '../lib/api';
import { useAuth } from '../lib/auth';
import { CONVERT_LABEL, REQUEST_STATUS, fmtBytes, fmtDate, fmtDateOfInstant } from '../lib/format';
import { useSectors } from '../lib/queries';
import { pct, PlanStatusBadge } from '../pages/EpicsPage';
import { DeadlineBadge, ErrorText, Field, Modal, ProgressBar, StatusPill } from './ui';

export const MAX_FILES = 5;
export const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
export const ACCEPT = '.png,.jpg,.jpeg,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.mp4,.webm,.mov';

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  const s = REQUEST_STATUS[status];
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${s.cls}`}>{s.label}</span>;
}

function AttachmentIcon({ mime }: { mime: string }) {
  if (mime.startsWith('image/')) return <Image size={14} />;
  if (mime.startsWith('video/')) return <Film size={14} />;
  return <FileText size={14} />;
}

/** Lista de anexos com miniatura das imagens; cada item abre/baixa o arquivo. */
export function AttachmentList({ attachments }: { attachments: Attachment[] }) {
  if (!attachments.length) return <p className="text-sm text-slate-400">Sem anexos.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {attachments.map((a) => (
        <a
          key={a.id}
          href={a.url}
          target="_blank"
          rel="noopener noreferrer"
          className="group flex max-w-60 items-center gap-2 rounded-lg border border-slate-200 bg-white p-1.5 pr-3 text-sm hover:border-blue-300"
          title={a.filename}
        >
          {a.mime_type.startsWith('image/') ? (
            <img src={a.url} alt="" className="size-10 shrink-0 rounded object-cover" loading="lazy" />
          ) : (
            <span className="flex size-10 shrink-0 items-center justify-center rounded bg-slate-100 text-slate-500">
              <AttachmentIcon mime={a.mime_type} />
            </span>
          )}
          <span className="min-w-0">
            <span className="block truncate text-slate-800 group-hover:text-blue-700">{a.filename}</span>
            <span className="text-xs text-slate-500">{fmtBytes(a.size)}</span>
          </span>
        </a>
      ))}
    </div>
  );
}

const itemPath = (p: { type: string; id: number }) =>
  p.type === 'task' ? `/tarefas?task=${p.id}` : p.type === 'outcome' ? `/outcomes/${p.id}` : `/epicos/${p.id}`;

/** Andamento do item gerado (o que o solicitante acompanha). */
export function ConvertedProgressView({ progress, linkable }: { progress: ConvertedProgress; linkable?: boolean }) {
  const label = `${CONVERT_LABEL[progress.type]} #${progress.id}`;
  if (progress.removed) return <span className="text-sm text-slate-500">{label} — removido(a)</span>;
  return (
    <div className="space-y-1.5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {linkable ? (
          <Link to={itemPath(progress)} className="font-medium text-blue-700 hover:underline">
            {label}
          </Link>
        ) : (
          <span className="font-medium text-slate-700">{label}</span>
        )}
        {progress.type === 'task' ? (
          <>
            <StatusPill name={progress.status_name ?? ''} color={progress.status_color ?? '#94a3b8'} />
            {progress.deadline_state && <DeadlineBadge state={progress.deadline_state} />}
          </>
        ) : (
          progress.plan_status && <PlanStatusBadge status={progress.plan_status} />
        )}
      </div>
      {progress.type === 'task' ? (
        <div className="text-xs text-slate-500">
          Responsável: {progress.assignee_name ?? '—'}
          {progress.planned_end_date && <> · Previsão: {fmtDate(progress.planned_end_date)}</>}
        </div>
      ) : (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <ProgressBar value={pct(progress.tasks_done ?? 0, progress.tasks_count ?? 0)} className="max-w-40" />
          {progress.tasks_done ?? 0}/{progress.tasks_count ?? 0} tarefas concluídas
        </div>
      )}
    </div>
  );
}

/** Quadro "Origem: solicitação #N" exibido em tarefas, outcomes e épicos gerados por aprovação. */
export function OriginRequestCard({ origin }: { origin: OriginRequest | null | undefined }) {
  if (!origin) return null;
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-sm">
      <div className="mb-1 flex flex-wrap items-center gap-x-2 text-xs font-semibold text-amber-800">
        <Inbox size={14} /> Origem: solicitação #{origin.id} · {origin.requester_name} · {fmtDateOfInstant(origin.created_at)}
      </div>
      <div className="font-medium text-slate-800">{origin.title}</div>
      <p className="mt-1 whitespace-pre-wrap text-slate-600">
        <span className="text-slate-500">Benefício esperado: </span>
        {origin.benefit}
      </p>
      {origin.success_indicator && (
        <p className="text-slate-600">
          <span className="text-slate-500">Como saber se deu certo: </span>
          {origin.success_indicator}
        </p>
      )}
      {origin.link && <RequestLink href={origin.link} />}
      {origin.attachments.length > 0 && (
        <div className="mt-2">
          <AttachmentList attachments={origin.attachments} />
        </div>
      )}
    </div>
  );
}

export function RequestLink({ href }: { href: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 break-all text-blue-700 hover:underline">
      <ExternalLink size={13} /> {href}
    </a>
  );
}

// ---------------- Formulário (nova solicitação / edição pelo solicitante) ----------------

export function RequestFormModal({ request, onClose }: { request?: ImprovementRequestDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: sectors } = useSectors();
  const fileInput = useRef<HTMLInputElement>(null);
  const [f, setF] = useState({
    title: request?.title ?? '',
    description: request?.description ?? '',
    benefit: request?.benefit ?? '',
    success_indicator: request?.success_indicator ?? '',
    link: request?.link ?? '',
    sector_id: String(request?.sector_id ?? user?.sector_id ?? ''),
  });
  const [files, setFiles] = useState<File[]>([]);
  const [removeIds, setRemoveIds] = useState<number[]>([]);
  const [localError, setLocalError] = useState('');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));

  const kept = (request?.attachments ?? []).filter((a) => !removeIds.includes(a.id));
  const totalCount = kept.length + files.length;
  const totalBytes = kept.reduce((s, a) => s + a.size, 0) + files.reduce((s, x) => s + x.size, 0);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const next = [...files, ...Array.from(list)];
    const bytes = kept.reduce((s, a) => s + a.size, 0) + next.reduce((s, x) => s + x.size, 0);
    if (kept.length + next.length > MAX_FILES) setLocalError(`Máximo de ${MAX_FILES} anexos por solicitação.`);
    else if (bytes > MAX_TOTAL_BYTES) setLocalError(`Os anexos somariam ${fmtBytes(bytes)}; o limite é 10 MB no total.`);
    else {
      setLocalError('');
      setFiles(next);
    }
    if (fileInput.current) fileInput.current.value = '';
  };

  const save = useMutation({
    mutationFn: () => {
      const form = new FormData();
      for (const [k, v] of Object.entries(f)) form.append(k, v);
      for (const file of files) form.append('files', file, file.name);
      if (request) {
        form.append('remove_attachment_ids', removeIds.join(','));
        return api.upload('PUT', `/requests/${request.id}`, form);
      }
      return api.upload('POST', '/requests', form);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['requests'] });
      onClose();
    },
  });

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={request ? `Editar solicitação #${request.id}` : 'Nova solicitação de melhoria'}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn-primary" form="request-form" disabled={save.isPending}>
            {save.isPending ? 'Enviando…' : request ? 'Salvar e reenviar' : 'Enviar solicitação'}
          </button>
        </>
      }
    >
      <form
        id="request-form"
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        {request?.status === 'info' && request.decision_note && (
          <div className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800">
            <b>O administrador pediu mais informação:</b> {request.decision_note}
          </div>
        )}
        <Field label="Nome da melhoria" required>
          <input className="input" value={f.title} onChange={set('title')} required autoFocus maxLength={200} placeholder="Ex.: Alerta de clientes sem contato" />
        </Field>
        <Field label="Descrição" required>
          <textarea className="input min-h-24" value={f.description} onChange={set('description')} required placeholder="O que você precisa? Como é feito hoje?" />
        </Field>
        <Field label="Como isso melhora o dia a dia ou a empresa?" required>
          <textarea className="input min-h-16" value={f.benefit} onChange={set('benefit')} required placeholder="Ex.: economiza 3 horas por semana da equipe comercial" />
        </Field>
        <Field label="Como saberemos que deu certo? (indicador)">
          <input className="input" value={f.success_indicator} onChange={set('success_indicator')} placeholder="Ex.: tempo médio de resposta ao cliente" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Setor">
            <select className="input" value={f.sector_id} onChange={set('sector_id')}>
              <option value="">—</option>
              {sectors
                ?.filter((s) => s.active || String(s.id) === f.sector_id)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Link (opcional)">
            <input className="input" type="url" value={f.link} onChange={set('link')} placeholder="https://…" />
          </Field>
        </div>

        <div>
          <div className="label flex items-center justify-between">
            <span>Anexos</span>
            <span className="font-normal text-slate-500">
              {totalCount}/{MAX_FILES} arquivos · {fmtBytes(totalBytes)} de 10 MB
            </span>
          </div>
          <div className="space-y-1.5">
            {kept.map((a) => (
              <FileRow key={a.id} name={a.filename} size={a.size} onRemove={() => setRemoveIds((p) => [...p, a.id])} />
            ))}
            {files.map((file, i) => (
              <FileRow key={`${file.name}-${i}`} name={file.name} size={file.size} onRemove={() => setFiles((p) => p.filter((_, j) => j !== i))} />
            ))}
          </div>
          <input ref={fileInput} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => addFiles(e.target.files)} />
          <button
            type="button"
            className="btn-secondary mt-2"
            disabled={totalCount >= MAX_FILES}
            onClick={() => fileInput.current?.click()}
          >
            <Paperclip size={14} /> Adicionar arquivos
          </button>
          <p className="mt-1 text-xs text-slate-500">Imagens, PDF, Word/Excel/PowerPoint, CSV/TXT ou vídeos curtos (MP4, WEBM, MOV).</p>
        </div>
        {localError && <ErrorText error={localError} />}
        <ErrorText error={save.error} />
      </form>
    </Modal>
  );
}

function FileRow({ name, size, onRemove }: { name: string; size: number; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-slate-200 px-2 py-1 text-sm">
      <Paperclip size={13} className="shrink-0 text-slate-400" />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <span className="text-xs text-slate-500">{fmtBytes(size)}</span>
      <button type="button" className="btn-ghost p-0.5" onClick={onRemove} title="Remover anexo">
        <X size={14} />
      </button>
    </div>
  );
}
