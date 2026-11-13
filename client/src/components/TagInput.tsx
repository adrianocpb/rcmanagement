/** Campo de tags: digite e tecle Enter (ou vírgula) para adicionar; sugere as tags já existentes. */
import { useState } from 'react';
import { useTags } from '../lib/queries';
import { TagChip } from './ui';

const MAX = 10;

export function TagInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { data: tags } = useTags();
  const [text, setText] = useState('');
  const colorOf = (n: string) => tags?.find((t) => t.name.toLowerCase() === n.toLowerCase())?.color ?? null;

  const add = (raw: string) => {
    const name = raw.trim().replace(/\s+/g, ' ').slice(0, 40);
    setText('');
    if (!name || value.length >= MAX || value.some((v) => v.toLowerCase() === name.toLowerCase())) return;
    // Usa a grafia da tag existente (ex.: "kynera" → "Kynera").
    const existing = tags?.find((t) => t.name.toLowerCase() === name.toLowerCase());
    onChange([...value, existing?.name ?? name]);
  };
  const suggestions = (tags ?? []).filter((t) => !value.some((v) => v.toLowerCase() === t.name.toLowerCase()));

  return (
    <div className="input flex min-h-[38px] flex-wrap items-center gap-1 py-1">
      {value.map((n) => (
        <TagChip key={n} name={n} color={colorOf(n)} onRemove={() => onChange(value.filter((v) => v !== n))} />
      ))}
      <input
        className="min-w-32 flex-1 bg-transparent text-sm outline-none"
        list="tag-suggestions"
        value={text}
        maxLength={40}
        disabled={value.length >= MAX}
        placeholder={value.length ? '' : 'Ex.: Kynera (Enter para adicionar)'}
        onChange={(e) => {
          // Escolher uma sugestão da lista adiciona direto.
          const v = e.target.value;
          if (suggestions.some((t) => t.name === v)) add(v);
          else setText(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add(text);
          } else if (e.key === 'Backspace' && !text && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => text.trim() && add(text)}
        aria-label="Adicionar tag"
      />
      <datalist id="tag-suggestions">
        {suggestions.map((t) => (
          <option key={t.id} value={t.name} />
        ))}
      </datalist>
    </div>
  );
}
