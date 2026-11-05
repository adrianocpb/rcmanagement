import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Paperclip, Pencil, Trash2, X } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState, type ClipboardEvent, type ReactNode } from 'react';
import { api, type TaskComment } from '../lib/api';
import { fmtBytes, fmtDateTime } from '../lib/format';
import { ACCEPT } from '../lib/files';
import { AttachmentList } from './Requests';
import { useInvalidateTasks } from './TaskModal';
import { Avatar, ErrorText } from './ui';

const MAX_FILES = 5;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXT = new Set(ACCEPT.split(','));
const extOf = (name: string) => name.slice(name.lastIndexOf('.')).toLowerCase();
const isImage = (mime: string) => /^image\/(png|jpeg|gif|webp)$/.test(mime);
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

/** Texto com links: http(s)://… vira link clicável (abre em outra aba); o resto fica como texto. */
export function Linkified({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const re = /https?:\/\/[^\s<>"']+/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    let href = m[0];
    // Pontuação no fim da frase não faz parte do link.
    const trail = href.match(/[.,;:!?)\]]+$/)?.[0] ?? '';
    if (trail) href = href.slice(0, -trail.length);
    parts.push(text.slice(last, m.index));
    parts.push(
      <a key={m.index} href={href} target="_blank" rel="noopener noreferrer" className="break-all text-slate-900 underline underline-offset-2 hover:text-slate-500">
        {href}
      </a>,
    );
    last = (m.index ?? 0) + href.length;
  }
  parts.push(text.slice(last));
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>{p}</Fragment>
      ))}
    </>
  );
}

export function TaskComments({ taskId }: { taskId: number }) {
  const key = ['task', taskId, 'comments'];
  const { data: comments, isLoading, error } = useQuery({
    queryKey: key,
    queryFn: () => api.get<TaskComment[]>(`/tasks/${taskId}/comments`),
  });
  return (
    <div className="space-y-4">
      <ErrorText error={error} />
      {isLoading && <p className="text-sm text-slate-500">Carregando comentários…</p>}
      {comments?.length === 0 && <p className="text-sm text-slate-500">Nenhum comentário ainda.</p>}
      {comments?.map((c) => <CommentItem key={c.id} taskId={taskId} comment={c} />)}
      <Composer taskId={taskId} />
    </div>
  );
}

function useRefresh(taskId: number) {
  const qc = useQueryClient();
  const invalidateTasks = useInvalidateTasks();
  return () => Promise.all([qc.invalidateQueries({ queryKey: ['task', taskId, 'comments'] }), invalidateTasks()]);
}

function CommentItem({ taskId, comment: c }: { taskId: number; comment: TaskComment }) {
  const refresh = useRefresh(taskId);
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(c.body);
  const save = useMutation({
    mutationFn: () => api.put(`/tasks/${taskId}/comments/${c.id}`, { body }),
    onSuccess: async () => {
      await refresh();
      setEditing(false);
    },
  });
  const del = useMutation({ mutationFn: () => api.del(`/tasks/${taskId}/comments/${c.id}`), onSuccess: refresh });
  // Imagens aparecem como miniaturas; PDF, Word, Excel etc. como itens para abrir/baixar.
  const images = c.attachments.filter((a) => isImage(a.mime_type));
  const others = c.attachments.filter((a) => !isImage(a.mime_type));

  return (
    <article className="flex gap-3">
      <Avatar name={c.author_name} id={c.author_id} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
          <span className="text-sm font-medium text-slate-900">{c.author_name}</span>
          <span>{fmtDateTime(c.created_at)}</span>
          {c.edited && <span title={`Editado em ${fmtDateTime(c.updated_at)}`}>(editado)</span>}
          <span className="ml-auto flex gap-0.5">
            {c.can_edit && !editing && (
              <button className="btn-ghost p-1" onClick={() => setEditing(true)} title="Editar comentário" aria-label="Editar comentário">
                <Pencil size={14} />
              </button>
            )}
            {c.can_delete && (
              <button
                className="btn-ghost p-1"
                onClick={() => confirm('Excluir este comentário (e os anexos dele)?') && del.mutate()}
                title="Excluir comentário"
                aria-label="Excluir comentário"
              >
                <Trash2 size={14} />
              </button>
            )}
          </span>
        </div>
        {editing ? (
          <div className="mt-1 space-y-2">
            <textarea className="input min-h-20" value={body} onChange={(e) => setBody(e.target.value)} autoFocus />
            <div className="flex justify-end gap-2">
              <button
                className="btn-secondary"
                onClick={() => {
                  setBody(c.body);
                  setEditing(false);
                }}
              >
                Cancelar
              </button>
              <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
                Salvar
              </button>
            </div>
          </div>
        ) : (
          c.body && (
            <p className="mt-0.5 text-sm whitespace-pre-wrap text-slate-700">
              <Linkified text={c.body} />
            </p>
          )
        )}
        {images.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {images.map((i) => (
              <a key={i.id} href={i.url} target="_blank" rel="noopener noreferrer" title={`${i.filename} (${fmtBytes(i.size)})`}>
                <img src={i.url} alt={i.filename} loading="lazy" className="h-24 max-w-48 rounded-md border border-slate-200 object-cover hover:opacity-90" />
              </a>
            ))}
          </div>
        )}
        {others.length > 0 && (
          <div className="mt-2">
            <AttachmentList attachments={others} />
          </div>
        )}
        <ErrorText error={save.error ?? del.error} />
      </div>
    </article>
  );
}

