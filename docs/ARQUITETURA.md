# Arquitetura — Sistema de Acompanhamento de Entregas (MVP)

## 1. Stack escolhida

| Camada | Tecnologia | Por quê |
|---|---|---|
| Backend | **Node.js + Express 5 + TypeScript** | Simples, conhecido, sem framework pesado. |
| Banco | **SQLite** embutido no Node (`node:sqlite`) | Arquivo único, zero infraestrutura, backup = copiar o arquivo. Sem dependência nativa: instala em qualquer máquina sem compilar. Suficiente para uma equipe interna. Trocar por PostgreSQL no futuro exige apenas adaptar a camada de acesso (SQL padrão). |
| Validação | **Zod** | Validação declarativa de entrada em um só lugar. |
| Frontend | **React 19 + Vite + TypeScript + Tailwind CSS 4** | Interface moderna, build rápido, sem CSS customizado complexo. |
| Dados no front | **TanStack Query** | Cache, recarregamento e atualização otimista (Kanban) com pouco código. |
| Kanban | **dnd-kit** | Arrastar-e-soltar acessível e leve. |
| Gráficos | **Recharts** | Gráficos declarativos em React. |
| Testes | **Vitest + Supertest** | Testes de regras puras e de API com banco em memória. |

**Deploy:** um único processo Node. Em produção o servidor Express entrega o frontend compilado
(`client/dist`) e a API (`/api`). Não há Redis, fila, container obrigatório ou serviço externo.

## 2. Arquitetura

```
Navegador (React SPA)
   │  fetch /api/* (cookie de sessão httpOnly)
   ▼
Express ──► módulos (rotas + validação Zod)
   │            ├─ tasks/      service.ts (regras + SQL) · rules.ts (regras puras)
   │            ├─ dashboard/  metrics.ts (cálculo puro dos indicadores)
   │            └─ users, sectors, statuses, epics, outcomes, auth
   ▼
SQLite (data/app.db) — migrations versionadas em server/src/db/migrations.ts
```

Princípios:

- **Regras de negócio em funções puras** (`tasks/rules.ts`, `dashboard/metrics.ts`) — testáveis sem banco
  e reutilizáveis quando surgirem automações/integrações.
- **Um módulo por entidade**; novas funcionalidades (comentários, anexos, integrações) entram como
  novos módulos + novas migrations, sem alterar os existentes.
- **Configuração centralizada** em `server/src/config.ts` (porta, banco, fuso horário, sessão).

## 3. Modelo de dados

Todas as tabelas têm PK `id INTEGER AUTOINCREMENT` e `created_at`/`updated_at` (instantes UTC ISO 8601).

| Tabela | Campos principais | Observações |
|---|---|---|
| `users` | name, email (único, case-insensitive), password_hash, role (`admin`/`user`), active | Desativar encerra as sessões do usuário. |
| `sessions` | token (PK), user_id → users, expires_at | Sessão simples por cookie httpOnly. |
| `sectors` | name (único), active | Lista plana, sem hierarquia. |
| `statuses` | name, color, position, **is_default**, **is_start_status**, **is_completion_status**, **counts_in_wip**, **is_cancel_status**, active | `position` = ordem das colunas. Só um `is_default`. |
| `epics` | name, description, okr (texto), owner_id → users, **status_id → statuses**, board_position, start_date, end_date, active | Mesmas colunas das tarefas (migration `012`). A coluna antiga `status` (planejado/em andamento/...) não é mais usada. |
| `outcomes` | **epic_id → epics (obrigatório)**, name, description, owner_id, **status_id → statuses**, board_position, color, start_date, target_date, indicator_name, indicator_unit, baseline_value, target_value, current_value, ice_impact, ice_confidence, ice_ease, ice_score, active | Indicador principal embutido (1:1) — sem tabela extra. |
| `tasks` | title, description, notes, **sector_id**, **requester_id**, **assignee_id**, epic_id?, outcome_id?, **status_id**, priority, estimated_hours?, planned_start_date?, planned_end_date?, board_position, started_at?, completed_at?, created_by, created_at, deleted_at? | `deleted_at` = exclusão lógica. |
| `task_status_history` | task_id → tasks, from_status_id? (NULL = criação), to_status_id, changed_by → users, changed_at | Base para análises futuras de gargalo e tempo por etapa. |

