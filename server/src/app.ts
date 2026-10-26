import fs from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express from 'express';
import { config } from './config.js';
import type { DB } from './db/connection.js';
import { requireAuth, requireTeam, sessionMiddleware } from './lib/auth.js';
import { errorHandler, HttpError } from './lib/http.js';
import { todayLocal } from './lib/time.js';
import { authRouter } from './modules/auth.js';
import { dashboardRouter } from './modules/dashboard/router.js';
import { epicsRouter } from './modules/epics.js';
import { outcomesRouter } from './modules/outcomes.js';
import { requestsRouter } from './modules/requests/router.js';
import { sectorsRouter } from './modules/sectors.js';
import { statusesRouter } from './modules/statuses.js';
import { tasksRouter } from './modules/tasks/router.js';
import { usersRouter } from './modules/users.js';

export function createApp(db: DB) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(sessionMiddleware(db));

  const api = express.Router();
  api.get('/health', (_req, res) => res.json({ ok: true }));
  api.use('/auth', authRouter(db));
  api.use(requireAuth);
  api.get('/config', (_req, res) => res.json({ timezone: config.timezone, today: todayLocal() }));
  // Disponível a todos os perfis (inclusive Solicitante)
  api.use('/sectors', sectorsRouter(db));
  api.use('/requests', requestsRouter(db));
  // Somente equipe (administradores e usuários)
  api.use('/users', requireTeam, usersRouter(db));
  api.use('/statuses', requireTeam, statusesRouter(db));
  api.use('/epics', requireTeam, epicsRouter(db));
  api.use('/outcomes', requireTeam, outcomesRouter(db));
  api.use('/tasks', requireTeam, tasksRouter(db));
  api.use('/dashboard', requireTeam, dashboardRouter(db));
  api.use((_req, _res, next) => next(new HttpError(404, 'Rota não encontrada.')));
  app.use('/api', api);

  // Em produção o próprio servidor entrega o frontend compilado (um único processo para deploy).
  if (fs.existsSync(config.clientDist)) {
    app.use(express.static(config.clientDist));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(config.clientDist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
