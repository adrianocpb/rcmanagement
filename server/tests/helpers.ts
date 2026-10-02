import request from 'supertest';
import { createApp } from '../src/app.js';
import { migrate, openDatabase } from '../src/db/connection.js';
import { seedDemo } from '../src/db/seed.js';

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
