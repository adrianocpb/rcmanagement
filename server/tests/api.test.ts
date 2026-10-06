import { beforeEach, describe, expect, it } from 'vitest';
import { setup } from './helpers.js';

let ctx: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  ctx = await setup();
});

const baseTask = { title: 'Nova tarefa de teste', sector_id: 1, requester_id: 2, assignee_id: 3, planned_end_date: '2030-01-10' };

describe('autenticação e permissões', () => {
  it('bloqueia acesso sem login', async () => {
    const { app } = ctx;
    const { default: request } = await import('supertest');
    await request(app).get('/api/tasks').expect(401);
  });
  it('login inválido', async () => {
    const { default: request } = await import('supertest');
    await request(ctx.app).post('/api/auth/login').send({ email: 'admin@empresa.com', password: 'x' }).expect(401);
  });
  it('usuário comum não acessa administração', async () => {
    await ctx.userAgent.get('/api/users').expect(403);
    await ctx.userAgent.post('/api/sectors').send({ name: 'X' }).expect(403);
    await ctx.userAgent.post('/api/statuses').send({ name: 'X' }).expect(403);
  });
  it('usuário comum cria e edita tarefas', async () => {
    const res = await ctx.userAgent.post('/api/tasks').send(baseTask).expect(201);
    await ctx.userAgent.put(`/api/tasks/${res.body.id}`).send({ title: 'Editada' }).expect(200);
  });
});

describe('tarefas', () => {
  it('cria com status padrão, data de criação automática e histórico', async () => {
    const res = await ctx.agent.post('/api/tasks').send(baseTask).expect(201);
    expect(res.body.status_name).toBe('Backlog');
    expect(res.body.created_at).toMatch(/Z$/);
    expect(res.body.started_at).toBeNull();
    expect(res.body.history).toHaveLength(1);
    expect(res.body.history[0].from_status_id).toBeNull();
  });

  it('valida campos obrigatórios', async () => {
    const res = await ctx.agent.post('/api/tasks').send({ title: 'x' }).expect(400);
    expect(res.body.error).toContain('sector_id');
    // Prazo é opcional: sem prazo, a tarefa nunca fica atrasada
    const semPrazo = await ctx.agent.post('/api/tasks').send({ ...baseTask, planned_end_date: '' }).expect(201);
    expect(semPrazo.body.planned_end_date).toBeNull();
    expect(semPrazo.body.deadline_state).toBe('sem_prazo');
    await ctx.agent.post('/api/tasks').send({ ...baseTask, planned_end_date: '31/12/2026' }).expect(400);
  });

  it('não permite alterar a data de criação', async () => {
    const res = await ctx.agent.post('/api/tasks').send(baseTask).expect(201);
    const upd = await ctx.agent
      .put(`/api/tasks/${res.body.id}`)
      .send({ created_at: '2020-01-01T00:00:00Z' })
      .expect(200);
    expect(upd.body.created_at).toBe(res.body.created_at);
  });

  it('aplica regras de início/conclusão e registra histórico ao mover', async () => {
    const { agent, byName } = ctx;
    const { body: t } = await agent.post('/api/tasks').send(baseTask).expect(201);
    const dev = await agent.patch(`/api/tasks/${t.id}/status`).send({ status_id: byName('Em desenvolvimento') }).expect(200);
    const startedAt = dev.body.started_at;
    expect(startedAt).toBeTruthy();

    await agent.patch(`/api/tasks/${t.id}/status`).send({ status_id: byName('Backlog') }).expect(200);
    const again = await agent.patch(`/api/tasks/${t.id}/status`).send({ status_id: byName('Em desenvolvimento') });
    expect(again.body.started_at).toBe(startedAt);

    const done = await agent.patch(`/api/tasks/${t.id}/status`).send({ status_id: byName('Concluído') }).expect(200);
    expect(done.body.completed_at).toBeTruthy();
    expect(done.body.is_completed).toBe(true);
    expect(done.body.deadline_state).toBe('concluida_no_prazo');
    expect(done.body.history.map((h: { to_status_name: string }) => h.to_status_name)).toEqual([
      'Backlog',
      'Em desenvolvimento',
      'Backlog',
      'Em desenvolvimento',
      'Concluído',
    ]);

    // Reabrir e concluir novamente não sobrescreve a data de conclusão
    await agent.patch(`/api/tasks/${t.id}/status`).send({ status_id: byName('Em validação') });
    const done2 = await agent.patch(`/api/tasks/${t.id}/status`).send({ status_id: byName('Concluído') });
    expect(done2.body.completed_at).toBe(done.body.completed_at);
  });

  it('regras dependem das flags e não do nome do status', async () => {
    const { agent, byName } = ctx;
    const devId = byName('Em desenvolvimento');
    await agent.put(`/api/statuses/${devId}`).send({ name: 'Desenvolvendo' }).expect(200);
    const { body: t } = await agent.post('/api/tasks').send(baseTask);
    const res = await agent.patch(`/api/tasks/${t.id}/status`).send({ status_id: devId });
    expect(res.body.status_name).toBe('Desenvolvendo');
    expect(res.body.started_at).toBeTruthy();
  });

  it('identifica atraso', async () => {
    const { body } = await ctx.agent.post('/api/tasks').send({ ...baseTask, planned_end_date: '2020-01-01' });
    expect(body.is_overdue).toBe(true);
    const list = await ctx.agent.get('/api/tasks?overdue=true');
    expect(list.body.every((t: { is_overdue: boolean }) => t.is_overdue)).toBe(true);
    expect(list.body.some((t: { id: number }) => t.id === body.id)).toBe(true);
  });

  it('herda o épico do outcome', async () => {
    const outcome = (await ctx.agent.get('/api/outcomes')).body[0];
    const { body } = await ctx.agent.post('/api/tasks').send({ ...baseTask, outcome_id: outcome.id, epic_id: null });
    expect(body.epic_id).toBe(outcome.epic_id);
  });

  it('combina filtros', async () => {
    const all = (await ctx.agent.get('/api/tasks')).body;
    const res = await ctx.agent.get('/api/tasks?sector_id=2&priority=alta');
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.length).toBeLessThan(all.length);
    expect(res.body.every((t: { sector_id: number; priority: string }) => t.sector_id === 2 && t.priority === 'alta')).toBe(true);
  });

  it('exclusão lógica', async () => {
    const { body } = await ctx.agent.post('/api/tasks').send(baseTask);
    await ctx.agent.delete(`/api/tasks/${body.id}`).expect(204);
    await ctx.agent.get(`/api/tasks/${body.id}`).expect(404);
  });
});

