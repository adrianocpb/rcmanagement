import { z } from 'zod';

/**
 * Modelo dos 3 horizontes: H1 = negócio atual (core), H2 = negócios emergentes (expansão),
 * H3 = opções de futuro (novas apostas). Opcional em épicos e outcomes.
 */
export const HORIZONS = ['H1', 'H2', 'H3'] as const;
export type Horizon = (typeof HORIZONS)[number];

/** '' ou null = sem horizonte; undefined = não informado (na edição, mantém o atual). */
export const horizonSchema = z.preprocess((v) => (v === '' ? null : v), z.enum(HORIZONS).nullish());
