import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { setup } from './helpers.js';

let ctx: Awaited<ReturnType<typeof setup>>;
let carla: ReturnType<typeof request.agent>;

beforeEach(async () => {
  ctx = await setup();
  carla = request.agent(ctx.app);
  await carla.post('/api/auth/login').send({ email: 'carla@empresa.com', password: '123456' }).expect(200);
});

const fields = {
  title: 'Relatório de visitas',
  description: 'Listar as visitas da semana por vendedor.',
  benefit: 'Menos tempo montando planilhas.',
  success_indicator: 'Horas gastas por semana',
};

function submit(agent: ReturnType<typeof request.agent>, files: [string, Buffer][] = [], extra: Record<string, string> = {}) {
  let req = agent.post('/api/requests');
  for (const [k, v] of Object.entries({ ...fields, ...extra })) req = req.field(k, v);
  for (const [name, buf] of files) req = req.attach('files', buf, name);
  return req;
}

describe('perfis', () => {
  it('solicitante não acessa as áreas da equipe', async () => {
    for (const path of ['/api/tasks', '/api/epics', '/api/outcomes', '/api/dashboard/metrics', '/api/users/options', '/api/statuses']) {
      await carla.get(path).expect(403);
    }
    await carla.get('/api/sectors').expect(200);
    await carla.get('/api/requests').expect(403); // lista geral: só admin
  });

  it('somente administradores movem tarefas para a lixeira', async () => {
    const { body } = await ctx.userAgent
      .post('/api/tasks')
      .send({ title: 'T', sector_id: 1, requester_id: 1, assignee_id: 1 })
      .expect(201);
    await ctx.userAgent.delete(`/api/tasks/${body.id}`).expect(403);
    await ctx.agent.delete(`/api/tasks/${body.id}`).expect(204);
  });
});

