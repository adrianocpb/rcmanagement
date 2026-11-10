import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Flag, KanbanSquare, RotateCcw, Target, Trash2 } from "lucide-react";
import { useState } from "react";
import { useInvalidateTasks } from "../components/TaskModal";
import {
  EmptyState,
  ErrorText,
  PageHeader,
  Spinner,
  StatusPill,
} from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDateTime } from "../lib/format";

type TrashType = "task" | "outcome" | "epic";
interface TrashItem {
  type: TrashType;
  id: number;
  title: string;
  detail: string | null;
  deleted_at: string;
  deleted_by_name: string | null;
  status_name: string | null;
  status_color: string | null;
  /** Outcome excluído junto com o épico: volta ao restaurar o épico. */
  with_epic?: boolean;
  purge_at: string;
  days_left: number;
}

const TYPE: Record<TrashType, { label: string; icon: typeof Flag }> = {
  epic: { label: "Épico", icon: Flag },
  outcome: { label: "Outcome", icon: Target },
  task: { label: "Tarefa", icon: KanbanSquare },
};
const FILTERS: { key: "" | TrashType; label: string }[] = [
  { key: "", label: "Todos" },
  { key: "epic", label: "Épicos" },
  { key: "outcome", label: "Outcomes" },
  { key: "task", label: "Tarefas" },
];

export function TrashPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const qc = useQueryClient();
  const invalidateTasks = useInvalidateTasks();
  const { data, isLoading, error } = useQuery({
    queryKey: ["trash"],
    queryFn: () => api.get<{ days: number; items: TrashItem[] }>("/trash"),
  });
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["trash"] }),
      invalidateTasks(),
    ]);
  const [filter, setFilter] = useState<"" | TrashType>("");

  const restore = useMutation({
    mutationFn: (i: TrashItem) => api.post(`/trash/${i.type}/${i.id}/restore`),
    onSuccess: refresh,
  });
  const purgeOne = useMutation({
    mutationFn: (i: TrashItem) => api.del(`/trash/${i.type}/${i.id}`),
    onSuccess: refresh,
  });
  const emptyAll = useMutation({
    mutationFn: () => api.del("/trash"),
    onSuccess: refresh,
  });

  const all = data?.items ?? [];
  const items = filter ? all.filter((i) => i.type === filter) : all;

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Lixeira"
        subtitle={`Épicos, outcomes e tarefas excluídos ficam aqui por ${data?.days ?? 30} dias e depois são removidos definitivamente.`}
        actions={
          isAdmin && (
            <button
              className="btn border border-red-300 bg-white text-red-700 shadow-xs hover:bg-red-50"
              disabled={!all.length || emptyAll.isPending}
              onClick={() =>
                confirm(
                  `Esvaziar a lixeira? ${all.length} item(ns) serão removidos DEFINITIVAMENTE. Não há como desfazer.`,
                ) && emptyAll.mutate()
              }
            >
              <Trash2 size={16} /> Esvaziar lixeira
            </button>
          )
        }
      />
      <ErrorText
        error={error ?? restore.error ?? purgeOne.error ?? emptyAll.error}
      />
      {isLoading && <Spinner />}
      {all.length > 0 && (
        <div
          className="mb-3 flex flex-wrap gap-1"
          role="tablist"
          aria-label="Tipo"
        >
          {FILTERS.map((f) => {
            const n = f.key
              ? all.filter((i) => i.type === f.key).length
              : all.length;
            return (
              <button
                key={f.key}
                role="tab"
                aria-selected={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded-full border px-3 py-1 text-sm ${filter === f.key ? "border-slate-900 bg-slate-900 text-[#eff0eb]" : "border-slate-300 bg-white text-slate-600 hover:border-slate-400"}`}
              >
                {f.label} ({n})
              </button>
            );
          })}
        </div>
      )}
      {data && items.length === 0 && (
        <EmptyState>
          {all.length ? "Nada deste tipo na lixeira." : "A lixeira está vazia."}
        </EmptyState>
      )}
      {items.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="th">Item</th>
                <th className="th">Status</th>
                <th className="th">Excluído em</th>
                <th className="th">Por</th>
                <th className="th">Remoção em</th>
                <th className="th" />
              </tr>
            </thead>
            <tbody>
              {items.map((t) => {
                const T = TYPE[t.type];
                return (
                  <tr
                    key={`${t.type}-${t.id}`}
                    className="border-b border-slate-100 last:border-0"
                  >
                    <td className="td">
                      <div className="flex items-start gap-2">
                        <T.icon
                          size={14}
                          className="mt-1 shrink-0 text-slate-400"
                          aria-label={T.label}
                        />
                        <div>
                          <div className="font-medium text-slate-900">
                            {t.title}
                          </div>
                          <div className="text-xs text-slate-500">
                            {T.label} #{t.id}
                            {t.detail && ` · ${t.detail}`}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="td">
                      {t.status_name && (
                        <StatusPill
                          name={t.status_name}
                          color={t.status_color ?? "#94a3b8"}
                        />
                      )}
                    </td>
                    <td className="td whitespace-nowrap text-slate-600">
                      {fmtDateTime(t.deleted_at)}
                    </td>
                    <td className="td whitespace-nowrap text-slate-600">
                      {t.deleted_by_name ?? "—"}
                    </td>
                    <td className="td whitespace-nowrap">
                      <span
                        className={
                          t.days_left <= 3
                            ? "font-semibold text-red-600"
                            : "text-slate-600"
                        }
                      >
                        {t.days_left === 0
                          ? "hoje"
                          : `em ${t.days_left} dia${t.days_left > 1 ? "s" : ""}`}
                      </span>
                    </td>
                    <td className="td">
                      <div className="flex justify-end gap-1">
                        {t.with_epic ? (
                          <span
                            className="self-center text-xs text-slate-500"
                            title="Foi excluído junto com o épico"
                          >
                            volta com o épico
                          </span>
                        ) : (
                          <button
                            className="btn-secondary py-1"
                            disabled={restore.isPending}
                            onClick={() => restore.mutate(t)}
                          >
                            <RotateCcw size={14} /> Restaurar
                          </button>
                        )}
                        {isAdmin && (
                          <button
                            className="btn-danger py-1"
                            title="Excluir definitivamente"
                            disabled={purgeOne.isPending}
                            onClick={() =>
                              confirm(
                                `Excluir "${t.title}" DEFINITIVAMENTE?${t.type === "epic" ? " Os outcomes dele também serão excluídos." : ""}${t.type !== "task" ? " As tarefas ligadas continuam existindo, sem o vínculo." : ""} Não há como desfazer.`,
                              ) && purgeOne.mutate(t)
                            }
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!isAdmin && items.length > 0 && (
        <p className="mt-3 text-xs text-slate-500">
          Somente administradores podem esvaziar a lixeira ou excluir itens
          definitivamente.
        </p>
      )}
    </div>
  );
}
