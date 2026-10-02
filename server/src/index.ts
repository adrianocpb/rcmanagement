import { createApp } from './app.js';
import { config } from './config.js';
import { bootstrap } from './db/bootstrap.js';
import { migrate, openDatabase } from './db/connection.js';

const db = openDatabase();
const applied = migrate(db);
if (applied.length) console.log(`Migrations aplicadas: ${applied.join(', ')}`);
bootstrap(db);

createApp(db).listen(config.port, () => {
  console.log(`API em http://localhost:${config.port} (fuso: ${config.timezone}, banco: ${config.dbPath})`);
});
