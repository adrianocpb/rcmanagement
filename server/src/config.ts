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
  /** Pasta dos anexos das solicitações (deve ficar em disco persistente e entrar no backup). */
  uploadsDir: process.env.UPLOADS_DIR ?? path.join(repoRoot, 'data', 'uploads'),
  /** Servindo via HTTPS (produção): cookie de sessão só trafega criptografado e o navegador força HTTPS. */
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  /** Atrás de um proxy (Fly.io, Railway, Nginx): usa o IP real do visitante (limite de tentativas de login). */
  trustProxy: process.env.TRUST_PROXY === 'true',
  /** Cópias diárias do banco (pasta e quantas manter). Vazio = ao lado do banco, em backups/. */
  backupDir: process.env.BACKUP_DIR ?? '',
  backupKeep: Number(process.env.BACKUP_KEEP ?? 7),
};
