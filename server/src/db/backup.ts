import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { todayLocal } from '../lib/time.js';
import type { DB } from './connection.js';

/** Pasta das cópias: BACKUP_DIR ou "backups/" ao lado do arquivo do banco. */
export function backupDirectory(dbPath = config.dbPath) {
  return config.backupDir || path.join(path.dirname(dbPath), 'backups');
}

/**
 * Cópia diária do banco (VACUUM INTO gera um arquivo consistente mesmo com o sistema em uso).
 * Faz no máximo uma por dia e mantém as `keep` mais recentes. Retorna o arquivo criado, ou null.
 */
export function dailyBackup(db: DB, dir = backupDirectory(), keep = config.backupKeep, today = todayLocal()) {
  if (config.dbPath === ':memory:') return null;
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `app-${today}.db`);
  let created: string | null = null;
  if (!fs.existsSync(file)) {
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    created = file;
  }
  const old = fs
    .readdirSync(dir)
    .filter((f) => /^app-\d{4}-\d{2}-\d{2}\.db$/.test(f))
    .sort()
    .reverse()
    .slice(Math.max(keep, 1));
  for (const f of old) fs.rmSync(path.join(dir, f), { force: true });
  return created;
}

/**
 * Importação de um banco existente (ex.: o do notebook) num servidor: se houver um arquivo
 * "app-import.db" ao lado do banco, ele substitui o atual na subida do sistema. O banco anterior
 * é guardado em backups/ com a data e a hora. Deve rodar ANTES de abrir o banco.
 */
export function applyPendingImport(dbPath = config.dbPath) {
  if (dbPath === ':memory:') return false;
  const incoming = path.join(path.dirname(dbPath), 'app-import.db');
  if (!fs.existsSync(incoming)) return false;
  if (fs.existsSync(dbPath)) {
    const dir = backupDirectory(dbPath);
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.renameSync(dbPath, path.join(dir, `antes-da-importacao-${stamp}.db`));
  }
  for (const suffix of ['-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });
  fs.renameSync(incoming, dbPath);
  return true;
}
