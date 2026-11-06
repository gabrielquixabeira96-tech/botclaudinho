import Anthropic from '@anthropic-ai/sdk';
import { buildContent, extractPdf, InputError } from '../lib/chat.js';

export function createHandler({ env = process.env, complete, pdfText = extractPdf } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET') return res.status(200).json({ service: 'claudinho-web', configured: Boolean(env.ANTHROPIC_API_KEY) });
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).end(); }
    // Deployment Protection is required on ALL URLs, including production.
    let origin;
    try { origin = new URL(req.headers.origin); } catch { return res.status(403).json({ error: 'Origem não autorizada.' }); }
    if (origin.protocol !== 'https:' || origin.host !== req.headers.host) return res.status(403).json({ error: 'Origem não autorizada.' });
    if (!req.headers['content-type']?.startsWith('application/json')) return res.status(415).json({ error: 'Formato inválido.' });
    if (!env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'A chave da Anthropic ainda não está configurada no servidor.' });
    try {
      if (JSON.stringify(req.body).length > 3_000_000) throw new InputError('Requisição muito grande. Use um arquivo de até 2 MiB.');
      const content = await buildContent(req.body, pdfText);
      const run = complete || (async messages => {
        const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 120_000, maxRetries: 0 });
        return client.messages.create({ model: env.ANTHROPIC_MODEL || 'claude-opus-5-5', max_tokens: 4096, messages });
      });
      const result = await run([{ role: 'user', content }]);
      const answer = result.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
      if (!answer) return res.status(502).json({ error: 'Claude não retornou texto. Tente reformular a pergunta.' });
      return res.status(200).json({ answer });
    } catch (error) {
      if (error instanceof InputError) return res.status(400).json({ error: error.message });
      // Never expose provider error bodies, credentials or user content.
      const status = error.status;
      const message = status === 401 || status === 403 ? 'A Anthropic recusou a chave ou o acesso ao modelo. Verifique sua conta.'
        : status === 402 ? 'Verifique os créditos da sua conta Anthropic.'
        : status === 429 ? 'Limite da Anthropic atingido. Aguarde e tente novamente.'
        : 'Não foi possível obter a resposta. Verifique os créditos e o acesso ao modelo na Anthropic.';
      return res.status(502).json({ error: message });
    }
  };
}
export default createHandler();
