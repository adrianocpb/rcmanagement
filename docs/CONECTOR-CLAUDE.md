# Conector do Claude (MCP) — Gestão de Melhorias

Com o conector, o Claude lê épicos, outcomes e tarefas do sistema, procura itens parecidos (para não
duplicar), liga cada item ao lugar certo e cria ou edita itens — **sempre pedindo sua aprovação antes de
gravar**. Pelo conector não é possível excluir nada.

Endereço do servidor: **`https://rcinovacao.fly.dev/mcp`**

## 1. (Opcional, recomendado) Crie um usuário para o Claude

Em **Administração → Usuários → Novo usuário**, crie, por exemplo, "Assistente PM" com perfil
**Usuário**. Assim, no histórico das tarefas, fica claro o que foi feito pelo Claude.
(Se preferir, o token pode agir em seu nome — escolha você mesmo no passo 2.)

## 2. Crie o token

1. **Administração → Integrações → Novo token**.
2. Dê um nome (ex.: "Claude — projeto PM") e escolha em nome de quem o token age.
3. Clique em **Criar token** e **copie o token** — ele aparece uma única vez.
   Se perder, revogue e crie outro.

## 3. Adicione o conector no Claude

1. No claude.ai: **Configurações → Conectores → Adicionar conector personalizado**.
2. Nome: `Gestão de Melhorias`. URL: `https://rcinovacao.fly.dev/mcp`.
3. Em **Request headers** (cabeçalhos), adicione:
   - Nome: `Authorization`
   - Valor: `Bearer ` + o token (a palavra Bearer, um espaço e o token, ex.: `Bearer rcm_AbC...`)
4. Autenticação: **No sign in** (o token no cabeçalho já autentica).
5. Salve. Numa conversa, ative o conector em **Pesquisa e ferramentas**.

Quando o Claude for chamar uma ferramenta que grava, ele pede sua aprovação. Evite marcar
"Permitir sempre" nas ferramentas `criar_*`, `atualizar_*` e `flag` se quiser revisar cada gravação.

> Observação: a máquina do Fly.io "dorme" quando não há uso; a primeira chamada pode levar alguns
> segundos a mais.

## 4. Instruções sugeridas para o projeto no Claude

Cole nas instruções do projeto (ajuste à vontade):

```
Você atua como PM do time de Desenvolvimento usando o conector "Gestão de Melhorias".
- Hierarquia: Épico (estratégico, ligado a um OKR) → Outcome (resultado de negócio com indicador
  Atual → Meta, e o Resultado alcançado) → Tarefa (entrega).
- Sempre comece chamando "contexto" para saber status, setores e pessoas (ids).
- Antes de criar qualquer item, use "buscar" para achar itens iguais ou parecidos. Se existir algo
  parecido, mostre e pergunte se devo reaproveitar, editar ou criar mesmo assim.
- Ligue cada outcome ao épico certo e cada tarefa ao outcome certo.
- Antes de gravar (criar_*, atualizar_*, flag), mostre uma tabela com exatamente o que será gravado
  e espere minha confirmação explícita.
- Escreva em português, de forma objetiva.
```

## Ferramentas disponíveis

| Ferramenta | O que faz | Grava? |
|---|---|---|
| `contexto` | Status (colunas), setores, pessoas, solicitantes e tags existentes | não |
| `listar_epicos` / `listar_outcomes` / `listar_tarefas` | Listagens (com filtros; tarefas também por tag) | não |
| `buscar` | Itens parecidos com um texto (ignora acentos), do mais parecido para o menos | não |
| `detalhe` | Todos os campos de um épico, outcome ou tarefa (com histórico) | não |
| `criar_epico` / `criar_outcome` / `criar_tarefa` | Cria itens (tarefa herda o épico do outcome; tarefa aceita tags) | sim |
| `atualizar_epico` / `atualizar_outcome` / `atualizar_tarefa` | Altera só os campos informados (ex.: valor atual do indicador, status) | sim |
| `flag` | Coloca ou retira a flag (bloqueio) de tarefa ou outcome, com motivo | sim |

## Segurança

- O token dá acesso aos dados do sistema: não compartilhe. O banco guarda só um resumo (hash) dele.
- **Revogar** em Administração → Integrações corta o acesso na hora.
- "Último uso" mostra quando o token foi usado pela última vez.
- Tudo o que for criado ou editado fica no histórico em nome do usuário do token.
