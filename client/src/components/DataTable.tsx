import { ArrowDown, ArrowUp } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { EmptyState } from './ui';

export type Column<T> = {
  key: string;
  label: string;
  sort?: (row: T) => string | number | null;
  render: (row: T) => ReactNode;
  className?: string;
  /** Direção do primeiro clique: -1 = do maior para o menor. */
  defaultDir?: 1 | -1;
  /** Permite quebra de linha (padrão: sem quebra). */
  wrap?: boolean;
};

/** Tabela com ordenação por coluna (clique no cabeçalho). Usada nas listas de tarefas, outcomes e épicos. */
export function DataTable<T extends { id: number }>({
  rows,
  columns,
  defaultSort,
  onRowClick,
  rowClassName,
  empty,
  count,
}: {
  rows: T[];
  columns: Column<T>[];
  defaultSort: { key: string; dir: 1 | -1 };
  onRowClick: (row: T) => void;
  rowClassName?: (row: T) => string;
  empty: string;
  count: (n: number) => string;
}) {
  const [sort, setSort] = useState(defaultSort);

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sort) return rows;
    return [...rows].sort((a, b) => {
      const va = col.sort!(a);
      const vb = col.sort!(b);
      if (va === vb) return 0;
      if (va === null || va === '') return 1; // vazios sempre no fim
      if (vb === null || vb === '') return -1;
      return (va < vb ? -1 : 1) * sort.dir;
    });
  }, [rows, columns, sort]);

  if (rows.length === 0) return <EmptyState>{empty}</EmptyState>;

  return (
    <div className="card overflow-x-auto">
      <table className="w-full border-collapse">
        <thead className="border-b border-slate-200 bg-slate-50">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={`th ${c.className ?? ''}`}>
                {c.sort ? (
                  <button
                    className="inline-flex items-center gap-1 uppercase hover:text-slate-800"
                    onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? (s.dir === 1 ? -1 : 1) : (c.defaultDir ?? 1) }))}
                  >
                    {c.label}
                    {sort.key === c.key && (sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                  </button>
                ) : (
                  c.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr
              key={r.id}
              onClick={() => onRowClick(r)}
              className={`cursor-pointer border-b border-slate-100 last:border-0 hover:bg-blue-50/50 ${rowClassName?.(r) ?? ''}`}
            >
              {columns.map((c) => (
                <td key={c.key} className={`td ${c.wrap ? '' : 'whitespace-nowrap'}`}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-slate-200 px-3 py-2 text-xs text-slate-500">{count(rows.length)}</div>
    </div>
  );
}
