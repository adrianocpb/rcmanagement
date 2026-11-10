import { beforeEach, describe, expect, it } from 'vitest';
import { computeFlagTime } from '../src/modules/dashboard/metrics.js';
import { setup } from './helpers.js';

let ctx: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  ctx = await setup();
});

const newTask = async (extra: Record<string, unknown> = {}) =>
  (await ctx.agent.post('/api/tasks').send({ title: 'T', sector_id: 1, requester_id: 1, assignee_id: 1, ...extra }).expect(201)).body;

describe('flag (marcador de bloqueio)', () => {
  it('equipe coloca e retira a flag da tarefa; fica no histórico e filtra a lista', async () => {
    const t = await newTask();
    const on = (await ctx.userAgent.put(`/api/tasks/${t.id}/flag`).send({ flagged: true, note: 'Aguardando acesso ao ERP' }).expect(200)).body;
    expect(on.flagged_at).toBeTruthy();
    expect(on.flag_reason).toBe('Aguardando acesso ao ERP');
    expect(on.flagged_by_name).toBe('Maria');
    await ctx.agent.put(`/api/tasks/${t.id}/flag`).send({ flagged: true }).expect(400); // já tem

    const flagged = (await ctx.agent.get('/api/tasks?flagged=true').expect(200)).body as { id: number; flagged_at: string }[];
    expect(flagged.map((x) => x.id)).toContain(t.id);
    expect(flagged.every((x) => x.flagged_at)).toBe(true);

    const off = (await ctx.agent.put(`/api/tasks/${t.id}/flag`).send({ flagged: false, note: 'Acesso liberado' }).expect(200)).body;
    expect(off.flagged_at).toBeNull();
    expect(off.flag_events.map((e: { action: string; note: string }) => [e.action, e.note])).toEqual([
      ['add', 'Aguardando acesso ao ERP'],
      ['remove', 'Acesso liberado'],
    ]);
    await ctx.agent.put(`/api/tasks/${t.id}/flag`).send({ flagged: false }).expect(400); // não tem
  });

  it('outcomes também têm flag', async () => {
    const o = (await ctx.agent.get('/api/outcomes').expect(200)).body[0];
    const on = (await ctx.agent.put(`/api/outcomes/${o.id}/flag`).send({ flagged: true, note: 'Depende do jurídico' }).expect(200)).body;
    expect(on.flag_reason).toBe('Depende do jurídico');
    const detail = (await ctx.agent.get(`/api/outcomes/${o.id}`).expect(200)).body;
    expect(detail.flag_events).toHaveLength(1);
  });

  it('dashboard: tempo médio com flag', async () => {
    const t = await newTask();
    const ins = ctx.db.prepare("INSERT INTO flag_events (entity_type, entity_id, action, user_id, created_at) VALUES ('task', ?, ?, 1, ?)");
    const h = (n: number) => new Date(Date.now() - n * 3_600_000).toISOString();
    ins.run(t.id, 'add', h(30));
    ins.run(t.id, 'remove', h(20)); // 10 h
    ins.run(t.id, 'add', h(6)); // ainda ativa: 6 h até agora
    // Filtra pelo responsável da tarefa do teste (o seed tem outras flags).
    const d = (await ctx.agent.get('/api/dashboard?assignee_id=1').expect(200)).body;
    expect(d.flag_time.periods).toBe(2);
    expect(d.flag_time.tasks).toBe(1);
    expect(d.flag_time.active).toBe(1);
    expect(d.flag_time.avg_hours).toBeCloseTo(8, 0);
  });

  it('computeFlagTime: só períodos que tocam o intervalo', () => {
    const ev = [
      { task_id: 1, action: 'add' as const, created_at: '2026-01-01T10:00:00.000Z' },
      { task_id: 1, action: 'remove' as const, created_at: '2026-01-01T14:00:00.000Z' }, // 4 h, fora
      { task_id: 2, action: 'add' as const, created_at: '2026-02-01T10:00:00.000Z' },
      { task_id: 2, action: 'remove' as const, created_at: '2026-02-02T10:00:00.000Z' }, // 24 h, dentro
    ];
    const r = computeFlagTime(ev, '2026-02-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z', new Date('2026-03-10T00:00:00Z'));
    expect(r).toMatchObject({ periods: 1, tasks: 1, avg_hours: 24, active: 0 });
  });
});

