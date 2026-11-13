import { beforeEach, describe, expect, it } from 'vitest';
import { setup } from './helpers.js';

let ctx: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  ctx = await setup();
});

const base = { title: 'Com tags', sector_id: 1, requester_id: 1, assignee_id: 1 };

describe('tags das tarefas', () => {
  it('cria tarefa com tags (reaproveita existentes sem diferenciar maiúsculas) e filtra por tag', async () => {
    const t = (await ctx.userAgent.post('/api/tasks').send({ ...base, tags: ['kynera', ' Integração  ERP ', 'KYNERA'] }).expect(201)).body;
    expect(t.tags.map((g: { name: string }) => g.name)).toEqual(['Integração ERP', 'Kynera']); // "Kynera" já existia no seed
    const tags = (await ctx.agent.get('/api/tags').expect(200)).body as { id: number; name: string; tasks_count: number; color: string }[];
    const kynera = tags.find((g) => g.name === 'Kynera')!;
    expect(kynera.color).toBeTruthy();
    expect(kynera.tasks_count).toBe(4); // 3 do seed + a nova

    const list = (await ctx.agent.get(`/api/tasks?tag_id=${kynera.id}`).expect(200)).body as { id: number }[];
    expect(list).toHaveLength(4);
    expect(list.some((x) => x.id === t.id)).toBe(true);

    // Editar sem enviar tags mantém; enviar lista vazia remove
    const kept = (await ctx.agent.put(`/api/tasks/${t.id}`).send({ title: 'Renomeada' }).expect(200)).body;
    expect(kept.tags).toHaveLength(2);
    const cleared = (await ctx.agent.put(`/api/tasks/${t.id}`).send({ tags: [] }).expect(200)).body;
    expect(cleared.tags).toHaveLength(0);

    await ctx.agent.post('/api/tasks').send({ ...base, tags: Array.from({ length: 11 }, (_, i) => `t${i}`) }).expect(400);
  });

  it('admin renomeia, troca a cor e exclui; equipe não', async () => {
    const t = (await ctx.agent.post('/api/tasks').send({ ...base, tags: ['Fornecedor X'] }).expect(201)).body;
    const tag = t.tags[0];
    await ctx.userAgent.put(`/api/tags/${tag.id}`).send({ name: 'Y' }).expect(403);
    await ctx.agent.put(`/api/tags/${tag.id}`).send({ name: 'kynera' }).expect(400); // já existe
    const r = (await ctx.agent.put(`/api/tags/${tag.id}`).send({ name: 'Fornecedor Z', color: 'rosa' }).expect(200)).body;
    expect(r).toMatchObject({ name: 'Fornecedor Z', color: 'rosa' });
    await ctx.agent.delete(`/api/tags/${tag.id}`).expect(204);
    expect((await ctx.agent.get(`/api/tasks/${t.id}`).expect(200)).body.tags).toHaveLength(0);
  });

  it('dashboard: filtro por tag e tarefas por tag', async () => {
    const tags = (await ctx.agent.get('/api/tags').expect(200)).body as { id: number; name: string }[];
    const kynera = tags.find((g) => g.name === 'Kynera')!;
    const all = (await ctx.agent.get('/api/dashboard').expect(200)).body;
    const k = all.by_tag.find((g: { name: string }) => g.name === 'Kynera');
    expect(k.open + k.completed).toBeGreaterThan(0);
    const filtered = (await ctx.agent.get(`/api/dashboard?tag_id=${kynera.id}`).expect(200)).body;
    expect(filtered.status_distribution.reduce((s: number, x: { count: number }) => s + x.count, 0)).toBe(3);
  });
});