Índices: em todas as FKs de `tasks` (status, responsável, solicitante, setor, épico, outcome), em
`created_at`, `completed_at`, `planned_end_date`, em `outcomes.epic_id` e em
`task_status_history(task_id, changed_at)` / `(to_status_id, changed_at)`.

Relacionamento: **Épico 1—N Outcome 1—N Tarefa**. Uma tarefa pode não ter outcome nem épico. Se a
tarefa tem outcome, o épico é sempre o do outcome (o servidor garante isso, inclusive quando um
outcome muda de épico). Uma tarefa pode estar ligada diretamente a um épico sem outcome.

## 4. Telas

| Rota | Tela |
|---|---|
| `/` | **Tarefas** — alternância **Kanban \| Lista**, filtros combináveis, botão **+ Nova tarefa**. |
| `?task=ID` | Modal de detalhe da tarefa (Informações, Relacionamentos, Pessoas, Planejamento, Execução, Histórico) com edição, troca rápida de status e exclusão. |
| `/dashboard` | Cards (Cycle Time, Lead Time, Throughput, Criadas, WIP, Atrasadas) + 4 gráficos, com filtros. |
| `/epicos`, `/epicos/:id` | Cards com OKR, responsável, status, nº de outcomes/tarefas e progresso; detalhe com outcomes. |
| `/outcomes`, `/outcomes/:id` | Cards com indicador Atual → Meta e Resultado (no banco: baseline_value, target_value, current_value); detalhe com tarefas relacionadas. |
| `/admin` | Status (criar, editar, ordenar, ativar/desativar, padrão/início/conclusão), Usuários e Setores. |

## 5. Regras de negócio

- **Data de criação:** gravada automaticamente; não é aceita em criação/edição.
- **Início real:** ao entrar em um status com `is_start_status`, preenche `started_at` **se vazio**.
  Sair do status nunca apaga a data; voltar ao backlog e retornar mantém a primeira data.
- **Conclusão real:** ao entrar em um status com `is_completion_status`, preenche `completed_at`
  **se vazio** (nunca sobrescreve automaticamente).
- **Ajuste manual:** no formulário de edição as datas reais podem ser corrigidas; a correção só é
  aplicada quando o valor enviado difere do gravado (não interfere nas regras automáticas).
- **As regras usam apenas as flags do status**, nunca o nome — renomear "Em desenvolvimento" para
  "Desenvolvendo" não altera nada (coberto por teste).
- **Tarefa concluída** = status atual com `is_completion_status = 1`.
- **Atraso:** não concluída + tem prazo + hoje (no fuso da aplicação) > prazo.
  Concluída: `data local de completed_at > prazo` → *Concluída com atraso*; senão *Concluída no prazo*.
- **Histórico:** criação e toda mudança de status (Kanban, modal ou edição) geram um registro.
- **Status inicial:** o formulário sugere o status marcado como padrão; o usuário pode escolher outro.
- **Status:** não é possível desativar um status que ainda tem tarefas, nem o status padrão.
- **Encerra sem entrega (ex.: Cancelado):** marcação de status (`is_cancel_status`), exclusiva com
  "Conclusão". Tarefa nesse status é tratada como encerrada sem entrega: nunca fica atrasada
  (situação "Cancelada"), sai do WIP, do Aging e do filtro "somente atrasadas", não conta no
  Throughput/Cycle Time/Lead Time, não entra no tempo por coluna e não entra no total do progresso
  de épicos e outcomes. Continua contando em "Tarefas criadas" e na distribuição por status.