describe('administração', () => {
  it('cria, ordena e desativa status', async () => {
    const { agent } = ctx;
    const created = await agent.post('/api/statuses').send({ name: 'Homologação', color: '#123456' }).expect(201);
    const list = (await agent.get('/api/statuses')).body as { id: number }[];
    const ids = list.map((s) => s.id).reverse();
    const reordered = await agent.put('/api/statuses/reorder').send({ ids }).expect(200);
    expect(reordered.body[0].id).toBe(ids[0]);
    await agent.put(`/api/statuses/${created.body.id}`).send({ active: false }).expect(200);
  });
  it('não desativa status com tarefas', async () => {
    await ctx.agent.put(`/api/statuses/${ctx.byName('Em desenvolvimento')}`).send({ active: false }).expect(400);
  });
  it('apenas um status padrão', async () => {
    await ctx.agent.put(`/api/statuses/${ctx.byName('Priorizado')}`).send({ is_default: true }).expect(200);
    const list = (await ctx.agent.get('/api/statuses')).body as { is_default: number }[];
    expect(list.filter((s) => s.is_default).length).toBe(1);
  });
  it('cria e desativa usuário e setor', async () => {
    const u = await ctx.agent
      .post('/api/users')
      .send({ name: 'Carla', email: 'carla@empresa.com', password: 'abcdef', role: 'user' })
      .expect(201);
    expect(u.body.password_hash).toBeUndefined();
    await ctx.agent.put(`/api/users/${u.body.id}`).send({ active: false }).expect(200);
    const { default: request } = await import('supertest');
    await request(ctx.app).post('/api/auth/login').send({ email: 'carla@empresa.com', password: 'abcdef' }).expect(401);
    const s = await ctx.agent.post('/api/sectors').send({ name: 'Marketing' }).expect(201);
    await ctx.agent.put(`/api/sectors/${s.body.id}`).send({ active: false }).expect(200);
    await ctx.agent.post('/api/sectors').send({ name: 'marketing' }).expect(409);
  });
});

