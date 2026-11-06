# Bot Claudinho — sem banco de dados

Bot privado de Telegram em Node.js 24 e Vercel Functions, alimentado pelo Claude Opus.
Aceita texto, fotos JPEG do Telegram e documentos PDF/TXT, **sem Supabase**.

**Cada mensagem é independente.** O bot não salva nem recupera histórico de conversa.
Inclua todo o contexto na mensagem atual ou na legenda do arquivo/foto.
`/start` explica o funcionamento; `/clear` informa que não há memória para apagar.

## Configuração na Vercel

Selecione o projeto **botclaudinho** e depois **Environment Variables** na barra lateral.
Cadastre Name, Value e ambiente; clique **Save**. Use Production para o bot definitivo.
Faça uma nova implantação após salvar: alterações não afetam implantações anteriores.

| Variável | Valor informado diretamente na Vercel |
| --- | --- |
| `TELEGRAM_TOKEN` | Token do seu bot obtido no BotFather |
| `ANTHROPIC_API_KEY` | Chave da API Anthropic com acesso e saldo para o modelo |
| `ALLOWED_USER_ID` | Seu ID numérico de usuário Telegram, não username nem ID do bot |
| `TELEGRAM_WEBHOOK_SECRET` | Segredo aleatório de 32–256 caracteres: letras, números, `_` e `-` |
| `ANTHROPIC_MODEL` | Opcional; padrão `claude-opus-5-5` |

Nenhuma variável `SUPABASE_*`, conta Supabase ou script SQL é necessário.
Se já existirem variáveis Supabase antigas, esta versão simplesmente não as utiliza.
Gere o segredo localmente com `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
Não envie credenciais em chats, commits, capturas, URLs ou argumentos de comandos.

Referências: [Variáveis na Vercel](https://vercel.com/docs/environment-variables/managing-environment-variables)
e [modelo Claude Opus](https://platform.claude.com/docs/en/models/opus-5-5/overview).
O consumo Anthropic é cobrado separadamente. Não use credenciais de produção em Preview.

## Registrar webhook — no seu computador

Requer Node.js 24. Depois de publicar a versão definitiva:

1. Baixe/clone o repositório e execute `npm ci`.
2. Copie `.env.example` para `.env.local` e preencha os mesmos valores em um editor local.
3. Preencha também `BOT_WEBHOOK_URL` com `https://DOMINIO-DE-PRODUCAO/api/webhook`.
4. Execute `npm run register-webhook`.
5. No Telegram, teste `/start`, texto, foto e PDF/TXT. Cada envio deve conter seu próprio contexto.

O script registra `secret_token`, somente updates de mensagem e `max_connections: 1`.
Não descarta mensagens pendentes nem imprime tokens/URLs secretas. Confirma a URL
registrada com `getWebhookInfo`. O domínio deve estar acessível ao Telegram sem login;
não registre uma URL de preview protegida. Não há rota pública de administração.

## Segurança, privacidade e limites

- Só o chat privado do dono é aceito. Usuários não autorizados são ignorados.
- Arquivos até 5 MiB, com limite também durante download. Até 60.000 caracteres
  extraídos de PDF/TXT. PDFs digitalizados sem texto precisam de OCR externo ou fotos.
- O bot processa os dados temporariamente, sem persistir histórico ou conteúdo em banco.
  Telegram e Anthropic recebem o conteúdo necessário; suas políticas de retenção são independentes.
- Não há lock ou deduplicação persistentes. Retries do Telegram, reinícios ou timeouts
  podem repetir respostas e chamadas pagas. `max_connections: 1` não garante entrega única.
- Falha de entrega recebe HTTP 200 para não pedir deliberadamente uma repetição que possa
  duplicar chamadas pagas. Isso pode perder uma resposta; reenvie a pergunta se necessário.
- Execução máxima de 300 segundos, chamada Claude com timeout de 120 segundos sem retries
  automáticos. Erros brutos dos provedores e tokens não são exibidos nem logados pelo código.
- `GET /api/webhook` apenas confirma que o endpoint carrega; não verifica credenciais
  ou conectividade com os provedores. A raiz `/` não contém uma interface web.

## Verificação local

```sh
npm ci
npm test
npm run check
```

Os testes usam serviços simulados e um PDF real gerado em memória. Verificam isolamento
entre mensagens, configuração sem Supabase, webhook privado, limites e tratamento de erros.
Não chamam Telegram/Anthropic; a integração real exige credenciais e teste no Telegram.
