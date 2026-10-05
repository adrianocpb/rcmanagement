/**
 * Importação de demandas a partir da planilha (CSV exportado do Excel).
 *
 * Uso (na pasta do projeto, com o sistema DESLIGADO):
 *   npm run importar -- caminho\planilha.csv --simular   → mostra o que seria feito, sem gravar
 *   npm run importar -- caminho\planilha.csv             → importa (faz cópia de segurança antes)
 *
 * Regras combinadas com a área:
 *  - Títulos: descrições curtas viram o título; descrições longas recebem um título resumido e o
 *    texto completo fica no campo Descrição.
 *  - Setores inexistentes são criados ("Contábil/Fiscal - Beta" vira "Beta").
 *  - Responsável "Terceiro" → usuário Terceiro (criado se não existir). Demais responsáveis devem existir.
 *  - Status: Não iniciado → Backlog; Em andamento → Em desenvolvimento; Pausado e Cancelado → iguais.
 *  - Solicitante: Administrador. Prazo: opcional ("A definir" = sem prazo). Tempo estimado: "110h" → 110.
 *  - Data inicial da solicitação → data de criação. Tempo gasto, Iniciado em e Concluído em: ignorados.
 *  - Nº do atendimento e observações vão para o campo Observações.
 *  - Não duplica: tarefas com o mesmo título já existentes são ignoradas (pode rodar de novo com segurança).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { hashPassword } from '../lib/auth.js';
import { nowIso, zonedWallTimeToUtc } from '../lib/time.js';
import { migrate, openDatabase, type DB } from './connection.js';

// ---------------- Leitura do arquivo ----------------

const CP1252_EXTRA: Record<number, string> = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š',
  0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—',
  0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
};

/** Decodifica UTF-8 (com ou sem BOM) ou, se não for UTF-8 válido, Windows-1252 (padrão do Excel no Brasil). */
export function decodeText(buf: Uint8Array): { text: string; encoding: 'utf-8' | 'windows-1252' } {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return { text: text.replace(/^﻿/, ''), encoding: 'utf-8' };
  } catch {
    let text = '';
    for (const b of buf) text += CP1252_EXTRA[b] ?? String.fromCharCode(b);
    return { text, encoding: 'windows-1252' };
  }
}

/** Parser de CSV (RFC 4180): aspas, aspas duplicadas e quebras de linha dentro de células. */
export function parseCsv(text: string, delimiter?: string): string[][] {
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? undefined : text.indexOf('\n'));
  const sep = delimiter ?? (firstLine.split(';').length > firstLine.split(',').length ? ';' : ',');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') inQuotes = false;
      else cell += c;
    } else if (c === '"') inQuotes = true;
    else if (c === sep) (row.push(cell), (cell = ''));
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) (row.push(cell), rows.push(row));
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

// ---------------- Normalizações ----------------

/** Comparação tolerante: sem acentos, espaços, pontuação e maiúsculas. */
export const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const clean = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

export type DateOrder = 'mdy' | 'dmy';

/** Detecta se as datas estão como mês/dia/ano (Excel em inglês) ou dia/mês/ano. */
export function detectDateOrder(values: string[]): DateOrder {
  let mdy = false;
  let dmy = false;
  for (const v of values) {
    const m = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) continue;
    if (Number(m[1]) > 12) dmy = true;
    if (Number(m[2]) > 12) mdy = true;
  }
  if (mdy && dmy) throw new Error('Datas com formatos misturados (dia/mês e mês/dia) na mesma planilha.');
  return dmy ? 'dmy' : 'mdy';
}

