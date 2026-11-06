# Bot Claudinho

Bot privado de Telegram em Node.js 24, Vercel Functions, Claude Opus e Supabase.
Aceita texto, fotos JPEG do Telegram e documentos PDF/TXT. `/start` e `/clear`
apagam a memória. Apenas o usuário configurado, em conversa privada, pode usá-lo.

## Estado inicial

O código pode ser implantado sem credenciais. `GET /api/webhook` informa somente que
 o endpoint está disponível, não que Telegram, Anthropic e Supabase estejam conectados.
Nenhuma chave vem no repositório. O bot só fica ativo após os passos abaixo.

## 1. Banco Supabase

No **SQL Editor** de um projeto Supabase, execute [schema.sql](./schema.sql).
O script cria a tabela e duas funções RPC com acesso restrito a `service_role`.
RLS fica ativado e os papéis `anon`/`authenticated` não têm acesso à tabela ou RPCs.
A chave administrativa deve ficar apenas no servidor.

O script é repetível para este projeto, mas não migra a tabela do exemplo original
caso ela já exista com colunas diferentes. Nesse caso, faça uma migração preservando
os dados antes de ativar o bot; não apague a tabela sem backup.

Referência: [RLS no Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security).

## 2. Variáveis na Vercel

Selecione o projeto **botclaudinho** no dashboard e depois **Environment Variables**
na barra lateral. Cadastre Name, Value e ambiente; clique **Save**.
Faça uma nova implantação após salvar (mudanças não alteram implantações anteriores).
Use credenciais de teste separadas em Preview; não registre o mesmo bot em dois ambientes.

| Variável | Valor que você informa diretamente na Vercel |
| --- | --- |
| `TELEGRAM_TOKEN` | Token do seu bot obtido no BotFather |
| `ANTHROPIC_API_KEY` | Chave da API Anthropic, com acesso e saldo para o modelo |
| `ALLOWED_USER_ID` | Seu ID numérico de usuário Telegram (não o username nem o ID do bot) |
| `SUPABASE_URL` | URL HTTPS do projeto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave administrativa secret/service_role, nunca anon/publishable |
| `TELEGRAM_WEBHOOK_SECRET` | Segredo aleatório de 32–256 caracteres: letras, números, `_` e `-` |
| `ANTHROPIC_MODEL` | Opcional; padrão `claude-opus-5-5` |

Gere o segredo localmente com `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
Não envie credenciais em chats, commits, capturas, URLs ou argumentos de comandos.

O modelo padrão foi conferido na [documentação Anthropic](https://platform.claude.com/docs/en/models/opus-5-5/overview).
O identificador `claude-3-5-opus-latest` do exemplo não é usado.
O consumo da Anthropic é cobrado separadamente e depende do tamanho das conversas.

Referência: [Variáveis na Vercel](https://vercel.com/docs/environment-variables/managing-environment-variables).

## 3. Registrar webhook — no seu computador

Requer Node.js 24. Depois de publicar a versão definitiva:

1. Baixe/clone o repositório no seu computador e execute `npm ci`.
2. Copie `.env.example` para `.env.local` e preencha os mesmos valores em um editor local.
3. Preencha também `BOT_WEBHOOK_URL` com `https://DOMINIO-DE-PRODUCAO/api/webhook`.
4. Execute `npm run register-webhook`.
5. Abra seu bot no Telegram, envie `/start`, texto, uma foto e um PDF/TXT.

O script registra o `secret_token`, somente updates de mensagem e `max_connections: 1`
para manter a ordem das conversas. Não descarta mensagens pendentes. Nunca imprime
URLs com tokens ou erros brutos. Confirma a URL registrada com `getWebhookInfo`.
Não há rota pública de administração para registrar o webhook.
O domínio de produção precisa estar acessível ao Telegram, sem uma tela de login.
Não registre uma URL de preview protegida.

## Segurança e limites

- Não há resposta para usuários não autorizados; apenas o chat privado do dono é aceito.
- Arquivos de até 5 MiB, limitados também durante o download. PDFs/TXT: até 60.000
  caracteres extraídos. PDF digitalizado sem texto exige OCR externo ou envio como foto.
- O PDF é analisado no servidor; a extração não executa scripts do documento.
- Memória de até 6 turnos completos (12 mensagens), com texto dos documentos. Fotos
  são enviadas ao Claude no turno atual, mas seus pixels não são persistidos; reenvie
  a foto se quiser analisá-la novamente. O texto da resposta fica na memória.
- `/clear` remove o histórico textual mas mantém metadados de deduplicação.
  Backups/retencão do Supabase e políticas dos provedores são independentes.
- Lock persistente por usuário e marcador de update evitam processamento concorrente
  e repetição normal. Lock expira em 6 minutos após interrupção; Telegram pode tentar novamente.
- A memória é gravada **antes** do envio da resposta. Não é uma fila de entrega garantida:
  falha após gravação pode perder a resposta, e falha antes da gravação pode repetir
  uma chamada paga ao Claude. Entrega exatamente uma vez não é garantida. Se ocorrer,
  consulte os logs e reenvie sua pergunta; para uma garantia maior, adicione uma outbox/fila.
- Limite de execução: 300 segundos; chamada Claude: 120 segundos sem retries automáticos.
  Erros dos provedores não são expostos ao usuário ou logados com tokens.

## Verificação local

```sh
npm ci
npm test
npm run check
```

Os testes usam serviços simulados, um PDF real gerado em memória e PostgreSQL local
via PGlite para verificar SQL, grants, lock, deduplicação e persistência. Não chamam
Telegram/Anthropic nem criam recursos no Supabase. Integração real requer credenciais.
