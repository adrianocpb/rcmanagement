import fs from 'node:fs';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { taskUploadsDir } from '../src/modules/comments.js';
import { setup } from './helpers.js';

let ctx: Awaited<ReturnType<typeof setup>>;
let taskId: number;
const png = Buffer.from('89504e470d0a1a0a', 'hex');

beforeEach(async () => {
  ctx = await setup();
  taskId = (
    await ctx.agent.post('/api/tasks').send({ title: 'Com comentários', sector_id: 1, requester_id: 2, assignee_id: 3 }).expect(201)
  ).body.id;
});

const url = () => `/api/tasks/${taskId}/comments`;

describe('comentários das tarefas', () => {
  it('cria comentário com texto e anexos; lista na ordem e conta no card', async () => {
    const c = await ctx.userAgent
      .post(url())
      .field('body', 'Veja o print e o link https://exemplo.com/doc')
      .attach('files', png, 'print.png')
      .attach('files', Buffer.from('%PDF-1.4'), 'relatório.pdf')
      .attach('files', Buffer.from('PK'), 'planilha.xlsx')
      .attach('files', Buffer.from('PK'), 'ata.docx')
      .expect(201);
    expect(c.body.author_name).toBe('Maria');
    expect(c.body.attachments.map((i: { filename: string }) => i.filename)).toEqual(['print.png', 'relatório.pdf', 'planilha.xlsx', 'ata.docx']);
    await ctx.agent.post(url()).send({ body: 'Segundo comentário' }).expect(201);

    const list = (await ctx.agent.get(url()).expect(200)).body;
    expect(list.map((x: { body: string }) => x.body)).toEqual(['Veja o print e o link https://exemplo.com/doc', 'Segundo comentário']);
    expect(list[0].can_edit).toBe(false); // admin não edita comentário de outra pessoa
    expect(list[0].can_delete).toBe(true); // mas pode excluir

    const [img, pdf, xlsx] = c.body.attachments;
    const imgRes = await ctx.agent.get(img.url).expect(200);
    expect(imgRes.headers['content-type']).toContain('image/png');
    expect(imgRes.headers['content-disposition']).toMatch(/^inline/);
    expect(imgRes.headers['x-content-type-options']).toBe('nosniff');
    expect((await ctx.agent.get(pdf.url).expect(200)).headers['content-disposition']).toMatch(/^inline/);
    const x = await ctx.agent.get(xlsx.url).expect(200);
    expect(x.headers['content-type']).toContain('spreadsheetml');
    expect(x.headers['content-disposition']).toMatch(/^attachment/);

    const task = (await ctx.agent.get(`/api/tasks/${taskId}`).expect(200)).body;
    expect(task.comments_count).toBe(2);
  });

  it('valida conteúdo, quantidade, tamanho e tipo dos anexos', async () => {
    await ctx.agent.post(url()).send({ body: '   ' }).expect(400);
    let req = ctx.agent.post(url()).field('body', 'x');
    for (let i = 0; i < 6; i++) req = req.attach('files', png, `p${i}.png`);
    await req.expect(400);
    const big = Buffer.alloc(6 * 1024 * 1024);
    await ctx.agent.post(url()).attach('files', big, 'a.pdf').attach('files', big, 'b.pdf').expect(400);
    await ctx.agent.post(url()).attach('files', Buffer.from('<svg/>'), 'x.svg').expect(400);
    await ctx.agent.post(url()).attach('files', Buffer.from('<script>'), 'x.html').expect(400);
    // Só anexo, sem texto, é permitido
    await ctx.agent.post(url()).attach('files', Buffer.from('a;b'), 'so-anexo.csv').expect(201);
  });

  it('autor edita; só autor ou administrador exclui', async () => {
    const mine = (await ctx.userAgent.post(url()).send({ body: 'Texto original' }).expect(201)).body;
    await ctx.agent.put(`${url()}/${mine.id}`).send({ body: 'Edição do admin' }).expect(403);
    const edited = (await ctx.userAgent.put(`${url()}/${mine.id}`).send({ body: 'Texto corrigido' }).expect(200)).body;
    expect(edited.body).toBe('Texto corrigido');
    expect(edited.edited).toBe(true);

    const pedro = request.agent(ctx.app);
    await pedro.post('/api/auth/login').send({ email: 'pedro@empresa.com', password: '123456' }).expect(200);
    await pedro.delete(`${url()}/${mine.id}`).expect(403);
    await ctx.agent.delete(`${url()}/${mine.id}`).expect(204);
    expect((await ctx.agent.get(url()).expect(200)).body).toHaveLength(0);
  });

  it('solicitante não acessa comentários', async () => {
    const carla = request.agent(ctx.app);
    await carla.post('/api/auth/login').send({ email: 'carla@empresa.com', password: '123456' }).expect(200);
    await carla.get(url()).expect(403);
    await carla.post(url()).send({ body: 'oi' }).expect(403);
  });

  it('excluir comentário apaga os anexos; esvaziar a lixeira apaga a pasta da tarefa', async () => {
    // Os testes usam bancos novos em memória: o mesmo id de tarefa se repete entre eles.
    fs.rmSync(taskUploadsDir(taskId), { recursive: true, force: true });
    const c = (await ctx.agent.post(url()).field('body', 'com imagem').attach('files', png, 'a.png').expect(201)).body;
    const dir = taskUploadsDir(taskId);
    expect(fs.readdirSync(dir)).toHaveLength(1);
    await ctx.agent.delete(`${url()}/${c.id}`).expect(204);
    expect(fs.readdirSync(dir)).toHaveLength(0);

    await ctx.agent.post(url()).attach('files', Buffer.from('PK'), 'b.docx').expect(201);
    await ctx.agent.delete(`/api/tasks/${taskId}`).expect(204);
    await ctx.agent.get(url()).expect(404); // tarefa na lixeira
    await ctx.agent.delete('/api/tasks/trash').expect(200);
    expect(fs.existsSync(dir)).toBe(false);
  });
});
