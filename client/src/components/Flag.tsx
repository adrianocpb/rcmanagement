/**
 * Flag (marcador de bloqueio) de tarefas e outcomes: sinaliza que o item depende de algo externo,
 * por exemplo a área de negócio remover uma barreira, enviar um documento ou liberar um acesso.
 */
import { useMutation } from "@tanstack/react-query";
import { Flag } from "lucide-react";
import { useState } from "react";
import { api, type FlagEvent } from "../lib/api";
import { fmtDateTime } from "../lib/format";
import { ErrorText } from "./ui";

export interface Flaggable {
  flagged_at: string | null;
  flag_reason: string | null;
  flagged_by_name?: string | null;
}

/** Selo compacto para cards e listas. */
export function FlagBadge({
  item,
  label = true,
}: {
  item: Flaggable;
  label?: boolean;
}) {
  if (!item.flagged_at) return null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800"
      title={`Com flag desde ${fmtDateTime(item.flagged_at)}${item.flag_reason ? `: ${item.flag_reason}` : ""}`}
    >
      <Flag size={11} className="fill-current" />
      {label && "Flag"}
    </span>
  );
}

/** Painel do detalhe: mostra a flag atual e permite colocar ou retirar (com motivo/observação). */
export function FlagControl({
  item,
  url,
  onChanged,
}: {
  item: Flaggable;
  url: string;
  onChanged: () => unknown;
}) {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("");
  const flagged = !!item.flagged_at;
  const save = useMutation({
    mutationFn: () => api.put(url, { flagged: !flagged, note }),
    onSuccess: async () => {
      await onChanged();
      setEditing(false);
      setNote("");
    },
  });

  const form = editing && (
    <div className="mt-2 space-y-2">
      <textarea
        className="input min-h-16 bg-white"
        autoFocus
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={500}
        placeholder={
          flagged
            ? "Como foi resolvido? (opcional)"
            : "Motivo do bloqueio (ex.: aguardando o negócio liberar acesso ao ERP)"
        }
      />
      <div className="flex justify-end gap-2">
        <button
          className="btn-secondary py-1"
          onClick={() => (setEditing(false), setNote(""))}
        >
          Cancelar
        </button>
        <button
          className="btn-primary py-1"
          disabled={save.isPending}
          onClick={() => save.mutate()}
        >
          {flagged ? "Retirar flag" : "Adicionar flag"}
        </button>
      </div>
      <ErrorText error={save.error} />
    </div>
  );

  if (!flagged) {
    return (
      <div>
        {!editing && (
          <button
            className="btn-ghost -ml-2 py-1 text-sm"
            onClick={() => setEditing(true)}
            title="Sinaliza um bloqueio: depende de algo externo"
          >
            <Flag size={14} /> Adicionar flag
          </button>
        )}
        {form}
      </div>
    );
  }
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <div className="flex flex-wrap items-start gap-2">
        <Flag
          size={16}
          className="mt-0.5 shrink-0 fill-current text-amber-700"
        />
        <div className="min-w-0 flex-1">
          <div className="font-medium">Com flag (bloqueio)</div>
          {item.flag_reason && (
            <p className="whitespace-pre-wrap">{item.flag_reason}</p>
          )}
          <div className="text-xs text-amber-800/80">
            desde {fmtDateTime(item.flagged_at)}
            {item.flagged_by_name && ` · por ${item.flagged_by_name}`}
          </div>
        </div>
        {!editing && (
          <button
            className="btn-secondary py-1"
            onClick={() => setEditing(true)}
          >
            Retirar flag
          </button>
        )}
      </div>
      {form}
    </div>
  );
}

/** Texto de um evento de flag no histórico. */
export function FlagEventText({ e }: { e: FlagEvent }) {
  return (
    <>
      <b>{e.action === "add" ? "Flag adicionada" : "Flag retirada"}</b>
      {e.note && <span className="text-slate-600"> — {e.note}</span>}
    </>
  );
}
