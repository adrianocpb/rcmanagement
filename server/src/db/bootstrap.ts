import { hashPassword } from '../lib/auth.js';
import { nowIso } from '../lib/time.js';
import type { DB } from './connection.js';

/**
 * Primeira execução em um banco vazio (sem seed de demonstração): cria o administrador inicial
 * e o fluxo de status padrão, para que o sistema seja utilizável imediatamente.
 */
export function bootstrap(db: DB) {
  const now = nowIso();
  const users = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
  if (users.n === 0) {
    const email = process.env.ADMIN_EMAIL ?? 'admin@empresa.com';
    const password = process.env.ADMIN_PASSWORD ?? 'admin123';
    db.prepare(
      `INSERT INTO users (name, email, password_hash, role, active, created_at, updated_at) VALUES (?, ?, ?, 'admin', 1, ?, ?)`,
    ).run('Administrador', email, hashPassword(password), now, now);
    console.log(`Administrador inicial criado: ${email} (altere a senha em Administração → Usuários).`);
  }
  const statuses = db.prepare('SELECT COUNT(*) AS n FROM statuses').get() as { n: number };
  if (statuses.n === 0) {
    const insert = db.prepare(
      `INSERT INTO statuses (name, color, position, is_default, is_start_status, is_completion_status, counts_in_wip, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    );
    [
      ['Backlog', '#64748b', 1, 0, 0],
      ['Priorizado', '#8b5cf6', 0, 0, 0],
      ['Em desenvolvimento', '#2563eb', 0, 1, 0],
      ['Em validação', '#d97706', 0, 0, 0],
      ['Concluído', '#16a34a', 0, 0, 1],
    ].forEach(([name, color, def, start, done], i) => insert.run(name, color, i + 1, def, start, done, def || done ? 0 : 1, now, now));
  }
}