- **Priorização ICE (outcomes):** Impacto, Confiança e Facilidade são opcionais, inteiros de
  1 a 10 (validados na API e por `CHECK` no banco). `ice_score = impacto × confiança × facilidade`
  (1 a 1000) é uma **coluna gerada pelo banco** — nunca é gravada pelo usuário e não fica inconsistente;
  fica vazia enquanto faltar algum fator. Ordenação na tela de Outcomes, do maior para o menor.
  (Tarefas não têm ICE desde a migration `008`.)
- **Comentários (tarefas):** tabelas `task_comments` (autor, texto) e `task_comment_files` (renomeada
  de `task_comment_images` na migration `010`); anexos dos mesmos tipos das solicitações
  (`server/src/lib/files.ts`: imagens, PDF, Office, CSV, TXT, vídeos — sem SVG/HTML), até 5 por
  comentário e 10 MB no total, gravados em `UPLOADS_DIR/tasks/<id>/` e servidos só para a equipe
  (`nosniff`, CSP restritiva; imagens/PDF/vídeos abrem no navegador, o resto é baixado). Links são
  reconhecidos no frontend (só http/https). Excluir o comentário apaga os anexos; esvaziar a lixeira
  apaga a pasta da tarefa.
- **Ordem do quadro (tarefas):** `board_position` (número real) define a ordem dentro de cada coluna;
  menor fica mais acima. `PATCH /api/tasks/:id/position` com `{status_id, before_id}` coloca a tarefa
  antes de `before_id` (ou no fim, se vazio), usando o ponto médio entre as vizinhas e renumerando a
  coluna quando não sobra espaço. Mudar de coluna por ali aplica as mesmas regras de status
  (datas reais e histórico). Tarefa nova, ou que muda de status pelo detalhe, entra no fim da coluna.
- **Quadro de épicos e outcomes:** usam os mesmos status das tarefas e a mesma lógica de posição
  (`server/src/lib/board.ts`; `PATCH /api/epics/:id/position` e `/api/outcomes/:id/position`), sem
  histórico de status. Item novo sem status vai para o status padrão. Na migration `012`, os itens
  existentes foram para a coluna equivalente ao status antigo (concluído → status de conclusão,
  cancelado → "encerra sem entrega", em andamento → primeiro status de início, planejado → padrão).
  Um status não pode ser desativado enquanto houver tarefas, outcomes ou épicos ativos nele.
  No frontend, `components/Board.tsx` (quadro genérico) e `components/DataTable.tsx` (lista) servem
  aos três níveis.
- **Lixeira:** excluir uma tarefa a move para a lixeira (`deleted_at`, `deleted_by`); ela some das listas,
  do Kanban e dos indicadores. Somente administradores movem para a lixeira; a equipe pode restaurar. Após `TRASH_DAYS` (30) dias a tarefa e
  seu histórico são removidos definitivamente — na subida do servidor, a cada 6 horas e ao abrir a
  lixeira. Esvaziar a lixeira ou excluir um item definitivamente: somente administradores.
- **Lixeira de outcomes e épicos** (migration `013`, `server/src/modules/trash.ts`, rotas `/api/trash`):
  mesma regra das tarefas. Excluir um épico leva junto os outcomes dele (mesmo `deleted_at`), e
  restaurar o épico os traz de volta; um outcome cujo épico está na lixeira só volta com o épico. As
  tarefas nunca vão junto: enquanto o épico/outcome está na lixeira, elas só deixam de mostrá-lo; na
  exclusão definitiva o vínculo (`epic_id`/`outcome_id`) é removido.
- **Horizontes** (migration `016`, `server/src/lib/horizons.ts`): coluna `horizon` (`H1`, `H2`, `H3` ou
  nulo) em `epics` e `outcomes`. Na edição, não enviar mantém; enviar vazio limpa. Filtro `horizon`
  nas tarefas (horizonte herdado: `COALESCE(horizonte do outcome, horizonte do épico)`), no dashboard
  de tarefas e no de outcomes.
