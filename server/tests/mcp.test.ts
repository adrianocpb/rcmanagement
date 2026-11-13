import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setup } from './helpers.js';

let ctx: Awaited<ReturnType<typeof setup>>;
let http: Server;
let base: string;
let token: string;
let client: Client;

const users = async () => (await ctx.agent.get('/api/users/options').expect(200)).body as { id: number; name: string; role: string }[];

async function connect(t: string) {
  const c = new Client({ name: 'teste', version: '1.0.0' });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${t}` } } }));
  return c;
}

/** Chama uma ferramenta e devolve o JSON da resposta (ou a mensagem de erro). */
async function call(name: string, args: Record<string, unknown> = {}) {
  const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { type: string; text: string }[] };
  const text = r.content[0]?.text ?? '';
  return { isError: !!r.isError, text, data: r.isError ? null : JSON.parse(text) };
}

beforeEach(async () => {
  ctx = await setup();
  http = ctx.app.listen(0);
  base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  const maria = (await users()).find((u) => u.name === 'Maria')!;
  token = (await ctx.agent.post('/api/integrations/tokens').send({ name: 'Claude PM', user_id: maria.id }).expect(201)).body.token;
  client = await connect(token);
});

afterEach(async () => {
  await client?.close();
  http.close();
});

describe('tokens de integração', () => {
  it('somente admin gerencia; não pode agir como solicitante; o token aparece só na criação', async () => {
    const carla = (await users()).find((u) => u.name === 'Carla')!;
    await ctx.userAgent.get('/api/integrations/tokens').expect(403);
    await ctx.agent.post('/api/integrations/tokens').send({ name: 'X', user_id: carla.id }).expect(400);
    const list = (await ctx.agent.get('/api/integrations/tokens').expect(200)).body as Record<string, unknown>[];
    expect(list[0].token).toBeUndefined();
    expect(list[0].token_hint).toBe(token.slice(-4));
  });

  it('sem token, com token inválido ou revogado: 401', async () => {
    expect((await fetch(`${base}/mcp`, { method: 'POST' })).status).toBe(401);
    await expect(connect('rcm_invalido')).rejects.toThrow();
    const id = ((await ctx.agent.get('/api/integrations/tokens').expect(200)).body as { id: number }[])[0].id;
    await ctx.agent.delete(`/api/integrations/tokens/${id}`).expect(204);
    await expect(connect(token)).rejects.toThrow();
  });
});

describe('conector MCP', () => {
  it('lista as ferramentas, marcando as que gravam', async () => {
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(Object.keys(byName).sort()).toEqual(
      [
        'atualizar_epico', 'atualizar_outcome', 'atualizar_tarefa', 'buscar', 'contexto', 'criar_epico', 'criar_outcome',
        'criar_tarefa', 'detalhe', 'flag', 'listar_epicos', 'listar_outcomes', 'listar_tarefas',
      ].sort(),
    );
    expect(byName.buscar.annotations?.readOnlyHint).toBe(true);
    expect(byName.criar_tarefa.annotations?.readOnlyHint).toBe(false);
    expect(byName.atualizar_outcome.annotations?.destructiveHint).toBe(true);
  });

  it('contexto e busca de itens parecidos (sem acento/maiúscula)', async () => {
    const c = (await call('contexto')).data;
    expect(c.voce_esta_agindo_como.nome).toBe('Maria');
    expect(c.status.length).toBeGreaterThan(0);
    const b = (await call('buscar', { texto: 'tempo MEDIO de atendimento' })).data;
    expect(b.outcomes[0].nome).toBe('Reduzir tempo médio de atendimento');
    expect(b.outcomes[0].semelhanca).toBe(1);
  });

  it('cria épico → outcome → tarefa ligados; edita só o que foi informado; flag', async () => {
    const c = (await call('contexto')).data;
    const ana = c.pessoas.find((p: { nome: string }) => p.nome === 'Ana');
    const epic = (await call('criar_epico', { name: 'Atendimento digital', okr: 'O3 2026' })).data;
    const outcome = (
      await call('criar_outcome', {
        epic_id: epic.id,
        name: 'Reduzir filas no balcão',
        indicator_name: 'Tempo de espera',
        indicator_unit: 'min',
        baseline_value: 40,
        target_value: 10,
      })
    ).data;
    expect(outcome.epico.id).toBe(epic.id);
    const task = (
      await call('criar_tarefa', {
        title: 'Agendamento online',
        sector_id: c.setores[0].id,
        requester_id: ana.id,
        assignee_id: ana.id,
        outcome_id: outcome.id,
        priority: 'alta',
      })
    ).data;
    expect(task.epico.id).toBe(epic.id); // herdado do outcome
    const detail = (await call('detalhe', { tipo: 'tarefa', id: task.id })).data;
    expect(detail.history[0].changed_by_name).toBe('Maria'); // ação registrada em nome do dono do token

    const edited = (await call('atualizar_outcome', { id: outcome.id, current_value: 25 })).data;
    expect(edited.indicador).toMatchObject({ baseline: 40, atual: 25, meta: 10, nome: 'Tempo de espera' });
    expect(edited.nome).toBe('Reduzir filas no balcão');

    const done = c.status.find((s: { conclusao: number }) => s.conclusao);
    const moved = (await call('atualizar_tarefa', { id: task.id, status_id: done.id })).data;
    expect(moved.status).toBe(done.nome);
    expect(moved.prioridade).toBe('alta');

    const flagged = (await call('flag', { tipo: 'outcome', id: outcome.id, com_flag: true, motivo: 'Aguardando TI' })).data;
    expect(flagged.flag.motivo).toBe('Aguardando TI');

    const list = (await call('listar_tarefas', { outcome_id: outcome.id })).data;
    expect(list.total).toBe(1);
  });

  it('tags: cria tarefa com tag e lista por tag', async () => {
    const c = (await call('contexto')).data;
    expect(c.tags.some((g: { nome: string }) => g.nome === 'Kynera')).toBe(true);
    const ana = c.pessoas.find((p: { nome: string }) => p.nome === 'Ana');
    const t = (
      await call('criar_tarefa', { title: 'Integração Kynera', sector_id: c.setores[0].id, requester_id: ana.id, assignee_id: ana.id, tags: ['Kynera'] })
    ).data;
    expect(t.tags).toEqual(['Kynera']);
    const list = (await call('listar_tarefas', { tag: 'kynera' })).data;
    expect(list.tarefas.some((x: { id: number }) => x.id === t.id)).toBe(true);
    expect((await call('listar_tarefas', { tag: 'Inexistente' })).data.total).toBe(0);
    const edited = (await call('atualizar_tarefa', { id: t.id, tags: ['Kynera', 'Urgente cliente'] })).data;
    expect(edited.tags).toEqual(['Kynera', 'Urgente cliente']);
  });

  it('erros de validação voltam como mensagem legível', async () => {
    const r = await call('criar_outcome', { epic_id: 999999, name: 'X' });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('Épico inválido');
    const d = await call('detalhe', { tipo: 'epico', id: 999999 });
    expect(d.isError).toBe(true);
  });
});