function Composer({ taskId }: { taskId: number }) {
  const refresh = useRefresh(taskId);
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [localError, setLocalError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const previews = useMemo(() => files.map((f) => (isImage(f.type) ? URL.createObjectURL(f) : '')), [files]);
  useEffect(() => () => previews.forEach((u) => u && URL.revokeObjectURL(u)), [previews]);

  const add = (list: File[]) => {
    const ok = list.filter((f) => ALLOWED_EXT.has(extOf(f.name)));
    if (ok.length < list.length) setLocalError('Formato não permitido. Use imagem, PDF, Word, Excel, PowerPoint, CSV, TXT ou vídeo.');
    const next = [...files, ...ok];
    const bytes = next.reduce((s, f) => s + f.size, 0);
    if (next.length > MAX_FILES) return setLocalError(`Máximo de ${MAX_FILES} arquivos por comentário.`);
    if (bytes > MAX_TOTAL_BYTES) return setLocalError(`Os anexos somariam ${fmtBytes(bytes)}; o limite é 10 MB.`);
    if (ok.length === list.length) setLocalError('');
    setFiles(next);
  };

  // Print copiado (Ctrl+V): vira anexo com nome legível.
  const onPaste = (e: ClipboardEvent) => {
    const pasted = Array.from(e.clipboardData.files).filter((f) => isImage(f.type));
    if (!pasted.length) return;
    e.preventDefault();
    const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    add(pasted.map((f, i) => new File([f], `print-${stamp}${i ? `-${i}` : ''}.${EXT[f.type] ?? 'png'}`, { type: f.type })));
  };

  const send = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append('body', body);
      for (const f of files) form.append('files', f, f.name);
      return api.upload('POST', `/tasks/${taskId}/comments`, form);
    },
    onSuccess: async () => {
      setBody('');
      setFiles([]);
      setLocalError('');
      await refresh();
    },
  });
  const canSend = (body.trim() || files.length) && !send.isPending;

  return (
    <div className="rounded-md border border-slate-200 p-3">
      <textarea
        className="input min-h-20"
        placeholder="Escreva um comentário… Anexe arquivos (PDF, Word, Excel, imagens…) ou cole um print com Ctrl+V; links (https://…) ficam clicáveis."
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onPaste={onPaste}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && canSend) send.mutate();
        }}
        aria-label="Novo comentário"
      />
      {files.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {files.map((f, i) => (
            <div key={`${i}-${f.name}-${f.size}`} className="relative">
              {previews[i] ? (
                <img src={previews[i]} alt={f.name} className="h-16 w-24 rounded-md border border-slate-200 object-cover" />
              ) : (
                <div className="flex h-16 w-40 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 text-xs" title={f.name}>
                  <FileText size={16} className="shrink-0 text-slate-500" />
                  <span className="min-w-0">
                    <span className="block truncate text-slate-800">{f.name}</span>
                    <span className="text-slate-500">{fmtBytes(f.size)}</span>
                  </span>
                </div>
              )}
              <button
                type="button"
                className="absolute -top-2 -right-2 rounded-full bg-white p-0.5 text-slate-600 elev-card hover:text-slate-900"
                onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}
                aria-label={`Remover ${f.name}`}
                title="Remover anexo"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          add(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
      {localError && <p className="mt-2 text-sm text-red-700">{localError}</p>}
      <ErrorText error={send.error} />
      <div className="mt-2 flex items-center gap-2">
        <button type="button" className="btn-ghost" onClick={() => input.current?.click()} disabled={files.length >= MAX_FILES}>
          <Paperclip size={16} /> Anexar
        </button>
        <span className="text-xs text-slate-500">Ctrl+Enter para enviar</span>
        <button className="btn-primary ml-auto" disabled={!canSend} onClick={() => send.mutate()}>
          {send.isPending ? 'Enviando…' : 'Comentar'}
        </button>
      </div>
    </div>
  );
}
