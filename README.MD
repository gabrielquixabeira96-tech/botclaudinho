# Claudinho — app web privado com Claude

Interface web em português para enviar texto, imagens JPG/PNG/WebP e PDF/TXT ao Claude.
Não usa Telegram, webhook ou Supabase. A chave Anthropic fica apenas no servidor.

## Uso

Abra o domínio do projeto e entre com sua conta Vercel autorizada na equipe.
Escreva uma pergunta, opcionalmente anexe um arquivo, e clique em **Enviar**.
`Ctrl+Enter` também envia. **Limpar tela** remove as mensagens visíveis.
Cada envio é independente: o histórico exibido existe apenas nesta aba e não é enviado
nas próximas perguntas. Inclua todo o contexto necessário na mensagem/legenda atual.

## Configuração

- `ANTHROPIC_API_KEY`: obrigatória, apenas no ambiente servidor.
- `ANTHROPIC_MODEL`: opcional; padrão `claude-opus-5-5`.
- As antigas variáveis Telegram são ignoradas e não precisam ser removidas.
- **Obrigatório:** manter Vercel Authentication em **All Deployments**, incluindo os
  domínios de produção. A API depende dessa autenticação da plataforma para restringir
  quem pode consumir sua chave. Não desative nem compartilhe links de bypass.
  Não há cadastro/login próprio ou senha adicional.

Referências: [Deployment Protection](https://vercel.com/docs/deployment-protection)
e [Claude Opus](https://platform.claude.com/docs/en/models/opus-5-5/overview).

## Limites e privacidade

Até um arquivo de 2 MiB e 60.000 caracteres por envio (pergunta + documento).
PDFs digitalizados precisam de OCR externo ou envio das páginas como imagens.
Até 4096 tokens de saída; timeout Anthropic de 120 segundos sem retries automáticos.
O consumo é cobrado pela Anthropic. Reinícios ou reenvios podem gerar novas cobranças;
não há controle de orçamento ou rate limit persistente na aplicação.
Conteúdo é processado temporariamente; não é salvo em banco, localStorage ou logs pelo
código. Políticas de retenção da Anthropic e da plataforma são independentes.
Respostas são exibidas como texto, sem executar HTML/Markdown fornecido pela IA.
A origem do POST deve ser a mesma origem HTTPS do app. Isso é proteção adicional
contra pedidos cross-site, não substitui o login Vercel.

`GET /api/chat` confirma se uma chave está presente sem mostrá-la. Essa presença não
prova que a chave é válida, tem créditos ou acesso ao modelo; confirme enviando uma pergunta.
Não exponha sua chave em mensagens, capturas, URLs, código público ou no navegador.

## Testes

```sh
npm ci
npm test
npm run check
```

Testes de validação, origem, isolamento, erros seguros e PDF real com worker instalado.
A interface pode ser verificada em preview sem chave: ela mostra que o ambiente ainda
não foi configurado. Não copie uma chave de produção para Preview apenas para testar.
