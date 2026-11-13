import { beforeEach, describe, expect, it } from 'vitest';
import { setup } from './helpers.js';

let ctx: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  ctx = await setup();
});

describe('horizontes (H1, H2, H3)', () => {
  it('épicos e outcomes guardam o horizonte; edição sem o campo mantém; vazio limpa', async () => {
    const e = (await ctx.agent.post('/api/epics').send({ name: 'Épico H', horizon: 'H2' }).expect(201)).body;
    expect(e.horizon).toBe('H2');
    await ctx.agent.post('/api/epics').send({ name: 'X', horizon: 'H4' }).expect(400);

    const kept = (await ctx.agent.put(`/api/epics/${e.id}`).send({ name: 'Épico H2' }).expect(200)).body;
    expect(kept.horizon).toBe('H2');
    const cleared = (await ctx.agent.put(`/api/epics/${e.id}`).send({ name: 'Épico H2', horizon: '' }).expect(200)).body;
    expect(cleared.horizon).toBeNull();

    const o = (await ctx.agent.post('/api/outcomes').send({ name: 'Outcome H', epic_id: e.id, horizon: 'H3' }).expect(201)).body;
    expect(o.horizon).toBe('H3');
    const moved = (await ctx.agent.put(`/api/outcomes/${o.id}`).send({ name: 'Outcome H', epic_id: e.id, horizon: 'H1' }).expect(200)).body;
    expect(moved.horizon).toBe('H1');
  });

  it('tarefas herdam o horizonte do outcome (ou do épico) nos filtros', async () => {
    const e = (await ctx.agent.post('/api/epics').send({ name: 'Épico T', horizon: 'H2' }).expect(201)).body;
    const o = (await ctx.agent.post('/api/outcomes').send({ name: 'O T', epic_id: e.id, horizon: 'H3' }).expect(201)).body;
    const base = { sector_id: 1, requester_id: 1, assignee_id: 1 };
    const viaOutcome = (await ctx.agent.post('/api/tasks').send({ ...base, title: 'via outcome', outcome_id: o.id }).expect(201)).body;
    const viaEpic = (await ctx.agent.post('/api/tasks').send({ ...base, title: 'via épico', epic_id: e.id }).expect(201)).body;
    const ids = async (h: string) => ((await ctx.agent.get(`/api/tasks?horizon=${h}`).expect(200)).body as { id: number }[]).map((t) => t.id);
    expect(await ids('H3')).toEqual([viaOutcome.id]);
    const h2 = await ids('H2'); // o seed também tem tarefas em H2
    expect(h2).toContain(viaEpic.id);
    expect(h2).not.toContain(viaOutcome.id);
    const d = (await ctx.agent.get('/api/dashboard?horizon=H3').expect(200)).body;
    expect(d.status_distribution.reduce((s: number, x: { count: number }) => s + x.count, 0)).toBe(1);
  });

  it('dashboard de outcomes filtra por horizonte', async () => {
    const e = (await ctx.agent.post('/api/epics').send({ name: 'Épico D' }).expect(201)).body;
    await ctx.agent.post('/api/outcomes').send({ name: 'A', epic_id: e.id, horizon: 'H1' }).expect(201);
    await ctx.agent.post('/api/outcomes').send({ name: 'B', epic_id: e.id, horizon: 'H3' }).expect(201);
    const d = (await ctx.agent.get(`/api/dashboard/outcomes?epic_id=${e.id}&horizon=H3`).expect(200)).body;
    expect(d.total).toBe(1);
  });
});
