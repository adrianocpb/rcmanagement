/**
 * Dados de demonstração. Uso: `npm run seed` (apaga e recria o banco configurado em DB_PATH).
 * As datas são relativas ao dia de hoje, para que atrasos, throughput e aging façam sentido
 * sempre que o seed for executado.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { hashPassword } from '../lib/auth.js';
import { addDays, todayLocal, zonedWallTimeToUtc } from '../lib/time.js';
import { migrate, openDatabase, type DB } from './connection.js';

type StatusKey = 'backlog' | 'priorizado' | 'dev' | 'validacao' | 'concluido';

interface SeedTask {
  title: string;
  description?: string;
  sector: string;
  requester: string;
  assignee: string;
  outcome?: string;
  epic?: string;
  priority: 'baixa' | 'media' | 'alta' | 'urgente';
  hours?: number;
  /** dias atrás em que a tarefa foi criada */
  createdAgo: number;
  /** transições: [dias após a criação, status] */
  path: [number, StatusKey][];
  /** prazo: dias a partir de hoje (negativo = passado) */
  dueIn: number;
  startIn?: number;
  notes?: string;
}

export function seedDemo(db: DB, now = new Date()) {
  const today = todayLocal(now);
  // Instante de "dia local + horário", no fuso da aplicação.
  const at = (dateStr: string, hour = 10) => zonedWallTimeToUtc(dateStr, `${String(hour).padStart(2, '0')}:00:00`).toISOString();
  const nowIso = now.toISOString();
  const clamp = (iso: string) => (iso > nowIso ? nowIso : iso);

  const insertUser = db.prepare(
    `INSERT INTO users (name, email, password_hash, role, active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)`,
  );
  const userPass = hashPassword('123456');
  const users: Record<string, number> = {};
  const created = at(addDays(today, -200));
  users.Admin = Number(insertUser.run('Administrador', 'admin@empresa.com', hashPassword('admin123'), 'admin', created, created).lastInsertRowid);
  for (const [name, email, role] of [
    ['João', 'joao@empresa.com', 'admin'],
    ['Maria', 'maria@empresa.com', 'user'],
    ['Pedro', 'pedro@empresa.com', 'user'],
    ['Ana', 'ana@empresa.com', 'user'],
  ] as const) {
    users[name] = Number(insertUser.run(name, email, userPass, role, created, created).lastInsertRowid);
  }

  const sectors: Record<string, number> = {};
  for (const name of ['Comercial', 'Operações', 'Financeiro', 'Pessoas', 'Diretoria']) {
    sectors[name] = Number(
      db.prepare('INSERT INTO sectors (name, active, created_at, updated_at) VALUES (?, 1, ?, ?)').run(name, created, created)
        .lastInsertRowid,
    );
  }

  const statuses: Record<StatusKey, number> = {} as Record<StatusKey, number>;
  const statusDefs: [StatusKey, string, string, number, number, number][] = [
    // chave, nome, cor, padrão, início, conclusão
    ['backlog', 'Backlog', '#64748b', 1, 0, 0],
    ['priorizado', 'Priorizado', '#8b5cf6', 0, 0, 0],
    ['dev', 'Em desenvolvimento', '#2563eb', 0, 1, 0],
    ['validacao', 'Em validação', '#d97706', 0, 0, 0],
    ['concluido', 'Concluído', '#16a34a', 0, 0, 1],
  ];
  statusDefs.forEach(([key, name, color, def, start, done], i) => {
    statuses[key] = Number(
      db
        .prepare(
          `INSERT INTO statuses (name, color, position, is_default, is_start_status, is_completion_status, active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        )
        .run(name, color, i + 1, def, start, done, created, created).lastInsertRowid,
    );
  });

  const epics: Record<string, number> = {};
  const insertEpic = db.prepare(
    `INSERT INTO epics (name, description, okr, owner_id, status, start_date, end_date, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  );
  for (const [name, desc, okr, owner, status, startAgo, endIn] of [
    ['Eficiência no Atendimento', 'Automatizar e simplificar o fluxo de atendimento ao cliente.', 'O1 2026 — Elevar a satisfação do cliente (NPS ≥ 70)', 'Maria', 'em_andamento', 120, 90],
    ['Automação Financeira', 'Reduzir trabalho manual em conciliação e faturamento.', 'O2 2026 — Reduzir custo operacional em 15%', 'João', 'em_andamento', 100, 120],
    ['Gestão de Pessoas Digital', 'Digitalizar processos de RH e onboarding.', 'O3 2026 — Melhorar a experiência do colaborador', 'Ana', 'planejado', 30, 180],
  ] as const) {
    epics[name] = Number(
      insertEpic.run(name, desc, okr, users[owner], status, addDays(today, -startAgo), addDays(today, endIn), created, created)
        .lastInsertRowid,
    );
  }

  const outcomes: Record<string, { id: number; epic: number }> = {};
  const insertOutcome = db.prepare(
    `INSERT INTO outcomes (epic_id, name, description, owner_id, status, start_date, target_date, indicator_name,
                           indicator_unit, baseline_value, target_value, current_value, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  );
  for (const [epic, name, desc, owner, status, ind, unit, base, target, current] of [
    ['Eficiência no Atendimento', 'Reduzir tempo médio de atendimento', 'Diminuir o tempo entre abertura e resolução de chamados.', 'Maria', 'em_andamento', 'Tempo médio de atendimento', 'horas', 48, 24, 31],
    ['Eficiência no Atendimento', 'Aumentar resolução no primeiro contato', 'Mais chamados resolvidos sem escalonamento.', 'Pedro', 'em_andamento', 'Resolução no 1º contato', '%', 55, 75, 63],
    ['Automação Financeira', 'Reduzir tempo de conciliação bancária', 'Conciliação automática de extratos.', 'João', 'em_andamento', 'Tempo de conciliação mensal', 'horas', 40, 8, 22],
    ['Automação Financeira', 'Eliminar erros de faturamento', 'Validações automáticas antes da emissão.', 'João', 'planejado', 'Notas emitidas com erro', 'notas/mês', 30, 2, 30],
    ['Gestão de Pessoas Digital', 'Onboarding 100% digital', 'Admissão sem papel.', 'Ana', 'planejado', 'Admissões digitais', '%', 0, 100, 10],
  ] as const) {
    const id = Number(
      insertOutcome.run(
        epics[epic], name, desc, users[owner], status, addDays(today, -90), addDays(today, 90), ind, unit, base, target, current, created, created,
      ).lastInsertRowid,
    );
    outcomes[name] = { id, epic: epics[epic] };
  }

  const O = {
    tma: 'Reduzir tempo médio de atendimento',
    fcr: 'Aumentar resolução no primeiro contato',
    conc: 'Reduzir tempo de conciliação bancária',
    fat: 'Eliminar erros de faturamento',
    onb: 'Onboarding 100% digital',
  };
  const done: [number, StatusKey][] = [];
  const tasks: SeedTask[] = [
    // Concluídas (base para Cycle Time, Lead Time e Throughput)
    { title: 'Painel de chamados em tempo real', sector: 'Operações', requester: 'Maria', assignee: 'Pedro', outcome: O.tma, priority: 'alta', hours: 24, createdAgo: 85, path: [[2, 'priorizado'], [5, 'dev'], [12, 'validacao'], [14, 'concluido']], dueIn: -68 },
    { title: 'Classificação automática de chamados', sector: 'Operações', requester: 'Maria', assignee: 'Maria', outcome: O.tma, priority: 'alta', hours: 40, createdAgo: 78, path: [[1, 'priorizado'], [3, 'dev'], [20, 'validacao'], [24, 'concluido']], dueIn: -60 },
    { title: 'Importação automática de extratos OFX', sector: 'Financeiro', requester: 'João', assignee: 'Ana', outcome: O.conc, priority: 'urgente', hours: 32, createdAgo: 70, path: [[1, 'dev'], [9, 'validacao'], [11, 'concluido']], dueIn: -55 },
    { title: 'Regras de conciliação por valor e data', sector: 'Financeiro', requester: 'João', assignee: 'Pedro', outcome: O.conc, priority: 'alta', hours: 30, createdAgo: 62, path: [[4, 'priorizado'], [8, 'dev'], [18, 'validacao'], [21, 'concluido']], dueIn: -45 },
    { title: 'Base de conhecimento para atendentes', sector: 'Operações', requester: 'Pedro', assignee: 'Ana', outcome: O.fcr, priority: 'media', hours: 16, createdAgo: 55, path: [[3, 'dev'], [10, 'validacao'], [12, 'concluido']], dueIn: -46 },
    { title: 'Relatório de comissões do time comercial', sector: 'Comercial', requester: 'João', assignee: 'Maria', priority: 'media', hours: 12, createdAgo: 48, path: [[2, 'priorizado'], [6, 'dev'], [13, 'validacao'], [16, 'concluido']], dueIn: -36 },
    { title: 'Roteiro de atendimento guiado', sector: 'Operações', requester: 'Maria', assignee: 'Pedro', outcome: O.fcr, priority: 'alta', hours: 20, createdAgo: 40, path: [[1, 'priorizado'], [2, 'dev'], [15, 'validacao'], [20, 'concluido']], dueIn: -25, notes: 'Entregue com 2 dias de atraso por ajuste de escopo.' },
    { title: 'Dashboard de conciliação pendente', sector: 'Financeiro', requester: 'João', assignee: 'Ana', outcome: O.conc, priority: 'media', hours: 10, createdAgo: 30, path: [[2, 'dev'], [7, 'validacao'], [9, 'concluido']], dueIn: -18 },
    { title: 'Formulário digital de admissão', sector: 'Pessoas', requester: 'Ana', assignee: 'Maria', outcome: O.onb, priority: 'media', hours: 18, createdAgo: 25, path: [[3, 'priorizado'], [5, 'dev'], [14, 'validacao'], [17, 'concluido']], dueIn: -10 },
    { title: 'Ajuste de layout do boleto', sector: 'Financeiro', requester: 'João', assignee: 'Pedro', outcome: O.fat, priority: 'baixa', hours: 4, createdAgo: 12, path: [[1, 'dev'], [3, 'validacao'], [4, 'concluido']], dueIn: -6 },
    { title: 'Exportação de indicadores para a Diretoria', sector: 'Diretoria', requester: 'João', assignee: 'Maria', epic: 'Eficiência no Atendimento', priority: 'alta', hours: 8, createdAgo: 9, path: [[1, 'dev'], [5, 'validacao'], [6, 'concluido']], dueIn: 2 },
    // Em andamento
    { title: 'Integração do chat com a base de clientes', sector: 'Operações', requester: 'Maria', assignee: 'Pedro', outcome: O.tma, priority: 'urgente', hours: 40, createdAgo: 35, path: [[2, 'priorizado'], [6, 'dev']], dueIn: -5, notes: 'Dependência da API do CRM atrasou o início.' },
    { title: 'Validação de CNPJ e impostos na emissão', sector: 'Financeiro', requester: 'João', assignee: 'Ana', outcome: O.fat, priority: 'alta', hours: 24, createdAgo: 20, path: [[2, 'priorizado'], [5, 'dev']], dueIn: 7 },
    { title: 'Pesquisa de satisfação pós-atendimento', sector: 'Operações', requester: 'Pedro', assignee: 'Maria', outcome: O.fcr, priority: 'media', hours: 12, createdAgo: 18, path: [[1, 'dev'], [10, 'validacao']], dueIn: -2 },
    { title: 'Assinatura eletrônica de contratos de trabalho', sector: 'Pessoas', requester: 'Ana', assignee: 'Pedro', outcome: O.onb, priority: 'alta', hours: 28, createdAgo: 14, path: [[2, 'priorizado'], [4, 'dev']], dueIn: 12 },
    { title: 'Alertas de divergência na conciliação', sector: 'Financeiro', requester: 'João', assignee: 'Maria', outcome: O.conc, priority: 'media', hours: 16, createdAgo: 10, path: [[1, 'dev'], [6, 'validacao']], dueIn: 3 },
    // A fazer
    { title: 'Pipeline de propostas comerciais', sector: 'Comercial', requester: 'João', assignee: 'Ana', priority: 'media', hours: 30, createdAgo: 28, path: [[5, 'priorizado']], dueIn: -3, startIn: -10 },
    { title: 'Checklist de documentos do novo colaborador', sector: 'Pessoas', requester: 'Ana', assignee: 'Ana', outcome: O.onb, priority: 'baixa', hours: 6, createdAgo: 8, path: [[2, 'priorizado']], dueIn: 15, startIn: 3 },
    { title: 'Conferência automática de notas canceladas', sector: 'Financeiro', requester: 'João', assignee: 'Pedro', outcome: O.fat, priority: 'media', hours: 14, createdAgo: 6, path: done, dueIn: 25 },
    { title: 'Mapa de calor de demandas por horário', sector: 'Operações', requester: 'Maria', assignee: 'Maria', outcome: O.tma, priority: 'baixa', hours: 10, createdAgo: 4, path: done, dueIn: 30 },
    { title: 'Revisão do cadastro de produtos no ERP', sector: 'Comercial', requester: 'Pedro', assignee: 'João', priority: 'media', createdAgo: 45, path: done, dueIn: -12 },
    { title: 'Relatório mensal de headcount', sector: 'Diretoria', requester: 'João', assignee: 'Ana', priority: 'urgente', hours: 6, createdAgo: 2, path: [[1, 'priorizado']], dueIn: 5 },
  ];

  const insertTask = db.prepare(
    `INSERT INTO tasks (title, description, notes, sector_id, requester_id, assignee_id, epic_id, outcome_id, status_id,
                        priority, estimated_hours, planned_start_date, planned_end_date, started_at, completed_at,
                        created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertHistory = db.prepare(
    'INSERT INTO task_status_history (task_id, from_status_id, to_status_id, changed_by, changed_at) VALUES (?, ?, ?, ?, ?)',
  );

  for (const t of tasks) {
    const createdDay = addDays(today, -t.createdAgo);
    const createdAt = clamp(at(createdDay, 9));
    let statusId = statuses.backlog;
    let startedAt: string | null = null;
    let completedAt: string | null = null;
    const hist: [number | null, number, string, number][] = [[null, statusId, createdAt, users[t.requester]]];
    for (const [offset, key] of t.path) {
      const when = clamp(at(addDays(createdDay, offset), 11 + (offset % 6)));
      const to = statuses[key];
      if (key === 'dev' && !startedAt) startedAt = when;
      if (key === 'concluido' && !completedAt) completedAt = when;
      hist.push([statusId, to, when, users[t.assignee]]);
      statusId = to;
    }
    const outcome = t.outcome ? outcomes[t.outcome] : undefined;
    const epicId = outcome?.epic ?? (t.epic ? epics[t.epic] : null);
    const plannedEnd = addDays(today, t.dueIn);
    const plannedStart = t.startIn !== undefined ? addDays(today, t.startIn) : addDays(createdDay, t.path[0]?.[0] ?? 3);
    const info = insertTask.run(
      t.title,
      t.description ?? `Demanda do setor ${t.sector}: ${t.title.toLowerCase()}.`,
      t.notes ?? null,
      sectors[t.sector],
      users[t.requester],
      users[t.assignee],
      epicId,
      outcome?.id ?? null,
      statusId,
      t.priority,
      t.hours ?? null,
      plannedStart,
      plannedEnd,
      startedAt,
      completedAt,
      users[t.requester],
      createdAt,
      hist[hist.length - 1][2],
    );
    for (const h of hist) insertHistory.run(info.lastInsertRowid, h[0], h[1], h[3], h[2]);
  }
  // Estimativas ICE (impacto, confiança, facilidade) de demonstração. Algumas tarefas ficam sem
  // estimativa para mostrar o caso "não estimado".
  const setTaskIce = db.prepare('UPDATE tasks SET ice_impact = ?, ice_confidence = ?, ice_ease = ? WHERE id = ?');
  const taskIds = (db.prepare('SELECT id FROM tasks ORDER BY id').all() as { id: number }[]).map((r) => r.id);
  taskIds.forEach((id, i) => {
    if (i % 7 === 6) return;
    setTaskIce.run(((i * 7) % 10) + 1, ((i * 3 + 4) % 10) + 1, ((i * 5 + 2) % 10) + 1, id);
  });
  const setOutcomeIce = db.prepare('UPDATE outcomes SET ice_impact = ?, ice_confidence = ?, ice_ease = ? WHERE id = ?');
  [
    [O.tma, 9, 7, 6],
    [O.fcr, 7, 6, 8],
    [O.conc, 8, 9, 7],
    [O.fat, 6, 5, 4],
    [O.onb, 5, 8, 9],
  ].forEach(([name, i, c, e]) => setOutcomeIce.run(i, c, e, outcomes[name as string].id));

  return { tasks: tasks.length };
}

// Execução via CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(config.dbPath + suffix, { force: true });
  const db = openDatabase();
  migrate(db);
  const result = db.transaction(() => seedDemo(db))();
  console.log(`Seed concluído: ${result.tasks} tarefas em ${config.dbPath}`);
  console.log('Login: admin@empresa.com / admin123  (demais usuários: joao|maria|pedro|ana@empresa.com / 123456)');
}
