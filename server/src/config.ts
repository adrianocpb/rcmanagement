import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// server/src (dev) ou server/dist (build) → raiz do repositório
const repoRoot = path.resolve(here, '..', '..');

/**
 * Configuração central da aplicação.
 * Todas as variáveis de ambiente são lidas apenas aqui.
 */
export const config = {
  port: Number(process.env.PORT ?? 3001),
  dbPath: process.env.DB_PATH ?? path.join(repoRoot, 'data', 'app.db'),
  /** Fuso horário de negócio: usado para "hoje", atrasos, períodos do dashboard e exibição. */
  timezone: process.env.APP_TIMEZONE ?? 'America/Sao_Paulo',
  sessionDays: Number(process.env.SESSION_DAYS ?? 7),
  /** Dias que uma tarefa excluída fica na lixeira antes de ser removida definitivamente. */
  trashDays: Number(process.env.TRASH_DAYS ?? 30),
  clientDist: path.join(repoRoot, 'client', 'dist'),
};
