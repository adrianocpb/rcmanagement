import { Gauge } from 'lucide-react';
import { Field } from './ui';

/**
 * Priorização ICE: Impacto, Confiança e Facilidade (1–10).
 * ICE score = impacto × confiança × facilidade (1 a 1000). O valor oficial é calculado pelo servidor;
 * aqui o cálculo serve apenas para pré-visualizar enquanto o usuário preenche.
 */
export const ICE_FACTORS = [
  { key: 'ice_impact', label: 'Impacto', hint: 'Quanto contribui para o resultado (1 = pouco, 10 = muito)' },
  { key: 'ice_confidence', label: 'Confiança', hint: 'Quão seguros estamos da estimativa (1 = palpite, 10 = evidência)' },
  { key: 'ice_ease', label: 'Facilidade', hint: 'Quão fácil é executar (1 = muito difícil, 10 = muito fácil)' },
] as const;

export type IceKey = (typeof ICE_FACTORS)[number]['key'];

export function computeIce(values: Record<IceKey, string | number | null | undefined>): number | null {
  const nums = ICE_FACTORS.map((f) => Number(values[f.key]));
  if (ICE_FACTORS.some((f) => values[f.key] === '' || values[f.key] == null)) return null;
  if (nums.some((n) => !Number.isInteger(n) || n < 1 || n > 10)) return null;
  return nums[0] * nums[1] * nums[2];
}

/** Cor do ICE score por faixa (máximo 1000). */
function iceTone(score: number) {
  if (score >= 343) return 'bg-emerald-600 text-white'; // equivale a ≥ 7 em todos os fatores
  if (score >= 125) return 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-600/20'; // ≥ 5 em todos
  return 'bg-slate-100 text-slate-600 ring-1 ring-slate-400/20';
}

export function IceBadge({ score, compact }: { score: number | null | undefined; compact?: boolean }) {
  if (score == null) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${iceTone(score)}`}
      title="ICE score = impacto × confiança × facilidade"
    >
      <Gauge size={11} />
      {compact ? score : `ICE ${score}`}
    </span>
  );
}

/** Campos de formulário: os três fatores + ICE score calculado (somente leitura). */
export function IceFields<T extends Record<IceKey, string>>({ values, onChange }: { values: T; onChange: (key: IceKey, value: string) => void }) {
  const score = computeIce(values);
  return (
    <fieldset className="rounded-lg border border-slate-200 p-3">
      <legend className="px-1 text-xs font-semibold text-slate-500 uppercase">Priorização (ICE)</legend>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {ICE_FACTORS.map((f) => (
          <Field key={f.key} label={`${f.label} (1–10)`}>
            <input
              className="input"
              type="number"
              min={1}
              max={10}
              step={1}
              inputMode="numeric"
              title={f.hint}
              placeholder="—"
              value={values[f.key]}
              onChange={(e) => onChange(f.key, e.target.value)}
            />
          </Field>
        ))}
        <Field label="ICE score">
          <div className="flex h-[34px] items-center rounded-md border border-slate-200 bg-slate-50 px-2.5 text-sm font-semibold text-slate-900 tabular-nums">
            {score ?? <span className="font-normal text-slate-400">preencha os 3 fatores</span>}
          </div>
        </Field>
      </div>
      <p className="mt-2 text-xs text-slate-500">ICE score = Impacto × Confiança × Facilidade (de 1 a 1000). Quanto maior, maior a prioridade.</p>
    </fieldset>
  );
}

/** Exibição somente leitura dos fatores (detalhe de tarefa/outcome). */
export function IceStrip({ item }: { item: Partial<Record<IceKey | 'ice_score', number | null>> }) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {ICE_FACTORS.map((f) => (
        <div key={f.key} className="rounded-lg bg-slate-50 px-2 py-1.5 text-center" title={f.hint}>
          <div className="text-[11px] text-slate-500 uppercase">{f.label}</div>
          <div className="text-base font-semibold text-slate-800 tabular-nums">{item[f.key] ?? '—'}</div>
        </div>
      ))}
      <div className="rounded-lg bg-emerald-50 px-2 py-1.5 text-center ring-1 ring-emerald-600/20" title="Impacto × Confiança × Facilidade">
        <div className="text-[11px] text-emerald-700 uppercase">ICE score</div>
        <div className="text-base font-bold text-emerald-800 tabular-nums">
          {item.ice_score ?? <span className="text-sm font-normal text-slate-400">não estimado</span>}
        </div>
      </div>
    </div>
  );
}

// ---------- Ordenação ----------

export type IceSortKey = IceKey | 'ice_score';

export const ICE_SORT_OPTIONS: { key: IceSortKey; label: string }[] = [
  { key: 'ice_score', label: 'ICE score' },
  { key: 'ice_impact', label: 'Impacto' },
  { key: 'ice_confidence', label: 'Confiança' },
  { key: 'ice_ease', label: 'Facilidade' },
];

/** Ordena do maior para o menor; itens sem valor vão para o fim. Empates mantêm a ordem original. */
export function sortByIce<T extends Partial<Record<IceSortKey, number | null>>>(list: T[], key: IceSortKey | ''): T[] {
  if (!key) return list;
  return list
    .map((item, i) => ({ item, i }))
    .sort((a, b) => {
      const va = a.item[key];
      const vb = b.item[key];
      if (va == null && vb == null) return a.i - b.i;
      if (va == null) return 1;
      if (vb == null) return -1;
      return vb - va || a.i - b.i;
    })
    .map((x) => x.item);
}
