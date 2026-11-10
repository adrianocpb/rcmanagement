import { createApp } from './app.js';
import { config } from './config.js';
import { applyPendingImport, dailyBackup } from './db/backup.js';
import { bootstrap } from './db/bootstrap.js';
import { migrate, openDatabase } from './db/connection.js';
import { purgeAllTrash } from './modules/trash.js';

if (applyPendingImport()) console.log('Banco importado de app-import.db (o anterior foi guardado em backups/).');
const db = openDatabase();
const applied = migrate(db);
if (applied.length) console.log(`Migrations aplicadas: ${applied.join(', ')}`);
bootstrap(db);

// Lixeira: remove definitivamente o que foi excluído há mais de N dias (na subida e a cada 6 horas).
const cleanTrash = () => {
  const removed = purgeAllTrash(db, config.trashDays);
  if (removed) console.log(`Lixeira: ${removed} item(ns) removido(s) definitivamente (mais de ${config.trashDays} dias).`);
};
cleanTrash();
setInterval(cleanTrash, 6 * 60 * 60 * 1000).unref();

// Backup: uma cópia por dia do banco (na subida e a cada hora verifica se a do dia já existe).
const backup = () => {
  try {
    const file = dailyBackup(db);
    if (file) console.log(`Backup do banco: ${file}`);
  } catch (err) {
    console.error('Falha no backup do banco:', err);
  }
};
backup();
setInterval(backup, 60 * 60 * 1000).unref();

createApp(db).listen(config.port, () => {
  console.log(`API em http://localhost:${config.port} (fuso: ${config.timezone}, banco: ${config.dbPath})`);
});
