import type { Horizon } from '../lib/api';
import { HORIZON, HORIZON_KEYS } from '../lib/format';

/** Campo "Horizonte" dos formulários de épico e outcome (vazio = não definido). */
export function HorizonSelect({ value, onChange }: { value: string; onChange: (v: Horizon | '') => void }) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value as Horizon | '')}>
      <option value="">Não definido</option>
      {HORIZON_KEYS.map((k) => (
        <option key={k} value={k} title={HORIZON[k].hint}>
          {HORIZON[k].label}
        </option>
      ))}
    </select>
  );
}

/** Filtro por horizonte (listas e dashboard). */
export function HorizonFilter({ value, onChange, className = '' }: { value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <select className={`input w-auto py-1.5${value ? ' filter-active' : ''} ${className}`} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Horizonte">
      <option value="">Horizonte: todos</option>
      {HORIZON_KEYS.map((k) => (
        <option key={k} value={k}>
          {HORIZON[k].label}
        </option>
      ))}
    </select>
  );
}