describe('épicos, outcomes e dashboard', () => {
  it('cria épico e outcome com indicador', async () => {
    const e = await ctx.agent.post('/api/epics').send({ name: 'Épico X', okr: 'OKR 1' }).expect(201);
    const o = await ctx.agent
      .post('/api/outcomes')
      .send({ name: 'Outcome X', epic_id: e.body.id, indicator_name: 'NPS', baseline_value: 10, target_value: 50, current_value: 20 })
      .expect(201);
    expect(o.body.epic_name).toBe('Épico X');
    const epic = await ctx.agent.get(`/api/epics/${e.body.id}`);
    expect(epic.body.outcomes_count).toBe(1);
  });

  it('dashboard com dados reais do banco', async () => {
    const res = await ctx.agent.get('/api/dashboard').expect(200);
    expect(res.body.throughput.count).toBeGreaterThan(0);
    expect(res.body.cycle_time.avg).toBeGreaterThan(0);
    expect(res.body.lead_time.avg).toBeGreaterThan(0);
    expect(res.body.wip.count).toBeGreaterThan(0);
    expect(res.body.overdue.count).toBeGreaterThan(0);
    const filtered = await ctx.agent.get('/api/dashboard?sector_id=3').expect(200);
    expect(filtered.body.wip.count).toBeLessThan(res.body.wip.count);
  });
});

describe('priorização ICE', () => {
  it('calcula o ICE score da tarefa automaticamente (impacto × confiança × facilidade)', async () => {
    const { body } = await ctx.agent
      .post('/api/tasks')
      .send({ ...baseTask, ice_impact: 8, ice_confidence: 5, ice_ease: 3 })
      .expect(201);
    expect(body.ice_score).toBe(120);
    const upd = await ctx.agent.put(`/api/tasks/${body.id}`).send({ ice_ease: 10 }).expect(200);
    expect(upd.body.ice_score).toBe(400);
    // Mover a tarefa não apaga a estimativa
    const moved = await ctx.agent.patch(`/api/tasks/${body.id}/status`).send({ status_id: ctx.byName('Priorizado') });
    expect(moved.body.ice_score).toBe(400);
  });

  it('ICE score fica vazio enquanto faltar algum fator', async () => {
    const { body } = await ctx.agent.post('/api/tasks').send({ ...baseTask, ice_impact: 8 }).expect(201);
    expect(body.ice_score).toBeNull();
    const cleared = await ctx.agent.put(`/api/tasks/${body.id}`).send({ ice_impact: '' }).expect(200);
    expect(cleared.body.ice_impact).toBeNull();
  });

  it('aceita apenas inteiros de 1 a 10', async () => {
    for (const v of [0, 11, 2.5, 'abc']) {
      await ctx.agent.post('/api/tasks').send({ ...baseTask, ice_impact: v }).expect(400);
    }
  });

  it('ignora ice_score enviado pelo cliente', async () => {
    const { body } = await ctx.agent
      .post('/api/tasks')
      .send({ ...baseTask, ice_impact: 2, ice_confidence: 2, ice_ease: 2, ice_score: 999 })
      .expect(201);
    expect(body.ice_score).toBe(8);
  });

  it('calcula o ICE score do outcome', async () => {
    const epic = (await ctx.agent.get('/api/epics')).body[0];
    const o = await ctx.agent
      .post('/api/outcomes')
      .send({ name: 'Outcome ICE', epic_id: epic.id, ice_impact: 10, ice_confidence: 9, ice_ease: 8 })
      .expect(201);
    expect(o.body.ice_score).toBe(720);
    await ctx.agent
      .post('/api/outcomes')
      .send({ name: 'Outcome inválido', epic_id: epic.id, ice_impact: 11 })
      .expect(400);
  });
});

