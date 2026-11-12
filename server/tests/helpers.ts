import crypto from 'node:crypto';
import path from 'node:path';
import request from 'supertest';
import { config } from '../src/config.js';
import { createApp } from '../src/app.js';
import { migrate, openDatabase } from '../src/db/connection.js';
import { seedDemo } from '../src/db/seed.js';

// Cada arquivo de teste usa sua própria pasta de anexos: os bancos em memória repetem ids de
// tarefas, e um teste que esvazia a lixeira não pode apagar arquivos de outro rodando em paralelo.
config.uploadsDir = path.join(config.uploadsDir, crypto.randomUUID());

export async function setup() {
  const db = openDatabase(':memory:');
  migrate(db);
  db.transaction(() => seedDemo(db))();
  const app = createApp(db);
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email: 'admin@empresa.com', password: 'admin123' }).expect(200);
  const userAgent = request.agent(app);
  await userAgent.post('/api/auth/login').send({ email: 'maria@empresa.com', password: '123456' }).expect(200);
  const statuses = (await agent.get('/api/statuses')).body as { id: number; name: string }[];
  const byName = (n: string) => statuses.find((s) => s.name === n)!.id;
  return { db, app, agent, userAgent, byName };
}