/** "5/22/2026" → "2026-05-22". Vazio, "A definir" etc. → null. Data inválida → erro. */
export function parseDate(v: string | undefined, order: DateOrder): string | null {
  const s = clean(v);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [a, b, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const [month, day] = order === 'mdy' ? [a, b] : [b, a];
  const iso = `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) throw new Error(`Data inválida: "${s}"`);
  return iso;
}

/** "110h" / "8 h" / "2,5h" → número de horas. */
export function parseHours(v: string | undefined): number | null {
  const m = clean(v).replace(',', '.').match(/^(\d+(?:\.\d+)?)\s*h?$/i);
  return m ? Number(m[1]) : null;
}

/** Títulos resumidos para as descrições longas da planilha atual (chave: início da descrição normalizado). */
const CURATED_TITLES: [string, string][] = [
  ['Melhoria do Auditor - Simples verificar o limite', 'Melhoria do Auditor Simples: limite de desenquadramento e CBS/IBS'],
  ['Com essa nova mudança na forma de calculo do FECOP', 'Adição do imposto FECOP cod. 5415'],
  ['Planilha para validação dos check-list de fechamento', 'Planilha de validação do check-list de fechamento de contrato'],
  ['Implementação confronto de notas e sitema, Estados PE e PB', 'Confronto de notas x sistema – PE e PB (Varejo)'],
  ['Implementação do confronto de notas sistema BA e MA', 'Confronto de notas x sistema – BA e MA (Varejo)'],
  ['Automação para salvar os recibos dos eventos 2099 e 4099', 'Automação dos recibos da REINF (eventos 2099 e 4099)'],
  ['Aplicativo do SIMPLES para o cliente para conferência', 'Aplicativo do SIMPLES para conferência do limite de desenquadramento'],
  ['Aplicativo para receber todas os e-mails das metas', 'Aplicativo para baixar metas recebidas por e-mail (P Contabilidade)'],
  ['Planilha de otimização - transformar em aplicativos', 'Transformar a planilha de otimização em aplicativo'],
];

export const TITLE_MAX = 80;

/** Título + descrição: textos curtos viram o próprio título; longos ganham título resumido. */
export function buildTitle(description: string): { title: string; description: string | null } {
  const full = clean(description);
  const curated = CURATED_TITLES.find(([prefix]) => norm(full).startsWith(norm(prefix)));
  if (curated) return { title: curated[1], description: full };
  const short = full.replace(/\.$/, '');
  if (short.length <= TITLE_MAX) return { title: short, description: null };
  // Genérico: primeira frase, cortada em palavra inteira.
  const sentence = full.split(/(?<=[.;])\s/)[0];
  let title = sentence.length <= TITLE_MAX ? sentence : sentence.slice(0, TITLE_MAX).replace(/\s+\S*$/, '') + '…';
  title = title.replace(/[.;]$/, '');
  return { title, description: full };
}

/** Status da planilha → nome do status no sistema (ignora emojis/"??" no início). */
export function mapStatusName(v: string | undefined): string {
  const s = norm(clean(v));
  if (!s || s.includes('naoiniciado')) return 'Backlog';
  if (s.includes('andamento')) return 'Em desenvolvimento';
  if (s.includes('pausado')) return 'Pausado';
  if (s.includes('cancelado')) return 'Cancelado';
  if (s.includes('conclu')) return 'Concluído';
  throw new Error(`Status desconhecido na planilha: "${clean(v)}"`);
}

/** Setor da planilha → nome do setor no sistema. */
export function mapSectorName(v: string | undefined): string {
  const s = clean(v);
  if (!s) return 'Não informado';
  if (norm(s) === norm('Contábil/Fiscal - Beta')) return 'Beta';
  return s;
}

// ---------------- Importação ----------------

export interface ImportOptions {
  dryRun: boolean;
  now?: Date;
}

export interface ImportReport {
  encoding: string;
  dateOrder: DateOrder;
  rows: number;
  created: { line: number; title: string; status: string; sector: string; assignee: string }[];
  skipped: { line: number; title: string; reason: string }[];
  createdSectors: string[];
  createdUsers: string[];
  warnings: string[];
}

const COLS = {
  description: 'Descrição',
  sector: 'Setor',
  assignee: 'Responsáveis',
  status: 'Status',
  due: 'Prazo',
  estimate: 'Tempo Estimado',
  requestDate: 'Data inicial da Solicitação',
  ticket: 'Atendimento',
  notes: 'Observação',
  extra1: 'Coluna1',
  extra2: 'Coluna2',
};

export function importCsv(db: DB, buf: Uint8Array, opts: ImportOptions): ImportReport {
  const { text, encoding } = decodeText(buf);
  const [header, ...data] = parseCsv(text);
  const idx = (name: string) => header.findIndex((h) => norm(h) === norm(name));
  for (const required of [COLS.description, COLS.sector, COLS.assignee, COLS.status]) {
    if (idx(required) === -1) throw new Error(`Coluna obrigatória não encontrada na planilha: "${required}"`);
  }
  const get = (row: string[], col: string) => (idx(col) === -1 ? '' : (row[idx(col)] ?? ''));
  const dateOrder = detectDateOrder(data.flatMap((r) => [get(r, COLS.due), get(r, COLS.requestDate)]));
  const now = opts.now ?? new Date();

  const report: ImportReport = {
    encoding,
    dateOrder,
    rows: data.length,
    created: [],
    skipped: [],
    createdSectors: [],
    createdUsers: [],
    warnings: [],
  };

  const users = db.prepare('SELECT id, name, email, role FROM users').all() as { id: number; name: string; email: string; role: string }[];
  const sectors = db.prepare('SELECT id, name FROM sectors').all() as { id: number; name: string }[];
  const statuses = db.prepare('SELECT * FROM statuses').all() as {
    id: number;
    name: string;
    is_start_status: number;
    is_completion_status: number;
  }[];
  const existingTitles = new Set(
    (db.prepare('SELECT title FROM tasks WHERE deleted_at IS NULL').all() as { title: string }[]).map((t) => norm(t.title)),
  );

  const admin =
    users.find((u) => norm(u.name) === norm('Administrador')) ?? users.find((u) => u.role === 'admin');
  if (!admin) throw new Error('Nenhum administrador encontrado para usar como solicitante.');

  const findUser = (name: string) => users.find((u) => norm(u.name) === norm(name));
  const findSector = (name: string) => sectors.find((s) => norm(s.name) === norm(name));
  const findStatus = (name: string) => statuses.find((s) => norm(s.name) === norm(name));

  let fakeId = -1; // ids provisórios no modo simulação
  const ensureSector = (name: string) => {
    let s = findSector(name);
    if (!s) {
      const id = opts.dryRun
        ? fakeId--
        : Number(
            db
              .prepare('INSERT INTO sectors (name, active, created_at, updated_at) VALUES (?, 1, ?, ?)')
              .run(name, nowIso(), nowIso()).lastInsertRowid,
          );
      s = { id, name };
      sectors.push(s);
      report.createdSectors.push(name);
    }
    return s;
  };
  const ensureTerceiro = () => {
    let u = findUser('Terceiro') ?? users.find((x) => x.email.toLowerCase() === 'teste03@ruicadete.com.br');
    if (!u) {
      const id = opts.dryRun
        ? fakeId--
        : Number(
            db
              .prepare(
                `INSERT INTO users (name, email, password_hash, role, active, created_at, updated_at)
                 VALUES (?, ?, ?, 'user', 1, ?, ?)`,
              )
              .run('Terceiro', 'teste03@ruicadete.com.br', hashPassword('123456'), nowIso(), nowIso()).lastInsertRowid,
          );
      u = { id, name: 'Terceiro', email: 'teste03@ruicadete.com.br', role: 'user' };
      users.push(u);
      report.createdUsers.push('Terceiro (teste03@ruicadete.com.br)');
    }
    return u;
  };

  const insertTask = db.prepare(
    `INSERT INTO tasks (title, description, notes, sector_id, requester_id, assignee_id, status_id, priority,
                        estimated_hours, planned_end_date, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'media', ?, ?, ?, ?, ?)`,
  );
  const insertHistory = db.prepare(
    'INSERT INTO task_status_history (task_id, from_status_id, to_status_id, changed_by, changed_at) VALUES (?, ?, ?, ?, ?)',
  );

  data.forEach((row, i) => {
    const line = i + 2; // linha 1 = cabeçalho
    const rawDescription = get(row, COLS.description);
    if (!clean(rawDescription)) {
      report.skipped.push({ line, title: '(sem descrição)', reason: 'linha sem descrição' });
      return;
    }
    const { title, description } = buildTitle(rawDescription);
    if (existingTitles.has(norm(title))) {
      report.skipped.push({ line, title, reason: 'já existe uma tarefa com este título' });
      return;
    }

    const statusName = mapStatusName(get(row, COLS.status));
    const status = findStatus(statusName);
    if (!status) throw new Error(`Status "${statusName}" não existe no sistema (linha ${line}). Crie-o em Administração → Status.`);

    const sector = ensureSector(mapSectorName(get(row, COLS.sector)));
    const assigneeName = clean(get(row, COLS.assignee));
    let assignee = !assigneeName
      ? admin
      : norm(assigneeName) === norm('Terceiro')
        ? ensureTerceiro()
        : findUser(assigneeName);
    if (!assignee) throw new Error(`Responsável "${assigneeName}" não existe no sistema (linha ${line}). Cadastre-o antes.`);
    if (!assigneeName) report.warnings.push(`Linha ${line} ("${title}"): sem responsável → Administrador.`);
    if (!clean(get(row, COLS.sector))) report.warnings.push(`Linha ${line} ("${title}"): sem setor → "Não informado".`);
    if (!clean(get(row, COLS.status))) report.warnings.push(`Linha ${line} ("${title}"): sem status → Backlog.`);

    const requestDate = parseDate(get(row, COLS.requestDate), dateOrder);
    const createdAt = requestDate ? zonedWallTimeToUtc(requestDate, '09:00:00').toISOString() : now.toISOString();
    const due = parseDate(get(row, COLS.due), dateOrder);
    const hours = parseHours(get(row, COLS.estimate));

    const ticket = clean(get(row, COLS.ticket));
    const notes = [
      ticket ? `Atendimento nº ${ticket}` : '',
      clean(get(row, COLS.notes)),
      clean(get(row, COLS.extra1)),
      clean(get(row, COLS.extra2)),
    ]
      .filter(Boolean)
      .join('\n');

    if (!opts.dryRun) {
      const id = Number(
        insertTask.run(
          title, description, notes || null, sector.id, admin.id, assignee.id, status.id, hours, due, admin.id,
          createdAt, now.toISOString(),
        ).lastInsertRowid,
      );
      insertHistory.run(id, null, status.id, admin.id, createdAt);
    }
    existingTitles.add(norm(title));
    report.created.push({ line, title, status: status.name, sector: sector.name, assignee: assignee.name });
  });

  return report;
}

// ---------------- Linha de comando ----------------

function printReport(r: ImportReport, dryRun: boolean) {
  console.log(`\nArquivo: codificação ${r.encoding}, datas ${r.dateOrder === 'mdy' ? 'mês/dia/ano' : 'dia/mês/ano'}, ${r.rows} linhas.`);
  console.log(`\n${dryRun ? 'SERIAM CRIADAS' : 'CRIADAS'}: ${r.created.length} tarefa(s)`);
  for (const c of r.created) console.log(`  linha ${String(c.line).padStart(3)}  ${c.title}  [${c.status} · ${c.sector} · ${c.assignee}]`);
  if (r.skipped.length) {
    console.log(`\nIGNORADAS: ${r.skipped.length}`);
    for (const s of r.skipped) console.log(`  linha ${String(s.line).padStart(3)}  ${s.title} — ${s.reason}`);
  }
  if (r.createdSectors.length) console.log(`\nSetores ${dryRun ? 'a criar' : 'criados'}: ${r.createdSectors.join(', ')}`);
  if (r.createdUsers.length) console.log(`Usuários ${dryRun ? 'a criar' : 'criados'}: ${r.createdUsers.join(', ')}`);
  if (r.warnings.length) {
    console.log('\nAvisos:');
    for (const w of r.warnings) console.log(`  - ${w}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--simular');
  const fileArg = args.find((a) => !a.startsWith('--'));
  if (!fileArg) {
    console.error('Informe o arquivo: npm run importar -- caminho\\planilha.csv [--simular]');
    process.exit(1);
  }
  // npm executa o script dentro de server/; INIT_CWD é a pasta onde o comando foi digitado.
  const file = path.resolve(process.env.INIT_CWD ?? process.cwd(), fileArg);
  if (!fs.existsSync(file)) {
    console.error(`Arquivo não encontrado: ${file}`);
    process.exit(1);
  }
  const db = openDatabase();
  migrate(db);
  try {
    if (!dryRun) {
      const dir = path.join(path.dirname(config.dbPath), 'backups');
      fs.mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
      const backup = path.join(dir, `app-antes-importacao-${stamp}.db`);
      db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
      console.log(`Cópia de segurança do banco: ${backup}`);
    }
    const report = db.transaction(() => importCsv(db, fs.readFileSync(file), { dryRun }))();
    printReport(report, dryRun);
    console.log(dryRun ? '\nSimulação: nada foi gravado. Rode sem --simular para importar.' : '\nImportação concluída.');
  } catch (err) {
    console.error(`\nERRO: ${(err as Error).message}\nNada foi gravado.`);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}