describe('solicitações', () => {
  it('cria com anexos, usando o setor do solicitante por padrão', async () => {
    const res = await submit(carla, [
      ['foto.png', Buffer.from('png')],
      ['planilha.xlsx', Buffer.from('xlsx')],
    ]).expect(201);
    expect(res.body.status).toBe('aguardando');
    expect(res.body.sector_name).toBe('Comercial');
    expect(res.body.attachments).toHaveLength(2);
    expect(res.body.can_edit).toBe(true);

    const file = await carla.get(res.body.attachments[0].url).expect(200);
    expect(file.headers['content-type']).toContain('image/png');
    expect(file.headers['content-disposition']).toMatch(/^inline/);
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    const xlsx = await carla.get(res.body.attachments[1].url).expect(200);
    expect(xlsx.headers['content-disposition']).toMatch(/^attachment/);
  });

  it('valida campos obrigatórios, quantidade, tamanho e tipo dos anexos', async () => {
    await submit(carla, [], { benefit: '' }).expect(400);
    const six = Array.from({ length: 6 }, (_, i) => [`a${i}.txt`, Buffer.from('x')] as [string, Buffer]);
    await submit(carla, six).expect(400);
    const big = Buffer.alloc(6 * 1024 * 1024);
    const r = await submit(carla, [
      ['a.pdf', big],
      ['b.pdf', big],
    ]).expect(400);
    expect(r.body.error).toContain('10 MB');
    await submit(carla, [['script.html', Buffer.from('<script>')]]).expect(400);
    await submit(carla, [], { link: 'javascript:alert(1)' }).expect(400);
  });

  it('cada solicitante vê só as suas; anexos protegidos', async () => {
    const mine = await submit(carla, [['nota.txt', Buffer.from('oi')]]).expect(201);
    const maria = await submit(ctx.userAgent).expect(201);
    const list = (await carla.get('/api/requests/mine').expect(200)).body as { id: number; requester_name: string }[];
    expect(list.every((r) => r.requester_name === 'Carla')).toBe(true);
    expect(list.some((r) => r.id === maria.body.id)).toBe(false);
    await carla.get(`/api/requests/${maria.body.id}`).expect(404);
    // Equipe não vê solicitações ainda não aprovadas de outras pessoas, nem seus anexos
    await ctx.userAgent.get(`/api/requests/${mine.body.id}`).expect(404);
    await ctx.userAgent.get(mine.body.attachments[0].url).expect(404);
    await ctx.agent.get(mine.body.attachments[0].url).expect(200);
  });

  it('pedir informação → solicitante edita e reenvia → volta a aguardar', async () => {
    const { body } = await submit(carla, [['a.txt', Buffer.from('1')]]).expect(201);
    await carla.post(`/api/requests/${body.id}/decision`).send({ action: 'info', note: 'Detalhe' }).expect(403);
    await ctx.agent.post(`/api/requests/${body.id}/decision`).send({ action: 'info', note: '' }).expect(400);
    const info = await ctx.agent
      .post(`/api/requests/${body.id}/decision`)
      .send({ action: 'info', note: 'Quais vendedores?' })
      .expect(200);
    expect(info.body.status).toBe('info');

    const edited = await carla
      .put(`/api/requests/${body.id}`)
      .field('title', 'Relatório de visitas (todos)')
      .field('description', 'Todos os vendedores.')
      .field('benefit', fields.benefit)
      .field('remove_attachment_ids', String(body.attachments[0].id))
      .attach('files', Buffer.from('2'), 'nova.txt')
      .expect(200);
    expect(edited.body.status).toBe('aguardando');
    expect(edited.body.attachments.map((a: { filename: string }) => a.filename)).toEqual(['nova.txt']);
    await ctx.agent.get(`/api/requests/${body.id}`).expect(200);
    await ctx.userAgent.put(`/api/requests/${body.id}`).send(fields).expect(403);
  });

  it('recusar exige motivo, e a solicitação deixa de ser editável', async () => {
    const { body } = await submit(carla).expect(201);
    await ctx.agent.post(`/api/requests/${body.id}/decision`).send({ action: 'reject' }).expect(400);
    const r = await ctx.agent
      .post(`/api/requests/${body.id}/decision`)
      .send({ action: 'reject', note: 'Já existe relatório no ERP.' })
      .expect(200);
    expect(r.body.status).toBe('recusada');
    const seen = (await carla.get(`/api/requests/${body.id}`).expect(200)).body;
    expect(seen.decision_note).toBe('Já existe relatório no ERP.');
    expect(seen.can_edit).toBe(false);
    await carla.put(`/api/requests/${body.id}`).send(fields).expect(400);
  });

  it('aprova como tarefa: solicitante vira o solicitante da tarefa, e a tarefa mostra a origem', async () => {
    const { body } = await submit(carla, [['print.png', Buffer.from('img')]]).expect(201);
    await ctx.userAgent
      .post(`/api/requests/${body.id}/convert`)
      .send({ type: 'task', data: { title: 'X', assignee_id: 1 } })
      .expect(403);
    const conv = await ctx.agent
      .post(`/api/requests/${body.id}/convert`)
      .send({ type: 'task', data: { title: 'Relatório de visitas', assignee_id: 3 } })
      .expect(201);
    expect(conv.body.request.status).toBe('aprovada');
    const task = (await ctx.agent.get(`/api/tasks/${conv.body.created.id}`).expect(200)).body;
    expect(task.requester_name).toBe('Carla');
    expect(task.origin_request.id).toBe(body.id);
    expect(task.origin_request.attachments).toHaveLength(1);
    // Equipe acessa os anexos da solicitação aprovada
    await ctx.userAgent.get(task.origin_request.attachments[0].url).expect(200);

    const mine = (await carla.get('/api/requests/mine').expect(200)).body.find((r: { id: number }) => r.id === body.id);
    expect(mine.converted).toMatchObject({ type: 'task', status_name: 'Backlog', removed: false });

    // Não pode ser convertida de novo nem editada
    await ctx.agent.post(`/api/requests/${body.id}/convert`).send({ type: 'task', data: { title: 'Y' } }).expect(400);
    await carla.put(`/api/requests/${body.id}`).send(fields).expect(400);
  });

  it('aprova como outcome e como épico', async () => {
    const a = (await submit(carla).expect(201)).body;
    const b = (await submit(carla).expect(201)).body;
    const epics = (await ctx.agent.get('/api/epics').expect(200)).body as { id: number }[];
    const o = await ctx.agent
      .post(`/api/requests/${a.id}/convert`)
      .send({ type: 'outcome', data: { name: 'Visitas registradas', epic_id: epics[0].id, indicator_name: 'Horas por semana' } })
      .expect(201);
    const outcome = (await ctx.agent.get(`/api/outcomes/${o.body.created.id}`).expect(200)).body;
    expect(outcome.origin_request.id).toBe(a.id);

    const e = await ctx.agent
      .post(`/api/requests/${b.id}/convert`)
      .send({ type: 'epic', data: { name: 'Força de vendas' } })
      .expect(201);
    const epic = (await ctx.agent.get(`/api/epics/${e.body.created.id}`).expect(200)).body;
    expect(epic.origin_request.id).toBe(b.id);

    // Dados inválidos não aprovam (transação desfeita)
    const c = (await submit(carla).expect(201)).body;
    await ctx.agent.post(`/api/requests/${c.id}/convert`).send({ type: 'epic', data: { name: '' } }).expect(400);
    expect((await ctx.agent.get(`/api/requests/${c.id}`).expect(200)).body.status).toBe('aguardando');
  });

  it('contagem por status para o administrador', async () => {
    await submit(carla).expect(201);
    const counts = (await ctx.agent.get('/api/requests/counts').expect(200)).body;
    expect(counts.aguardando).toBeGreaterThanOrEqual(2); // seed + nova
    const pend = (await ctx.agent.get('/api/requests?status=aguardando').expect(200)).body;
    expect(pend.length).toBe(counts.aguardando);
  });
});
