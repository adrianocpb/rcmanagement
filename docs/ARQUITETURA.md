# Arquitetura — Sistema de Acompanhamento de Entregas (MVP)

## 1. Stack escolhida

| Camada | Tecnologia | Por quê |
|---|---|---|
| Backend | **Node.js + Express 5 + TypeScript** | Simples, conhecido, sem framework pesado. |
| Banco | **SQLite** (`better-sqlite3`) | Arquivo único, zero infraestrutura, backup = copiar o arquivo. Suficiente para uma equipe interna. Trocar por PostgreSQL no futuro exige apenas adaptar a camada de acesso (SQL padrão). |
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
| `statuses` | name, color, position, **is_default**, **is_start_status**, **is_completion_status**, active | `position` = ordem das colunas. Só um `is_default`. |
| `epics` | name, description, okr (texto), owner_id → users, status, start_date, end_date, active | status ∈ planejado, em_andamento, concluido, cancelado. |
| `outcomes` | **epic_id → epics (obrigatório)**, name, description, owner_id, status, start_date, target_date, indicator_name, indicator_unit, baseline_value, target_value, current_value, active | Indicador principal embutido (1:1) — sem tabela extra. |
| `tasks` | title, description, notes, **sector_id**, **requester_id**, **assignee_id**, epic_id?, outcome_id?, **status_id**, priority, estimated_hours?, planned_start_date?, planned_end_date, started_at?, completed_at?, created_by, created_at, deleted_at? | `deleted_at` = exclusão lógica. |
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
| `/outcomes`, `/outcomes/:id` | Cards com indicador Baseline → Atual → Meta; detalhe com tarefas relacionadas. |
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
- **Permissões:** Administrador gerencia usuários, setores e status. Todos os usuários criam e editam
  tarefas, épicos e outcomes.

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
| **WIP** | Nº de tarefas não concluídas (exibe também quantas já foram iniciadas). | Não |
| **Aging** | Para não concluídas: `agora − (started_at ?? created_at)`, em faixas 0–7, 8–15, 16–30, +30 dias. | Não |

Séries temporais: agrupadas por semana (início na segunda-feira) ou mês, pela data local.
Gráficos: (1) criadas × concluídas por período — o throughput ao longo do tempo é a série
"Concluídas"; (2) Cycle Time médio por período com a mediana do período como referência;
(3) distribuição atual por status; (4) aging.

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
