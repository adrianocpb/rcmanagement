import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ErrorText } from "./ui";

/** Botão "mover para a lixeira" de épicos e outcomes (somente administradores). */
export function TrashButton({
  url,
  confirmText,
  backTo,
}: {
  url: string;
  confirmText: string;
  backTo: string;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const del = useMutation({
    mutationFn: () => api.del(url),
    onSuccess: async () => {
      await Promise.all(
        [
          "epics",
          "epic",
          "outcomes",
          "outcome",
          "tasks",
          "task",
          "trash",
          "dashboard",
        ].map((k) => qc.invalidateQueries({ queryKey: [k] })),
      );
      navigate(backTo);
    },
  });
  if (user?.role !== "admin") return null;
  return (
    <>
      <button
        className="btn-danger"
        title="Mover para a lixeira"
        disabled={del.isPending}
        onClick={() => confirm(confirmText) && del.mutate()}
      >
        <Trash2 size={14} />
      </button>
      {del.error && <ErrorText error={del.error} />}
    </>
  );
}
