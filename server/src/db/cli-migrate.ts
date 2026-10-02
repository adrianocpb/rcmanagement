import { migrate, openDatabase } from './connection.js';

const applied = migrate(openDatabase());
console.log(applied.length ? `Migrations aplicadas: ${applied.join(', ')}` : 'Banco já está atualizado.');
