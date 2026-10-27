# Publicar na web com o Fly.io (teste)

Resultado: o sistema fica em `https://<nome-que-voce-escolher>.fly.dev`, com HTTPS, servidor em
São Paulo e um disco permanente para o banco, os anexos e os backups.

Custo estimado para teste: poucos dólares por mês (uma máquina pequena que desliga sozinha quando
ninguém está usando + 1 GB de disco). Confira os valores atuais em <https://fly.io/docs/about/pricing/>.

> Todos os comandos abaixo são no **Prompt de Comando (cmd)**, dentro da pasta do projeto:
> `cd C:\Users\user\Documents\Projetos\Rcmanagement\rcmanagement`

## 1. Instalar o programa da Fly (uma vez)

```
powershell -ExecutionPolicy Bypass -Command "iwr https://fly.io/install.ps1 -useb | iex"
```

Feche e abra o cmd de novo e confira: `fly version`.

## 2. Criar a conta e entrar (uma vez)

```
fly auth signup
```

O navegador abre para criar a conta (pode usar o login do GitHub). A Fly pede um cartão de
crédito para liberar o uso. Se já tiver conta: `fly auth login`.

## 3. Escolher o nome e criar o app (uma vez)

1. Abra o arquivo `fly.toml` (na pasta do projeto) e troque `gestao-melhorias-rc` por um nome único
   seu, só letras minúsculas, números e hífen. Ele vira o endereço: `https://<nome>.fly.dev`.
2. Crie o app com esse mesmo nome:

```
fly apps create <nome>
```

Se disser que o nome já existe, escolha outro (e troque no `fly.toml` também).

## 4. Criar o disco permanente (uma vez)

```
fly volumes create dados --region gru --size 1
```

Se perguntar sobre ter só um disco, responda `y` (para teste, um basta).

## 5. Definir o administrador inicial (uma vez)

Só é usado se o banco estiver vazio (primeira subida sem importar dados):

```
fly secrets set ADMIN_EMAIL=seu-email@empresa.com ADMIN_PASSWORD=UmaSenhaForte123
```

## 6. Publicar

```
fly deploy
```

Leva alguns minutos na primeira vez. No fim, abra o sistema com `fly open`.

## 7. (Opcional) Levar os dados do seu notebook

Se quiser começar com o que já tem no notebook em vez de um banco vazio:

1. Abra o sistema no navegador (para a máquina estar ligada).
2. Envie o banco com o nome `app-import.db`:

```
fly ssh sftp shell
put data\app.db /data/app-import.db
exit
```

3. Reinicie: `fly apps restart <nome>`

Na subida, o sistema troca o banco pelo importado e guarda o anterior em `/data/backups/`. Os
usuários e senhas passam a ser os do notebook.

> Anexos de solicitações ficam em `data\uploads\` no notebook. Se você tiver anexos e quiser levá-los,
> me avise que eu passo o procedimento (são vários arquivos).

## Atualizar depois de mudanças

Sempre que houver uma versão nova no GitHub:

```
git pull
fly deploy
```

O banco e os anexos ficam no disco permanente e não são afetados.

## Backups

- O próprio sistema faz uma cópia do banco por dia em `/data/backups/` e mantém as 7 mais recentes.
- Para baixar uma cópia para o seu computador:

```
fly ssh sftp get /data/backups/app-AAAA-MM-DD.db
```

## Comandos úteis

| Para | Comando |
|---|---|
| Abrir o sistema | `fly open` |
| Ver se está rodando | `fly status` |
| Ver o que está acontecendo (erros etc.) | `fly logs` |
| Reiniciar | `fly apps restart <nome>` |

## Observações

- A máquina **desliga sozinha** quando ninguém acessa e **liga no próximo acesso**: o primeiro
  acesso depois de um tempo parado demora alguns segundos. Isso reduz o custo.
- Troque a senha do administrador em **Administração → Usuários** e desative usuários de teste antes
  de chamar outras pessoas.
- Ainda não há "esqueci minha senha": o administrador define a senha inicial de cada pessoa.