describe('WIP e tempo em cada coluna (API)', () => {
  it('Backlog fora do WIP por padrão; marcação editável pelo admin', async () => {
    const statuses = (await ctx.agent.get('/api/statuses')).body as { name: string; counts_in_wip: number }[];
    expect(statuses.find((s) => s.name === 'Backlog')!.counts_in_wip).toBe(0);
    expect(statuses.find((s) => s.name === 'Priorizado')!.counts_in_wip).toBe(1);

    const before = (await ctx.agent.get('/api/dashboard')).body;
    expect(before.wip_statuses).toEqual(['Priorizado', 'Em desenvolvimento', 'Em validação']);
    const backlogOpen = ctx.db
      .prepare(`SELECT COUNT(*) AS n FROM tasks WHERE status_id = ? AND deleted_at IS NULL`)
      .get(ctx.byName('Backlog')) as { n: number };
    await ctx.agent.put(`/api/statuses/${ctx.byName('Backlog')}`).send({ counts_in_wip: true }).expect(200);
    const after = (await ctx.agent.get('/api/dashboard')).body;
    expect(after.wip.count).toBe(before.wip.count + backlogOpen.n);
  });

  it('dashboard traz o tempo médio por coluna', async () => {
    const d = (await ctx.agent.get('/api/dashboard')).body;
    expect(d.time_in_status.length).toBeGreaterThan(0);
    expect(d.time_in_status.every((s: { avg_days: number }) => s.avg_days > 0)).toBe(true);
    expect(d.time_in_status.some((s: { name: string }) => s.name === 'Concluído')).toBe(false);
  });
});

describe('agrupamento automático das séries do dashboard', () => {
  it('semanal até 120 dias e mensal acima disso', async () => {
    const short = (await ctx.agent.get('/api/dashboard?from=2026-07-01&to=2026-09-30').expect(200)).body;
    expect(short.period.granularity).toBe('week');
    const long = (await ctx.agent.get('/api/dashboard?from=2026-04-01&to=2026-09-30').expect(200)).body;
    expect(long.period.granularity).toBe('month');
    expect(long.series.map((s: { bucket: string }) => s.bucket)).toEqual([
      '2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01',
    ]);
  });
});

describe('data de criação de épicos e outcomes', () => {
  it('é preenchida automaticamente e não muda ao editar', async () => {
    const e = await ctx.agent.post('/api/epics').send({ name: 'Épico data', created_at: '2020-01-01T00:00:00Z' }).expect(201);
    expect(e.body.created_at).toMatch(/Z$/);
    expect(e.body.created_at.startsWith('2020')).toBe(false);
    const e2 = await ctx.agent.put(`/api/epics/${e.body.id}`).send({ name: 'Épico data 2', created_at: '2020-01-01T00:00:00Z' }).expect(200);
    expect(e2.body.created_at).toBe(e.body.created_at);

    const o = await ctx.agent.post('/api/outcomes').send({ name: 'Outcome data', epic_id: e.body.id }).expect(201);
    expect(o.body.created_at).toMatch(/Z$/);
    const o2 = await ctx.agent
      .put(`/api/outcomes/${o.body.id}`)
      .send({ name: 'Outcome data 2', epic_id: e.body.id, created_at: '2020-01-01T00:00:00Z' })
      .expect(200);
    expect(o2.body.created_at).toBe(o.body.created_at);
  });
});

describe('status "encerra sem entrega"', () => {
  async function cancelStatus() {
    const r = await ctx.agent.post('/api/statuses').send({ name: 'Cancelado', is_cancel_status: true, counts_in_wip: false }).expect(201);
    return r.body.id as number;
  }

  it('não permite marcar conclusão e encerra sem entrega juntos', async () => {
    await ctx.agent.post('/api/statuses').send({ name: 'X', is_cancel_status: true, is_completion_status: true }).expect(400);
    const id = await cancelStatus();
    await ctx.agent.put(`/api/statuses/${id}`).send({ is_completion_status: true }).expect(400);
  });

  it('tarefa cancelada sai de atrasadas e do dashboard, e do progresso do épico', async () => {
    const cancelId = await cancelStatus();
    const epic = (await ctx.agent.post('/api/epics').send({ name: 'Épico cancel' })).body;
    const t1 = (await ctx.agent.post('/api/tasks').send({ ...baseTask, epic_id: epic.id, planned_end_date: '2020-01-01' })).body;
    await ctx.agent.post('/api/tasks').send({ ...baseTask, epic_id: epic.id, status_id: ctx.byName('Concluído') }).expect(201);
    expect(t1.is_overdue).toBe(true);
    const before = (await ctx.agent.get('/api/dashboard')).body;

    const moved = (await ctx.agent.patch(`/api/tasks/${t1.id}/status`).send({ status_id: cancelId }).expect(200)).body;
    expect(moved.is_overdue).toBe(false);
    expect(moved.is_canceled).toBe(true);
    expect(moved.deadline_state).toBe('cancelada');
    expect(moved.completed_at).toBeNull();

    const overdueList = (await ctx.agent.get('/api/tasks?overdue=true')).body as { id: number }[];
    expect(overdueList.some((t) => t.id === t1.id)).toBe(false);

    const after = (await ctx.agent.get('/api/dashboard')).body;
    expect(after.overdue.count).toBe(before.overdue.count - 1);
    expect(after.throughput.count).toBe(before.throughput.count);

    // 1 concluída de 1 válida (a cancelada não entra no total) → 100%
    const e = (await ctx.agent.get(`/api/epics/${epic.id}`)).body;
    expect([e.tasks_done, e.tasks_count]).toEqual([1, 1]);
  });
});

