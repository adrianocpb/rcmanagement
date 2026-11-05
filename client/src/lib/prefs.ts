import { useEffect, useState } from 'react';

/** Preferências por usuário no navegador (visualização e filtros). Falhas de storage são ignoradas. */
export function usePersistentState<T extends object>(key: string, initial: T) {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? { ...initial, ...JSON.parse(raw) } : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      /* ignora */
    }
  }, [key, v]);
  return [v, setV] as const;
}