- **Tags das tarefas** (migration `015`, `server/src/modules/tags.ts`): `tags` (nome único sem
  diferenciar maiúsculas, cor da paleta) e `task_tags`. As tarefas recebem `tags` como lista de nomes
  (até 10; nomes novos criam a tag; enviar a lista substitui as tags, não enviar mantém). Filtro
  `tag_id` na lista de tarefas e no dashboard; o dashboard traz `by_tag` (abertas agora × concluídas
  no período). Renomear/cor/excluir: administradores (`/api/tags`).
- **Conector MCP** (`server/src/modules/mcp.ts`, `POST /mcp`, Streamable HTTP sem sessão, SDK
  `@modelcontextprotocol/sdk`): autenticado por `Authorization: Bearer <token>`; os tokens
  (`api_tokens`, migration `014`, só o hash SHA-256 é guardado) são criados e revogados por
  administradores em `/api/integrations/tokens` e agem em nome de um usuário da equipe. As
  ferramentas chamam os mesmos serviços da API (validações, histórico, quadro); as de escrita têm
  `readOnlyHint: false` para o cliente pedir aprovação; não há ferramenta de exclusão.
- **Flag (bloqueio):** `flagged_at`, `flag_reason`, `flagged_by` em `tasks` e `outcomes`; cada colocar/
  retirar grava `flag_events` (entity_type, entity_id, action add/remove, note, user, data), que
  aparece no histórico. `PUT /api/tasks/:id/flag` e `/api/outcomes/:id/flag` com `{flagged, note}`.
  Indicador **Tempo médio com flag** (dashboard): cada colocar → retirar é um período; flag ativa
  conta até agora; entram os períodos que tocam o intervalo filtrado (`computeFlagTime`).
- **Permissões (perfis):** `admin` — tudo, inclusive aprovações, lixeira e administração; `user`
  (equipe) — cria e edita tarefas, épicos e outcomes e envia solicitações, sem excluir;
  `requester` (Solicitante) — somente `/api/requests` (as próprias) e `/api/sectors`. As rotas da
  equipe usam o middleware `requireTeam`. Usuários têm um setor opcional (`users.sector_id`).
- **Solicitações de melhoria** (`server/src/modules/requests/`): tabelas `requests` e
  `request_attachments`. Situações: `aguardando` → `info` (pedido de complemento; ao editar volta a
  `aguardando`) → `aprovada` ou `recusada` (motivo obrigatório). Só administradores decidem. A
  aprovação cria, na mesma transação, uma Tarefa, Outcome ou Épico (reaproveitando `createTask`,
  `createOutcome`, `createEpic`) e grava `converted_type`/`converted_id`; o detalhe do item traz
  `origin_request`. Anexos: até 5 por solicitação e 10 MB no total, tipos em lista permitida
  (imagens, PDF, Office, CSV/TXT, MP4/WEBM/MOV — sem SVG/HTML), gravados em `UPLOADS_DIR/<id>/` com
  nome aleatório e servidos com verificação de acesso, `nosniff` e CSP restritiva.

## 6. Indicadores (fórmulas implementadas em `server/src/modules/dashboard/metrics.ts`)

Período = `[de, até]` em datas locais (fuso da aplicação), inclusivo. Filtros de responsável, setor,
épico e outcome restringem o conjunto de tarefas antes do cálculo.

| Indicador | Fórmula | Considera o período? |
|---|---|---|
| **Cycle Time** | `completed_at − started_at` (dias) para tarefas concluídas com `completed_at` no período. **Tarefas sem `started_at` ficam fora.** Média e mediana. | Sim |
| **Lead Time** | `completed_at − created_at` (dias) para tarefas concluídas no período. Média e mediana. | Sim |
| **Throughput** | Nº de tarefas concluídas cujo `completed_at` está no período (como `completed_at` nunca é sobrescrito, equivale à primeira entrada em status de conclusão). Também exibido como média por semana. | Sim |
| **Tarefas criadas** | Nº de tarefas com `created_at` no período. | Sim |
| **Atrasadas** | Não concluídas, com prazo, hoje > prazo. | Não (retrato atual) |
| **WIP** | Nº de tarefas não concluídas em status marcados como **"Conta no WIP"** (por padrão todos, exceto o Backlog/status padrão e os de conclusão). Configurável em Administração → Status, sem depender do nome. | Não |
| **Tempo em cada coluna** | Pelo histórico de status: tempo de cada tarefa em cada status (entrada → próxima mudança), somando idas e voltas. Média e mediana por status, considerando tarefas cuja última saída do status ocorreu no período. A permanência atual (ainda no status) e os status de conclusão não entram. | Sim |
| **Aging** | Para não concluídas: `agora − (started_at ?? created_at)`, em faixas 0–7, 8–15, 16–30, +30 dias. | Não |