describe('lixeira', () => {
  async function trashed() {
    const { body } = await ctx.agent.post('/api/tasks').send(baseTask).expect(201);
    await ctx.userAgent.delete(`/api/tasks/${body.id}`).expect(204);
    return body.id as number;
  }

  it('tarefa excluída vai para a lixeira, com quem excluiu e dias restantes', async () => {
    const id = await trashed();
    const list = (await ctx.agent.get('/api/tasks')).body as { id: number }[];
    expect(list.some((t) => t.id === id)).toBe(false);
    const trash = (await ctx.userAgent.get('/api/tasks/trash').expect(200)).body;
    expect(trash.days).toBe(30);
    const item = trash.items.find((t: { id: number }) => t.id === id);
    expect(item.deleted_by_name).toBe('Maria');
    expect(item.days_left).toBe(30);
  });

  it('qualquer usuário pode restaurar', async () => {
    const id = await trashed();
    const restored = (await ctx.userAgent.post(`/api/tasks/${id}/restore`).expect(200)).body;
    expect(restored.id).toBe(id);
    await ctx.agent.get(`/api/tasks/${id}`).expect(200);
    await ctx.userAgent.post(`/api/tasks/${id}/restore`).expect(404); // já não está na lixeira
  });

  it('esvaziar e excluir definitivamente: somente administradores', async () => {
    const id = await trashed();
    await ctx.userAgent.delete('/api/tasks/trash').expect(403);
    await ctx.userAgent.delete(`/api/tasks/trash/${id}`).expect(403);

    await ctx.agent.delete(`/api/tasks/trash/${id}`).expect(204);
    const history = ctx.db.prepare('SELECT COUNT(*) AS n FROM task_status_history WHERE task_id = ?').get(id) as { n: number };
    expect(history.n).toBe(0); // histórico removido junto

    await trashed();
    await trashed();
    const r = (await ctx.agent.delete('/api/tasks/trash').expect(200)).body;
    expect(r.removed).toBe(2);
    expect((await ctx.agent.get('/api/tasks/trash')).body.items).toHaveLength(0);
  });

  it('remove automaticamente o que está há mais de 30 dias', async () => {
    const old = await trashed();
    const recent = await trashed();
    const d31 = new Date(Date.now() - 31 * 86_400_000).toISOString();
    ctx.db.prepare('UPDATE tasks SET deleted_at = ? WHERE id = ?').run(d31, old);
    const items = (await ctx.agent.get('/api/tasks/trash')).body.items as { id: number }[];
    expect(items.map((i) => i.id)).toEqual([recent]);
    expect(ctx.db.prepare('SELECT id FROM tasks WHERE id = ?').get(old)).toBeUndefined();
  });
});

describe('permissões de administração', () => {
  it('usuário comum não cria nem edita setores, status ou usuários', async () => {
    await ctx.userAgent.put('/api/sectors/1').send({ name: 'X' }).expect(403);
    await ctx.userAgent.put(`/api/statuses/${ctx.byName('Backlog')}`).send({ name: 'X' }).expect(403);
    await ctx.userAgent.put('/api/statuses/reorder').send({ ids: [1, 2] }).expect(403);
    await ctx.userAgent.post('/api/users').send({ name: 'X', email: 'x@x.com', password: '123456' }).expect(403);
    await ctx.userAgent.put('/api/users/2').send({ name: 'X' }).expect(403);
  });
});
