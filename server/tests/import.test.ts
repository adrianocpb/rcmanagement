import { describe, expect, it } from 'vitest';
import {
  buildTitle,
  decodeText,
  detectDateOrder,
  importCsv,
  mapSectorName,
  mapStatusName,
  parseCsv,
  parseDate,
  parseHours,
} from '../src/db/import-csv.js';
import { setup } from './helpers.js';

/** Codifica texto em Windows-1252 (como o Excel exporta), para testar a detecção. */
function cp1252(text: string): Uint8Array {
  return Uint8Array.from([...text].map((ch) => ch.charCodeAt(0)));
}

const CSV = [
  'Descrição,Setor,Responsáveis,Status,Prazo,Tempo Estimado,Tempo Gasto,Data inicial da Solicitação,Iniciado em,Concluído em,Atendimento,Observação,Coluna1,Coluna2',
  'Aplicativo SST Varejo Mais,Contábil/Fiscal,Inácio,?? Pausado,5/22/2026,,,12/10/2025,3/3/2026,,,Colaborador saiu.,,',
  'Auditor Folha - Novas regras,Pessoal,Inácio,Não Iniciado,A definir,110h,,10/10/2025,,,26616,,,',
  '"Integração com ""aspas"" e\nquebra de linha",Contábil/Fiscal - Beta,Terceiro,?? Em andamento,,8h,,,,,,,,obs extra',
  'Demanda sem dados,,,,,,,,,,,,,',
].join('\r\n');

describe('importador CSV: funções', () => {
  it('detecta Windows-1252 e UTF-8', () => {
    expect(decodeText(cp1252('Descrição')).encoding).toBe('windows-1252');
    expect(decodeText(cp1252('Descrição')).text).toBe('Descrição');
    expect(decodeText(new TextEncoder().encode('﻿Descrição')).text).toBe('Descrição');
  });
  it('lê aspas, aspas duplicadas e quebras de linha dentro da célula', () => {
    const rows = parseCsv(CSV);
    expect(rows).toHaveLength(5);
    expect(rows[3][0]).toBe('Integração com "aspas" e\nquebra de linha');
    expect(parseCsv('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('datas: detecta mês/dia ou dia/mês e converte', () => {
    expect(detectDateOrder(['5/22/2026', '1/9/2026'])).toBe('mdy');
    expect(detectDateOrder(['22/5/2026'])).toBe('dmy');
    expect(parseDate('5/22/2026', 'mdy')).toBe('2026-05-22');
    expect(parseDate('22/5/2026', 'dmy')).toBe('2026-05-22');
    expect(parseDate('A definir', 'mdy')).toBeNull();
    expect(() => parseDate('2/30/2026', 'mdy')).toThrow();
  });
  it('horas, status e setor', () => {
    expect(parseHours('110h')).toBe(110);
    expect(parseHours('2,5 h')).toBe(2.5);
    expect(parseHours('')).toBeNull();
    expect(mapStatusName('?? Em andamento')).toBe('Em desenvolvimento');
    expect(mapStatusName('Não Iniciado')).toBe('Backlog');
    expect(mapStatusName('')).toBe('Backlog');
    expect(mapSectorName('Contábil/Fiscal - Beta')).toBe('Beta');
    expect(mapSectorName('')).toBe('Não informado');
  });
  it('títulos: curto vira título; longo é resumido e o texto completo vai para a descrição', () => {
    expect(buildTitle('Aplicativo de Estudo Tributário.')).toEqual({ title: 'Aplicativo de Estudo Tributário', description: null });
    const fecop = buildTitle('Com essa nova mudança na forma de calculo do FECOP no RN, será necessário adaptação...');
    expect(fecop.title).toBe('Adição do imposto FECOP cod. 5415');
    expect(fecop.description).toContain('FECOP no RN');
    const generic = buildTitle('x'.repeat(30) + ' ' + 'palavra '.repeat(20));
    expect(generic.title.length).toBeLessThanOrEqual(81);
    expect(generic.description).not.toBeNull();
  });
});

describe('importador CSV: banco', () => {
  async function prepared() {
    const ctx = await setup();
    const now = new Date().toISOString();
    for (const name of ['Pausado', 'Cancelado']) {
      ctx.db
        .prepare('INSERT INTO statuses (name, color, position, active, created_at, updated_at) VALUES (?, ?, 99, 1, ?, ?)')
        .run(name, '#999999', now, now);
    }
    ctx.db
      .prepare("INSERT INTO users (name, email, password_hash, role, active, created_at, updated_at) VALUES ('Inácio', 'inacio@x', 'x', 'user', 1, ?, ?)")
      .run(now, now);
    return ctx;
  }

  it('simulação não grava nada', async () => {
    const { db } = await prepared();
    const before = (db.prepare('SELECT COUNT(*) AS n FROM tasks').get() as { n: number }).n;
    const r = importCsv(db, cp1252(CSV), { dryRun: true });
    expect(r.created).toHaveLength(4);
    expect((db.prepare('SELECT COUNT(*) AS n FROM tasks').get() as { n: number }).n).toBe(before);
  });

  it('importa com as regras combinadas e não duplica ao rodar de novo', async () => {
    const { db } = await prepared();
    const r = importCsv(db, cp1252(CSV), { dryRun: false });
    expect(r.created).toHaveLength(4);
    expect(r.createdSectors.sort()).toEqual(['Beta', 'Contábil/Fiscal', 'Não informado', 'Pessoal']);
    expect(r.createdUsers).toEqual(['Terceiro (teste03@ruicadete.com.br)']);

    const t = db
      .prepare(
        `SELECT t.*, s.name AS status, sec.name AS sector, a.name AS assignee, r.name AS requester
           FROM tasks t JOIN statuses s ON s.id = t.status_id JOIN sectors sec ON sec.id = t.sector_id
           JOIN users a ON a.id = t.assignee_id JOIN users r ON r.id = t.requester_id
          WHERE t.title = 'Auditor Folha - Novas regras'`,
      )
      .get() as Record<string, unknown>;
    expect(t).toMatchObject({
      status: 'Backlog',
      sector: 'Pessoal',
      assignee: 'Inácio',
      requester: 'Administrador',
      planned_end_date: null,
      estimated_hours: 110,
      notes: 'Atendimento nº 26616',
      created_at: '2025-10-10T12:00:00.000Z', // 09:00 em São Paulo
      started_at: null,
      completed_at: null,
    });
    const pausado = db.prepare("SELECT planned_end_date, notes FROM tasks WHERE title = 'Aplicativo SST Varejo Mais'").get() as Record<string, unknown>;
    expect(pausado).toEqual({ planned_end_date: '2026-05-22', notes: 'Colaborador saiu.' });
    const history = db.prepare("SELECT COUNT(*) AS n FROM task_status_history h JOIN tasks t ON t.id = h.task_id WHERE t.title = 'Aplicativo SST Varejo Mais'").get() as { n: number };
    expect(history.n).toBe(1);

    const again = importCsv(db, cp1252(CSV), { dryRun: false });
    expect(again.created).toHaveLength(0);
    expect(again.skipped).toHaveLength(4);
  });

  it('para com erro claro se o responsável não existir', async () => {
    const { db } = await prepared();
    const csv = CSV.replace('Inácio,?? Pausado', 'Fulano,?? Pausado');
    expect(() => importCsv(db, cp1252(csv), { dryRun: true })).toThrow(/Responsável "Fulano"/);
  });
});
