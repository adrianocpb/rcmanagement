/**
 * Servidor MCP (Model Context Protocol) em /mcp: permite conectar o sistema ao Claude como conector
 * personalizado. O Claude lê épicos, outcomes e tarefas, procura duplicados e cria/edita itens.
 *
 *  - Autenticação: "Authorization: Bearer <token>" (tokens em Administração → Integrações). As ações
 *    ficam registradas em nome do usuário dono do token.
 *  - Sem estado (stateless): cada requisição HTTP cria um servidor e um transporte novos.
 *  - Ferramentas de escrita são marcadas como tal (readOnlyHint: false), para o Claude pedir
 *    aprovação antes de chamá-las. Não há ferramenta de exclusão.
 *  - As regras são as mesmas da interface: as ferramentas chamam os mesmos serviços.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Request, Response } from 'express';
import { z, ZodError } from 'zod';
import type { DB } from '../db/connection.js';
import type { AuthUser } from '../lib/auth.js';
import { setFlag } from '../lib/flags.js';
import { HttpError, notFound } from '../lib/http.js';
import { nowIso } from '../lib/time.js';
import { OUTCOME_COLORS } from '../lib/colors.js';
import { createEpic, getEpic, listEpics, updateEpic } from './epics.js';
import { listTags } from './tags.js';
import { userFromToken } from './integrations.js';
import { createOutcome, getOutcome, listOutcomes, updateOutcome } from './outcomes.js';
import { createTask, getTask, listTasks, updateTask } from './tasks/service.js';

const INSTRUCTIONS = `Sistema "Gestão de Melhorias" (RC+): épicos (estratégicos, ligados a um OKR) → outcomes
(resultados de negócio com indicador baseline → atual → meta) → tarefas (entregas). Todos usam as mesmas
colunas (status) do quadro Kanban.
Boas práticas:
1. Chame "contexto" para conhecer status, setores e pessoas (ids) antes de criar ou editar.
2. Antes de criar qualquer item, use "buscar" para verificar se já existe algo igual ou parecido.
3. Ligue cada outcome ao épico certo e cada tarefa ao outcome certo (a tarefa herda o épico do outcome).
4. Antes de chamar uma ferramenta que grava (criar_*, atualizar_*, flag), mostre ao usuário exatamente o que
   será gravado e espere a confirmação dele.`;

// ---------------- Formatação compacta das respostas ----------------

type Row = Record<string, unknown>;

const epicSummary = (e: Row) => ({
  id: e.id,
  nome: e.name,
  okr: e.okr,
  status: e.status_name,
  responsavel: e.owner_name,
  outcomes: e.outcomes_count,
  tarefas_concluidas: `${e.tasks_done}/${e.tasks_count}`,
  ativo: !!e.active,
});

const outcomeSummary = (o: Row) => ({
  id: o.id,
  nome: o.name,
  epico: { id: o.epic_id, nome: o.epic_name },
  status: o.status_name,
  responsavel: o.owner_name,
  indicador: o.indicator_name
    ? { nome: o.indicator_name, unidade: o.indicator_unit, baseline: o.baseline_value, atual: o.current_value, meta: o.target_value }
    : null,
  tarefas_concluidas: `${o.tasks_done}/${o.tasks_count}`,
  ice_score: o.ice_score,
  flag: o.flagged_at ? { desde: o.flagged_at, motivo: o.flag_reason } : null,
  ativo: !!o.active,
});

const taskSummary = (t: Row) => ({
  id: t.id,
  titulo: t.title,
  status: t.status_name,
  prioridade: t.priority,
  responsavel: t.assignee_name,
  solicitante: t.requester_name,
  setor: t.sector_name,
  epico: t.epic_id && t.epic_name ? { id: t.epic_id, nome: t.epic_name } : null,
  outcome: t.outcome_id && t.outcome_name ? { id: t.outcome_id, nome: t.outcome_name } : null,
  tags: ((t.tags as { name: string }[] | undefined) ?? []).map((g) => g.name),
  conclusao_prevista: t.planned_end_date,
  atrasada: !!t.is_overdue,
  flag: t.flagged_at ? { desde: t.flagged_at, motivo: t.flag_reason } : null,
});

// ---------------- Busca por semelhança (evitar duplicados) ----------------

const norm = (s: unknown) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
const STOP = new Set(['para', 'com', 'dos', 'das', 'uma', 'por', 'que', 'nos', 'nas', 'aos', 'mais', 'entre', 'sobre']);
const words = (s: string) => [...new Set(norm(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w)))];

/** Pontua cada item pela proporção de palavras do texto buscado que aparecem nele (título pesa mais). */
function rank<T>(items: T[], query: string, title: (i: T) => unknown, body: (i: T) => unknown[]) {
  const q = words(query);
  if (!q.length) return [];
  return items
    .map((i) => {
      const t = norm(title(i));
      const b = norm(body(i).join(' '));
      const score = q.reduce((s, w) => s + (t.includes(w) ? 1 : b.includes(w) ? 0.5 : 0), 0) / q.length;
      return { i, score: Math.round(score * 100) / 100 };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
}

// ---------------- Esquemas de entrada ----------------

const id = z.number().int().positive();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data no formato AAAA-MM-DD');
const text = (max = 5000) => z.string().max(max);
const ice = z.number().int().min(1).max(10);
const priority = z.enum(['baixa', 'media', 'alta', 'urgente']);

const epicFields = {
  description: text().nullable().optional().describe('Descrição'),
  okr: text(500).nullable().optional().describe('Objetivo/OKR relacionado (texto)'),
  owner_id: id.nullable().optional().describe('Responsável (id de pessoa, ver "contexto")'),
  status_id: id.optional().describe('Coluna do quadro (id de status, ver "contexto"). Vazio = status padrão'),
  start_date: date.nullable().optional(),
  end_date: date.nullable().optional(),
};

const outcomeFields = {
  description: text().nullable().optional(),
  owner_id: id.nullable().optional().describe('Responsável (id de pessoa)'),
  status_id: id.optional().describe('Coluna do quadro (id de status). Vazio = status padrão'),
  start_date: date.nullable().optional(),
  target_date: date.nullable().optional().describe('Data alvo'),
  indicator_name: text(200).nullable().optional().describe('Nome do indicador de negócio (ex.: "Tempo médio de atendimento")'),
  indicator_unit: text(40).nullable().optional().describe('Unidade (ex.: horas, %, R$)'),
  baseline_value: z.number().nullable().optional().describe('Valor de partida do indicador'),
  current_value: z.number().nullable().optional().describe('Valor atual do indicador'),
  target_value: z.number().nullable().optional().describe('Meta do indicador'),
  ice_impact: ice.nullable().optional().describe('ICE: impacto (1–10)'),
  ice_confidence: ice.nullable().optional().describe('ICE: confiança (1–10)'),
  ice_ease: ice.nullable().optional().describe('ICE: facilidade (1–10)'),
  color: z.enum(OUTCOME_COLORS).optional().describe('Cor da tag do outcome. Vazio = automática'),
};

const taskFields = {
  description: text().nullable().optional(),
  notes: text().nullable().optional().describe('Observações'),
  outcome_id: id.nullable().optional().describe('Outcome ao qual a tarefa contribui (a tarefa herda o épico dele)'),
  epic_id: id.nullable().optional().describe('Épico, quando a tarefa não tem outcome'),
  status_id: id.optional().describe('Coluna do quadro (id de status). Vazio = status padrão'),
  priority: priority.optional().describe('Prioridade (padrão: media)'),
  estimated_hours: z.number().min(0).nullable().optional().describe('Tempo estimado, em horas'),
  planned_start_date: date.nullable().optional(),
  planned_end_date: date.nullable().optional().describe('Conclusão prevista (prazo)'),
  tags: z
    .array(z.string().min(1).max(40))
    .max(10)
    .optional()
    .describe('Nomes das tags (ex.: fornecedor "Kynera"). Substitui as tags atuais; tags novas são criadas. Prefira as existentes (ver "contexto")'),
};

/** Remove chaves não enviadas (undefined), para que só o informado seja alterado. */
const sent = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

// ---------------- Servidor ----------------

const READ = { readOnlyHint: true, openWorldHint: false } as const;
const CREATE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const UPDATE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } as const;

function ok(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

/** Executa a ferramenta e transforma erros de validação/negócio em mensagens legíveis. */
function run(fn: () => unknown): CallToolResult {
  try {
    return ok(fn());
  } catch (err) {
    let message = 'Erro interno.';
    if (err instanceof ZodError) {
      const first = err.issues[0];
      const field = first?.path.join('.');
      message = field ? `Campo "${field}": ${first.message}` : (first?.message ?? 'Dados inválidos.');
    } else if (err instanceof HttpError) {
      message = err.message;
    } else if (/(FOREIGN KEY|CHECK|NOT NULL) constraint failed/.test((err as Error)?.message ?? '')) {
      message = 'Referência inválida (confira os ids informados).';
    } else {
      console.error('[mcp]', err);
    }
    return { isError: true, content: [{ type: 'text', text: message }] };
  }
}

function pickCurrent(db: DB, table: 'epics' | 'outcomes', itemId: number, fields: string[]) {
  const cur = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND deleted_at IS NULL`).get(itemId) as Row | undefined;
  if (!cur) throw notFound(table === 'epics' ? 'Épico' : 'Outcome');
  return Object.fromEntries(fields.map((f) => [f, cur[f]]));
}

export function buildMcpServer(db: DB, user: AuthUser) {
  const server = new McpServer({ name: 'gestao-de-melhorias', version: '1.0.0' }, { instructions: INSTRUCTIONS });

  // ---------- Leitura ----------

  server.registerTool(
    'contexto',
    {
      title: 'Contexto do sistema',
      description:
        'Status (colunas do quadro), setores e pessoas da equipe, com ids. Chame antes de criar ou editar itens.',
      annotations: READ,
    },
    () =>
      run(() => ({
        voce_esta_agindo_como: { id: user.id, nome: user.name, perfil: user.role },
        status: db
          .prepare('SELECT id, name AS nome, is_default AS padrao, is_completion_status AS conclusao, is_cancel_status AS encerra_sem_entrega FROM statuses WHERE active = 1 ORDER BY position')
          .all(),
        setores: db.prepare('SELECT id, name AS nome FROM sectors WHERE active = 1 ORDER BY name').all(),
        pessoas: db
          .prepare("SELECT id, name AS nome, role AS perfil FROM users WHERE active = 1 AND role <> 'requester' ORDER BY name")
          .all(),
        solicitantes: db.prepare("SELECT id, name AS nome FROM users WHERE active = 1 AND role = 'requester' ORDER BY name").all(),
        prioridades: ['baixa', 'media', 'alta', 'urgente'],
        cores_de_outcome: OUTCOME_COLORS,
        tags: (listTags(db) as { name: string; tasks_count: number }[]).map((g) => ({ nome: g.name, tarefas: g.tasks_count })),
      })),
  );

  server.registerTool(
    'listar_epicos',
    { title: 'Listar épicos', description: 'Lista os épicos (fora da lixeira).', inputSchema: { incluir_inativos: z.boolean().optional() }, annotations: READ },
    ({ incluir_inativos }) => run(() => listEpics(db, !!incluir_inativos).map(epicSummary)),
  );

  server.registerTool(
    'listar_outcomes',
    {
      title: 'Listar outcomes',
      description: 'Lista os outcomes, opcionalmente de um épico.',
      inputSchema: { epic_id: id.optional().describe('Somente deste épico'), incluir_inativos: z.boolean().optional() },
      annotations: READ,
    },
    ({ epic_id, incluir_inativos }) =>
      run(() => listOutcomes(db, { epicId: epic_id, includeInactive: !!incluir_inativos }).map(outcomeSummary)),
  );

  server.registerTool(
    'listar_tarefas',
    {
      title: 'Listar tarefas',
      description: 'Lista tarefas com filtros. Retorna no máximo "limite" itens (padrão 100).',
      inputSchema: {
        epic_id: id.optional(),
        outcome_id: id.optional(),
        status_id: id.optional(),
        responsavel_id: id.optional(),
        texto: z.string().max(200).optional().describe('Parte do título ou da descrição'),
        somente_com_flag: z.boolean().optional(),
        somente_atrasadas: z.boolean().optional(),
        tag: z.string().max(40).optional().describe('Somente tarefas com esta tag (nome)'),
        limite: z.number().int().min(1).max(500).optional(),
      },
      annotations: READ,
    },
    (a) =>
      run(() => {
        const tagId = a.tag ? (db.prepare('SELECT id FROM tags WHERE name = ?').get(a.tag.trim()) as { id: number } | undefined)?.id : undefined;
        if (a.tag && !tagId) return { total: 0, exibidas: 0, tarefas: [], aviso: `Não existe a tag "${a.tag}".` };
        const all = listTasks(db, {
          tag_id: tagId,
          epic_id: a.epic_id,
          outcome_id: a.outcome_id,
          status_id: a.status_id,
          assignee_id: a.responsavel_id,
          q: a.texto,
          flagged: a.somente_com_flag,
          overdue: a.somente_atrasadas,
        });
        const limit = a.limite ?? 100;
        return { total: all.length, exibidas: Math.min(all.length, limit), tarefas: all.slice(0, limit).map(taskSummary) };
      }),
  );

  server.registerTool(
    'buscar',
    {
      title: 'Buscar itens parecidos',
      description:
        'Procura épicos, outcomes e tarefas parecidos com um texto (ignora acentos e maiúsculas), do mais parecido para o menos. Use antes de criar para evitar duplicados.',
      inputSchema: {
        texto: z.string().min(2).max(300),
        tipos: z.array(z.enum(['epico', 'outcome', 'tarefa'])).optional().describe('Padrão: todos'),
      },
      annotations: READ,
    },
    ({ texto, tipos }) =>
      run(() => {
        const want = (t: string) => !tipos?.length || tipos.includes(t as 'epico');
        const top = 10;
        return {
          epicos: want('epico')
            ? rank(listEpics(db, true), texto, (e) => e.name, (e) => [e.description, e.okr])
                .slice(0, top)
                .map((x) => ({ semelhanca: x.score, ...epicSummary(x.i) }))
            : undefined,
          outcomes: want('outcome')
            ? rank(listOutcomes(db, { includeInactive: true }), texto, (o) => o.name, (o) => [o.description, o.indicator_name])
                .slice(0, top)
                .map((x) => ({ semelhanca: x.score, ...outcomeSummary(x.i) }))
            : undefined,
          tarefas: want('tarefa')
            ? rank(listTasks(db, {}) as Row[], texto, (t) => t.title, (t) => [t.description, t.notes])
                .slice(0, top)
                .map((x) => ({ semelhanca: x.score, ...taskSummary(x.i) }))
            : undefined,
        };
      }),
  );

  server.registerTool(
    'detalhe',
    {
      title: 'Detalhe de um item',
      description: 'Todos os campos de um épico, outcome ou tarefa (inclui histórico de status e de flags da tarefa).',
      inputSchema: { tipo: z.enum(['epico', 'outcome', 'tarefa']), id },
      annotations: READ,
    },
    ({ tipo, id: itemId }) =>
      run(() => (tipo === 'epico' ? getEpic(db, itemId) : tipo === 'outcome' ? getOutcome(db, itemId) : getTask(db, itemId))),
  );

  // ---------- Escrita ----------

  server.registerTool(
    'criar_epico',
    {
      title: 'Criar épico',
      description: 'Cria um épico. Antes, busque duplicados e confirme com o usuário.',
      inputSchema: { name: text(200).min(1).describe('Nome do épico'), ...epicFields },
      annotations: CREATE,
    },
    (a) => run(() => epicSummary(createEpic(db, sent(a)))),
  );

  server.registerTool(
    'criar_outcome',
    {
      title: 'Criar outcome',
      description: 'Cria um outcome dentro de um épico. Antes, busque duplicados e confirme com o usuário.',
      inputSchema: { epic_id: id.describe('Épico ao qual o outcome pertence'), name: text(200).min(1).describe('Nome do outcome'), ...outcomeFields },
      annotations: CREATE,
    },
    (a) => run(() => outcomeSummary(createOutcome(db, sent(a)))),
  );

  server.registerTool(
    'criar_tarefa',
    {
      title: 'Criar tarefa',
      description: 'Cria uma tarefa. Antes, busque duplicados e confirme com o usuário.',
      inputSchema: {
        title: text(200).min(1).describe('Título da tarefa'),
        sector_id: id.describe('Setor (ver "contexto")'),
        requester_id: id.describe('Quem pediu (id de pessoa ou solicitante)'),
        assignee_id: id.describe('Responsável pela execução (id de pessoa)'),
        ...taskFields,
      },
      annotations: CREATE,
    },
    (a) => run(() => taskSummary(createTask(db, sent(a), user.id) as Row)),
  );

  const EPIC_KEYS = ['name', 'description', 'okr', 'owner_id', 'status_id', 'start_date', 'end_date', 'active'];
  server.registerTool(
    'atualizar_epico',
    {
      title: 'Editar épico',
      description: 'Altera só os campos informados de um épico. Confirme com o usuário antes.',
      inputSchema: { id, name: text(200).min(1).optional(), ...epicFields, active: z.boolean().optional().describe('false = inativar') },
      annotations: UPDATE,
    },
    ({ id: itemId, ...changes }) =>
      run(() => epicSummary(updateEpic(db, itemId, { ...pickCurrent(db, 'epics', itemId, EPIC_KEYS), ...sent(changes) }))),
  );

  const OUTCOME_KEYS = [
    'epic_id', 'name', 'description', 'owner_id', 'status_id', 'start_date', 'target_date', 'indicator_name', 'indicator_unit',
    'baseline_value', 'target_value', 'current_value', 'ice_impact', 'ice_confidence', 'ice_ease', 'active',
  ];
  server.registerTool(
    'atualizar_outcome',
    {
      title: 'Editar outcome',
      description:
        'Altera só os campos informados de um outcome (ex.: valor atual do indicador, status, épico). Confirme com o usuário antes.',
      inputSchema: {
        id,
        epic_id: id.optional().describe('Mover para outro épico (as tarefas acompanham)'),
        name: text(200).min(1).optional(),
        ...outcomeFields,
        active: z.boolean().optional().describe('false = inativar'),
      },
      annotations: UPDATE,
    },
    ({ id: itemId, ...changes }) =>
      run(() => outcomeSummary(updateOutcome(db, itemId, { ...pickCurrent(db, 'outcomes', itemId, OUTCOME_KEYS), ...sent(changes) }))),
  );

  server.registerTool(
    'atualizar_tarefa',
    {
      title: 'Editar tarefa',
      description:
        'Altera só os campos informados de uma tarefa. Mudar o status segue as regras do quadro (datas reais e histórico). Confirme com o usuário antes.',
      inputSchema: {
        id,
        title: text(200).min(1).optional(),
        sector_id: id.optional(),
        requester_id: id.optional(),
        assignee_id: id.optional(),
        ...taskFields,
      },
      annotations: UPDATE,
    },
    ({ id: itemId, ...changes }) => run(() => taskSummary(updateTask(db, itemId, sent(changes), user.id) as Row)),
  );

  server.registerTool(
    'flag',
    {
      title: 'Colocar ou retirar flag',
      description:
        'Flag = bloqueio: o item depende de algo externo (ex.: o negócio liberar um acesso). Colocar e retirar ficam no histórico. Confirme com o usuário antes.',
      inputSchema: {
        tipo: z.enum(['tarefa', 'outcome']),
        id,
        com_flag: z.boolean().describe('true = colocar a flag; false = retirar'),
        motivo: z.string().max(500).optional().describe('Ao colocar: o motivo do bloqueio. Ao retirar: como foi resolvido'),
      },
      annotations: UPDATE,
    },
    ({ tipo, id: itemId, com_flag, motivo }) =>
      run(() => {
        setFlag(db, tipo === 'tarefa' ? 'task' : 'outcome', itemId, { flagged: com_flag, note: motivo }, user.id, nowIso());
        return tipo === 'tarefa' ? taskSummary(getTask(db, itemId) as Row) : outcomeSummary(getOutcome(db, itemId));
      }),
  );

  return server;
}

/** Rota POST /mcp (Streamable HTTP, sem sessão). */
export function mcpHandler(db: DB) {
  return async (req: Request, res: Response) => {
    const user = userFromToken(db, req.headers.authorization);
    if (!user) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      res.status(401).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Token ausente, inválido ou revogado (Administração → Integrações).' },
        id: null,
      });
      return;
    }
    const server = buildMcpServer(db, user);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  };
}

/** GET/DELETE /mcp: sem sessões neste servidor. */
export function mcpMethodNotAllowed(_req: Request, res: Response) {
  res.status(405).setHeader('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Use POST.' }, id: null });
}
