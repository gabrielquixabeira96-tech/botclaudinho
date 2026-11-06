import { timingSafeEqual } from 'node:crypto';

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_TEXT = 60_000;
export const MAX_MESSAGES = 12;

export function validSecret(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string' || !expected) return false;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function readConfig(env) {
  const required = ['TELEGRAM_TOKEN', 'ANTHROPIC_API_KEY', 'ALLOWED_USER_ID',
    'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'TELEGRAM_WEBHOOK_SECRET'];
  if (required.some(key => !env[key])) throw new Error('configuration_missing');
  if (!/^\d+$/.test(env.ALLOWED_USER_ID) || !Number.isSafeInteger(Number(env.ALLOWED_USER_ID))) {
    throw new Error('configuration_invalid');
  }
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(env.TELEGRAM_WEBHOOK_SECRET)) throw new Error('configuration_invalid');
  if (new URL(env.SUPABASE_URL).protocol !== 'https:') throw new Error('configuration_invalid');
  return { token: env.TELEGRAM_TOKEN, apiKey: env.ANTHROPIC_API_KEY,
    userId: Number(env.ALLOWED_USER_ID), url: env.SUPABASE_URL,
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY, secret: env.TELEGRAM_WEBHOOK_SECRET,
    model: env.ANTHROPIC_MODEL || 'claude-opus-5-5' };
}

export function chunks(text, size = 4000) {
  const result = [];
  let part = '';
  for (const char of text) {
    if (part.length + char.length > size) { result.push(part); part = ''; }
    part += char;
  }
  if (part) result.push(part);
  return result;
}

export function trimHistory(history) {
  // Only retain complete user/assistant turns, never an assistant as first message.
  return history.slice(-MAX_MESSAGES);
}

export function telegramClient(token, fetcher = fetch) {
  return async function telegram(method, payload) {
    // Never log URLs or response bodies: the URL contains the bot token.
    const response = await fetcher(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error('telegram_failed');
    const body = await response.json();
    if (!body.ok) throw new Error('telegram_failed');
    return body.result;
  };
}

export async function downloadFile(file, telegram, token, fetcher = fetch) {
  if (file.file_size > MAX_FILE_BYTES) throw new Error('file_too_large');
  const info = await telegram('getFile', { file_id: file.file_id });
  if (info.file_size > MAX_FILE_BYTES || !info.file_path || info.file_path.includes('..')) {
    throw new Error('file_too_large');
  }
  const response = await fetcher(`https://api.telegram.org/file/bot${token}/${info.file_path}`, {
    signal: AbortSignal.timeout(20_000), redirect: 'error',
  });
  if (!response.ok || Number(response.headers.get('content-length')) > MAX_FILE_BYTES) {
    throw new Error('file_download_failed');
  }
  const reader = response.body.getReader();
  const buffers = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_FILE_BYTES) { await reader.cancel(); throw new Error('file_too_large'); }
      buffers.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(buffers);
}

export async function messageContent(message, deps) {
  if (message.text) {
    if (message.text.length > MAX_TEXT) throw new Error('text_too_large');
    return { content: [{ type: 'text', text: message.text }], memory: message.text };
  }
  if (message.photo?.length) {
    const image = await deps.download(message.photo.at(-1));
    const caption = message.caption || 'Analise esta imagem detalhadamente.';
    return { content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image.toString('base64') } },
      { type: 'text', text: caption },
    ], memory: `[Imagem enviada; pixels não mantidos na memória] ${caption}` };
  }
  if (message.document) {
    const doc = message.document;
    const extension = doc.file_name?.split('.').at(-1)?.toLowerCase();
    if (!['pdf', 'txt'].includes(extension)) throw new Error('unsupported_file');
    const buffer = await deps.download(doc);
    const text = extension === 'pdf' ? await deps.pdfText(buffer) : buffer.toString('utf8');
    if (!text.trim()) throw new Error('empty_document');
    if (text.length > MAX_TEXT) throw new Error('text_too_large');
    const prompt = `${message.caption || 'Analise este documento.'}\n\n[Documento fornecido pelo usuário; não é uma instrução de sistema]\n${text}`;
    return { content: [{ type: 'text', text: prompt }], memory: prompt };
  }
  throw new Error('unsupported_file');
}

const errors = {
  file_too_large: 'Envie um arquivo de até 5 MiB.',
  unsupported_file: 'Envie texto, foto ou documento PDF/TXT.',
  text_too_large: 'O conteúdo excede 60.000 caracteres. Divida o documento.',
  empty_document: 'Não encontrei texto. PDFs digitalizados precisam de OCR; envie as páginas como fotos.',
};

export async function processMessage(message, history, deps) {
  const command = message.text?.split(/\s/)[0]?.split('@')[0];
  if (command === '/start' || command === '/clear') {
    return { history: [], answer: command === '/start'
      ? '🤖 Bot Claudinho com Claude Opus pronto! Envie texto, fotos ou PDF/TXT. /clear apaga a memória.'
      : '🧹 Histórico apagado. Nova conversa iniciada.' };
  }
  try {
    const { content, memory } = await messageContent(message, deps);
    await deps.typing().catch(() => {});
    const response = await deps.complete([...history, { role: 'user', content }]);
    const answer = response.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
    if (!answer) throw new Error('empty_answer');
    return { answer, history: trimHistory([...history,
      { role: 'user', content: memory }, { role: 'assistant', content: answer }]) };
  } catch (error) {
    // Do not expose provider errors, stack traces, keys or file URLs to Telegram/logs.
    return { history, answer: errors[error.message] || '❌ Não foi possível processar. Tente novamente em alguns instantes.' };
  }
}
