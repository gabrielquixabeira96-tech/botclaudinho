import { randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { chunks, downloadFile, processMessage, readConfig, telegramClient, validSecret } from '../lib/bot.js';

export function createHandler({ env = process.env, makeServices = services } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET') return res.status(200).json({ service: 'botclaudinho', status: 'endpoint_available' });
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).end();
    }
    if (!validSecret(req.headers['x-telegram-bot-api-secret-token'], env.TELEGRAM_WEBHOOK_SECRET)) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    let config;
    try { config = readConfig(env); } catch { return res.status(503).json({ error: 'not_configured' }); }
    const update = req.body;
    if (!update || !Number.isSafeInteger(update.update_id)) return res.status(400).end();
    const message = update.message;
    // Only the owner's private chat is accepted, never a group or channel.
    if (!message || message.from?.id !== config.userId || message.chat?.id !== config.userId || message.chat?.type !== 'private') {
      return res.status(200).end();
    }
    const lease = randomUUID();
    let phase = 'claim';
    try {
      const { db, telegram, complete, pdfText } = makeServices(config);
      const { data: claim, error } = await db.rpc('claim_telegram_update', {
        p_user_id: config.userId, p_update_id: update.update_id, p_lease: lease,
      });
      if (error) throw new Error('storage_failed');
      if (claim.status === 'done') return res.status(200).end();
      if (claim.status !== 'acquired') return res.status(503).end();
      phase = 'process';
      const result = await processMessage(message, claim.history || [], {
        download: file => downloadFile(file, telegram, config.token), pdfText, complete,
        typing: () => telegram('sendChatAction', { chat_id: config.userId, action: 'typing' }),
      });
      // Persist before delivery. This prevents repeated AI calls for Telegram retries.
      // A crash after commit and before delivery can lose a reply (see README).
      phase = 'commit';
      const saved = await db.rpc('finish_telegram_update', {
        p_user_id: config.userId, p_update_id: update.update_id, p_lease: lease, p_history: result.history,
      });
      if (saved.error || saved.data !== true) throw new Error('storage_failed');
      phase = 'delivery';
      for (const text of chunks(result.answer)) await telegram('sendMessage', { chat_id: config.userId, text });
      return res.status(200).end();
    } catch {
      console.error(JSON.stringify({ event: 'webhook_failed', phase, updateId: update.update_id }));
      // Never resend a committed reply automatically: delivery may have partially succeeded.
      return res.status(phase === 'delivery' ? 200 : 503).end();
    }
  };
}

function services(config) {
  const db = createClient(config.url, config.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anthropic = new Anthropic({ apiKey: config.apiKey, timeout: 120_000, maxRetries: 0 });
  return {
    db, telegram: telegramClient(config.token),
    complete: messages => anthropic.messages.create({ model: config.model, max_tokens: 4096, messages }),
    pdfText: async buffer => {
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: buffer });
      try { return (await parser.getText()).text; } finally { await parser.destroy(); }
    },
  };
}

export default createHandler();