Séries temporais: agrupamento automático pelo tamanho do período — até 120 dias por semana (início na
segunda-feira), acima disso por mês — pela data local. Não há seletor manual.
Gráficos: (1) criadas × concluídas por período — o throughput ao longo do tempo é a série
"Concluídas"; (2) Cycle Time médio por período com a mediana do período como referência;
(3) tempo médio em cada coluna; (4) distribuição atual por status; (5) aging.

### Visão "Outcomes" do dashboard (`server/src/modules/dashboard/outcomes.ts`, `GET /api/dashboard/outcomes`)

O dashboard abre na visão **Tarefas** (indicadores acima) e pode ser trocado para **Outcomes** (a escolha
fica salva no navegador). Filtros: período, épico e responsável do outcome. Considera outcomes ativos
fora da lixeira:

| Indicador | Definição |
|---|---|
| Outcomes abertos | Não estão em status de conclusão nem "encerra sem entrega" |
| Concluídos | Em status de conclusão (retrato atual); "criados no período" pela data de criação |
| Progresso médio do indicador | Média, nos abertos com atual, meta e resultado, de (resultado − atual) / (meta − atual), limitado a 0–100% |
| Meta atingida | Outcomes (não cancelados) com progresso de 100% |
| Atrasados | Abertos com data alvo anterior a hoje |
| Tempo médio com flag | Mesma regra das tarefas, com as flags dos outcomes |
| Gráficos | Progresso do indicador por outcome (na cor do outcome), entregas (tarefas concluídas × em aberto) e distribuição por status |

## 7. Datas e fuso horário

- Configuração única: `APP_TIMEZONE` (padrão `America/Sao_Paulo`) em `server/src/config.ts`.
- Instantes (criação, início/conclusão reais, histórico) são gravados em **UTC**.
- Datas de calendário (prazos, datas de épicos/outcomes) são gravadas como `AAAA-MM-DD`, sem hora,
  e nunca sofrem conversão de fuso.
- "Hoje", atraso e limites de período são calculados **no fuso da aplicação** (nunca no do servidor
  ou do navegador). O frontend obtém o fuso em `/api/config` e formata tudo nele.
- Exemplo testado: conclusão às 23:00 de 02/10 em São Paulo (02:00Z de 03/10) com prazo 02/10 é
  **no prazo**.

## 8. Plano de implementação (executado)

1. Estrutura do monorepo (server + client) e configuração central.
2. Migrations e modelo de dados.
3. Regras puras de status/atraso e cálculo de métricas, com testes.
4. API REST (auth, admin, épicos, outcomes, tarefas, histórico, dashboard), com testes de API.
5. Seed de demonstração (datas relativas a hoje).
6. Frontend: login, layout, Kanban com arrastar-e-soltar, lista, filtros, modal de tarefa.
7. Épicos, Outcomes, Dashboard e Administração.
8. Build de produção servido pelo próprio Express; verificação visual das telas.

## 9. Evolução prevista (não implementado)

Comentários, anexos, notificações, integrações (Teams, GitHub, sistemas internos), dependências e
subtarefas entram como novas tabelas ligadas a `tasks` e novos módulos em `server/src/modules`.
O `task_status_history` já permite medir tempo por etapa e gargalos. Permissões mais granulares
podem evoluir a partir do campo `role` e dos middlewares `requireAuth`/`requireAdmin`.