describe('lixeira de outcomes e épicos', () => {
  it('somente admin exclui; o outcome some das listas e da tarefa, e volta ao restaurar', async () => {
    const e = (await ctx.agent.post('/api/epics').send({ name: 'Épico L' }).expect(201)).body;
    const o = (await ctx.agent.post('/api/outcomes').send({ name: 'Outcome L', epic_id: e.id }).expect(201)).body;
    const t = await newTask({ outcome_id: o.id });

    await ctx.userAgent.delete(`/api/outcomes/${o.id}`).expect(403);
    await ctx.agent.delete(`/api/outcomes/${o.id}`).expect(204);
    await ctx.agent.get(`/api/outcomes/${o.id}`).expect(404);
    expect(((await ctx.agent.get('/api/outcomes').expect(200)).body as { id: number }[]).some((x) => x.id === o.id)).toBe(false);
    expect((await ctx.agent.get(`/api/tasks/${t.id}`).expect(200)).body.outcome_name).toBeNull();

    const trash = (await ctx.agent.get('/api/trash').expect(200)).body.items as { type: string; id: number }[];
    expect(trash.some((i) => i.type === 'outcome' && i.id === o.id)).toBe(true);

    await ctx.userAgent.post(`/api/trash/outcome/${o.id}/restore`).expect(204);
    expect((await ctx.agent.get(`/api/tasks/${t.id}`).expect(200)).body.outcome_name).toBe('Outcome L');
  });

  it('épico vai com seus outcomes; outcome só volta com o épico; exclusão definitiva desfaz vínculos', async () => {
    const e = (await ctx.agent.post('/api/epics').send({ name: 'Épico X' }).expect(201)).body;
    const o = (await ctx.agent.post('/api/outcomes').send({ name: 'Outcome X', epic_id: e.id }).expect(201)).body;
    const t = await newTask({ outcome_id: o.id });

    await ctx.agent.delete(`/api/epics/${e.id}`).expect(204);
    await ctx.agent.get(`/api/outcomes/${o.id}`).expect(404);
    const items = (await ctx.agent.get('/api/trash').expect(200)).body.items as { type: string; id: number; with_epic?: boolean }[];
    expect(items.find((i) => i.type === 'outcome' && i.id === o.id)?.with_epic).toBe(true);

    await ctx.agent.post(`/api/trash/outcome/${o.id}/restore`).expect(400);
    await ctx.agent.post(`/api/trash/epic/${e.id}/restore`).expect(204);
    await ctx.agent.get(`/api/outcomes/${o.id}`).expect(200);

    await ctx.agent.delete(`/api/epics/${e.id}`).expect(204);
    await ctx.userAgent.delete(`/api/trash/epic/${e.id}`).expect(403);
    await ctx.agent.delete(`/api/trash/epic/${e.id}`).expect(204);
    const task = (await ctx.agent.get(`/api/tasks/${t.id}`).expect(200)).body;
    expect(task.epic_id).toBeNull();
    expect(task.outcome_id).toBeNull();
    expect(((await ctx.agent.get('/api/trash').expect(200)).body.items as unknown[]).length).toBe(0);
  });

  it('esvaziar a lixeira remove tarefas, outcomes e épicos', async () => {
    const e = (await ctx.agent.post('/api/epics').send({ name: 'Épico Z' }).expect(201)).body;
    await ctx.agent.post('/api/outcomes').send({ name: 'Outcome Z', epic_id: e.id }).expect(201);
    const t = await newTask();
    await ctx.agent.delete(`/api/epics/${e.id}`).expect(204);
    await ctx.agent.delete(`/api/tasks/${t.id}`).expect(204);
    const r = (await ctx.agent.delete('/api/trash').expect(200)).body;
    expect(r.removed).toBe(3);
    expect((await ctx.agent.get('/api/trash').expect(200)).body.items).toHaveLength(0);
  });
});
