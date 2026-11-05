import type { Status } from '../lib/api';
import { useStatuses } from '../lib/queries';

/** Status (coluna do quadro) de outcomes e épicos: os mesmos das tarefas. Vazio = status padrão. */
export function StatusSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data: statuses } = useStatuses();
  const def = statuses?.filter((s) => s.active).sort((a, b) => b.is_default - a.is_default || a.position - b.position)[0];
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      {!value && <option value="">{def ? `${def.name} (padrão)` : 'Status padrão'}</option>}
      {statuses
        ?.filter((s) => s.active || String(s.id) === value)
        .map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
    </select>
  );
}

/** Chave de ordenação "como no quadro": coluna (posição do status) e, dentro dela, a ordem manual. */
export const boardOrderKey =
  (statuses: Status[] | undefined) =>
  (r: { status_id: number | null; board_position: number | null }) => {
    const col = statuses?.findIndex((s) => s.id === r.status_id) ?? -1;
    return (col < 0 ? 999 : col) * 1e12 + (r.board_position ?? 0);
  };
