import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { applyPendingImport, dailyBackup } from '../src/db/backup.js';
import { migrate, openDatabase } from '../src/db/connection.js';
import { seedDemo } from '../src/db/seed.js';
import { LoginThrottle } from '../src/lib/security.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rcm-deploy-'));

describe('publicação na web', () => {
  it('envia cabeçalhos de segurança', async () => {
    const db = openDatabase(':memory:');
    migrate(db);
    const res = await request(createApp(db)).get('/api/health').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('bloqueia o login após muitas senhas erradas e libera depois da janela', async () => {
    const db = openDatabase(':memory:');
    migrate(db);
    db.transaction(() => seedDemo(db))();
    const app = createApp(db);
    for (let i = 0; i < 10; i++) {
      await request(app).post('/api/auth/login').send({ email: 'admin@empresa.com', password: 'errada' }).expect(401);
    }
    const blocked = await request(app).post('/api/auth/login').send({ email: 'admin@empresa.com', password: 'admin123' }).expect(429);
    expect(blocked.body.error).toContain('Muitas tentativas');
    // Outro usuário, de outro e-mail, também é barrado pelo mesmo IP
    await request(app).post('/api/auth/login').send({ email: 'maria@empresa.com', password: '123456' }).expect(429);

    const t = new LoginThrottle(3, 1000);
    t.fail(['k'], 0);
    t.fail(['k'], 10);
    t.fail(['k'], 20);
    expect(t.blockedFor(['k'], 30)).toBeGreaterThan(0);
    expect(t.blockedFor(['k'], 1021)).toBe(0);
  });

  it('backup diário: uma cópia por dia e mantém só as mais recentes', () => {
    const dir = tmp();
    const db = openDatabase(path.join(dir, 'app.db'));
    migrate(db);
    const backups = path.join(dir, 'backups');
    const days = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'];
    for (const d of days) expect(dailyBackup(db, backups, 2, d)).toBe(path.join(backups, `app-${d}.db`));
    expect(dailyBackup(db, backups, 2, '2026-10-04')).toBeNull(); // já existe a do dia
    expect(fs.readdirSync(backups).sort()).toEqual(['app-2026-10-03.db', 'app-2026-10-04.db']);
    const copy = openDatabase(path.join(backups, 'app-2026-10-04.db'));
    expect(copy.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get()).toBeTruthy();
    db.close();
  });

  it('importa um banco enviado como app-import.db, guardando o anterior', () => {
    const dir = tmp();
    const dbPath = path.join(dir, 'app.db');
    fs.writeFileSync(dbPath, 'antigo');
    fs.writeFileSync(path.join(dir, 'app-import.db'), 'novo');
    expect(applyPendingImport(dbPath)).toBe(true);
    expect(fs.readFileSync(dbPath, 'utf8')).toBe('novo');
    expect(fs.existsSync(path.join(dir, 'app-import.db'))).toBe(false);
    const saved = fs.readdirSync(path.join(dir, 'backups'));
    expect(saved.some((f) => f.startsWith('antes-da-importacao-'))).toBe(true);
    expect(applyPendingImport(dbPath)).toBe(false); // nada pendente
  });
});
