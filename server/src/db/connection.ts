import fs from 'node:fs';
import path from 'node:path';
import type * as NodeSqlite from 'node:sqlite';
import { config } from '../config.js';
import { migrations } from './migrations.js';

/*
 * Usa o SQLite embutido no próprio Node.js (node:sqlite, Node 22.13+), sem dependência nativa:
 * `npm install` não precisa compilar nada (nem Python, nem Visual Studio Build Tools no Windows).
 *
 * O aviso "ExperimentalWarning: SQLite is an experimental feature" é suprimido apenas para o SQLite;
 * os demais avisos continuam aparecendo.
 */
const defaultWarningListeners = process.listeners('warning');
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w.name === 'ExperimentalWarning' && /SQLite/i.test(w.message)) return;
  for (const l of defaultWarningListeners) l.call(process, w);
});
const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof NodeSqlite;

type SqlParam = NodeSqlite.SQLInputValue;
type Row = Record<string, unknown>;

/** Statement com parâmetros posicionais e tipos de retorno práticos para o restante do código. */
export interface Statement {
  get(...params: unknown[]): Row | undefined;
  all(...params: unknown[]): Row[];
  run(...params: unknown[]): { changes: number; lastInsertRowid: number };
}

export interface DB {
  prepare(sql: string): Statement;
  exec(sql: string): void;
  /** Mesmo formato do better-sqlite3: `db.transaction(fn)()` executa fn dentro de uma transação. */
  transaction<T>(fn: () => T): () => T;
  close(): void;
}

/** Converte valores JS em tipos aceitos pelo SQLite (boolean → 0/1, undefined → NULL). */
function toParam(v: unknown): SqlParam {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v as SqlParam;
}

class SqliteDB implements DB {
  private depth = 0;
  constructor(private readonly db: NodeSqlite.DatabaseSync) {}

  prepare(sql: string): Statement {
    const stmt = this.db.prepare(sql);
    return {
      get: (...p) => stmt.get(...p.map(toParam)) as Row | undefined,
      all: (...p) => stmt.all(...p.map(toParam)) as Row[],
      run: (...p) => {
        const r = stmt.run(...p.map(toParam));
        return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
      },
    };
  }

  exec(sql: string) {
    this.db.exec(sql);
  }

  transaction<T>(fn: () => T): () => T {
    return () => {
      // Transações aninhadas viram SAVEPOINTs.
      const sp = `sp_${this.depth}`;
      this.db.exec(this.depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
      this.depth++;
      try {
        const result = fn();
        this.depth--;
        this.db.exec(this.depth === 0 ? 'COMMIT' : `RELEASE ${sp}`);
        return result;
      } catch (err) {
        this.depth--;
        this.db.exec(this.depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
        throw err;
      }
    };
  }

  close() {
    this.db.close();
  }
}

export function openDatabase(file: string = config.dbPath): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL');
  raw.exec('PRAGMA foreign_keys = ON');
  raw.exec('PRAGMA busy_timeout = 5000');
  return new SqliteDB(raw);
}

export function migrate(db: DB): string[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const applied = new Set(db.prepare('SELECT id FROM schema_migrations').all().map((r) => r.id as string));
  const done: string[] = [];
  for (const m of migrations) {
    if (applied.has(m.id)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(m.id, new Date().toISOString());
    })();
    done.push(m.id);
  }
  return done;
}
