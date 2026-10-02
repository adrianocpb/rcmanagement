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
    await ctx.agent.post('/api/tasks').send({ ...baseTask, planned_end_date: '' }).expect(400);
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
