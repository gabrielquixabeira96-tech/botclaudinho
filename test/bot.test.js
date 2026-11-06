import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PDFParse } from 'pdf-parse';
import { chunks, validSecret, messageContent, processMessage, downloadFile, MAX_FILE_BYTES } from '../lib/bot.js';
import { createHandler } from '../api/webhook.js';

const env = { TELEGRAM_TOKEN: 'test', ANTHROPIC_API_KEY: 'test', ALLOWED_USER_ID: '123',
  SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test',
  TELEGRAM_WEBHOOK_SECRET: 'a'.repeat(40) };
function response() {
  return { code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } };
}
function request(message = { text: 'oi', from: { id: 123 }, chat: { id: 123, type: 'private' } }) {
  return { method: 'POST', headers: { 'x-telegram-bot-api-secret-token': env.TELEGRAM_WEBHOOK_SECRET }, body: { update_id: 42, message } };
}

test('segredo obrigatório e comparação exata', () => {
  assert.equal(validSecret(undefined, undefined), false);
  assert.equal(validSecret('abc', 'abd'), false);
  assert.equal(validSecret('abc', 'abc'), true);
});
test('chunks preservam Unicode e limite Telegram', () => {
  const text = 'á😀'.repeat(5000);
  const parts = chunks(text);
  assert.equal(parts.join(''), text);
  assert.ok(parts.every(part => part.length <= 4000 && !/[\uD800-\uDBFF]$/.test(part)));
});
test('extensão e tamanho rejeitados antes do download', async () => {
  await assert.rejects(messageContent({ document: { file_name: 'x.exe' } }, {}), /unsupported_file/);
  await assert.rejects(downloadFile({ file_size: MAX_FILE_BYTES + 1 }, () => assert.fail(), 'test'), /file_too_large/);
});
test('download com tamanho omitido ainda aplica limite', async () => {
  const response = new Response(new Uint8Array(MAX_FILE_BYTES + 1));
  await assert.rejects(downloadFile({}, async () => ({ file_path: 'documents/file.txt' }), 'test', async () => response), /file_too_large/);
});
test('foto vai à IA mas base64 não fica no banco', async () => {
  const result = await processMessage({ photo: [{ file_id: 'a' }] }, [], {
    download: async () => Buffer.from('image'), typing: async () => {},
    complete: async messages => {
      assert.equal(messages[0].content[0].type, 'image');
      return { content: [{ type: 'thinking' }, { type: 'text', text: 'Imagem.' }] };
    },
  });
  assert.equal(result.answer, 'Imagem.');
  assert.equal(typeof result.history[0].content, 'string');
  assert.ok(!JSON.stringify(result.history).includes('aW1hZ2U='));
});
test('TXT e PDF processados; documento vazio rejeitado', async () => {
  const deps = { download: async () => Buffer.from('conteúdo'), pdfText: async () => 'texto PDF' };
  assert.match((await messageContent({ document: { file_name: 'x.TXT' } }, deps)).memory, /conteúdo/);
  assert.match((await messageContent({ document: { file_name: 'x.pdf' } }, deps)).memory, /texto PDF/);
  await assert.rejects(messageContent({ document: { file_name: 'x.pdf' } }, { ...deps, pdfText: async () => '' }), /empty_document/);
});
test('erros de provedor nunca vazam e histórico começa com usuário', async () => {
  const result = await processMessage({ text: 'oi' }, [], { typing: async () => {}, complete: async () => { throw new Error('secret-api-key'); } });
  assert.ok(!result.answer.includes('secret-api-key'));
  const history = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'old' }));
  const next = await processMessage({ text: 'oi' }, history, { typing: async () => {}, complete: async () => ({ content: [{ type: 'text', text: 'ok' }] }) });
  assert.equal(next.history.length, 12);
  assert.equal(next.history[0].role, 'user');
});
test('/clear apaga memória sem IA', async () => {
  const result = await processMessage({ text: '/clear' }, [{ role: 'user', content: 'old' }], {});
  assert.deepEqual(result.history, []);
});
test('endpoint GET funciona sem credenciais; métodos inválidos rejeitados', async () => {
  const handler = createHandler({ env: {} });
  const res = response();
  await handler({ method: 'GET' }, res);
  assert.equal(res.code, 200);
  const bad = response(); await handler({ method: 'DELETE' }, bad); assert.equal(bad.code, 405);
});
test('webhook rejeita segredo ausente e ignora usuário/grupo sem serviços', async () => {
  const handler = createHandler({ env, makeServices: () => assert.fail('must not access services') });
  const res = response(); await handler({ ...request(), headers: {} }, res); assert.equal(res.code, 401);
  const bad = response(); await handler(request({ from: { id: 999 }, chat: { id: 999, type: 'private' } }), bad); assert.equal(bad.code, 200);
  await handler(request({ from: { id: 123 }, chat: { id: -1, type: 'group' } }), response());
});
test('update repetido não chama IA e lock ocupado retorna retry', async () => {
  for (const [status, code] of [['done', 200], ['busy', 503]]) {
    const handler = createHandler({ env, makeServices: () => ({ db: { rpc: async () => ({ data: { status } }) } }) });
    const res = response(); await handler(request(), res); assert.equal(res.code, code);
  }
});
test('salva antes de enviar resposta ao Telegram', async () => {
  const events = [];
  const handler = createHandler({ env, makeServices: () => ({
    db: { rpc: async name => {
      events.push(name);
      return { data: name === 'claim_telegram_update' ? { status: 'acquired', history: [] } : true };
    } },
    complete: async () => ({ content: [{ type: 'text', text: 'oi' }] }),
    telegram: async method => { events.push(method); },
  }) });
  const res = response(); await handler(request(), res);
  assert.equal(res.code, 200);
  assert.ok(events.indexOf('finish_telegram_update') < events.indexOf('sendMessage'));
});
test('PDF real processado com dependência e worker instalados', async () => {
  // Minimal, valid PDF with an uncompressed text stream and correct cross references.
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const stream = 'BT /F1 12 Tf 72 720 Td (Hello Claudinho) Tj ET';
  objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const parser = new PDFParse({ data: Buffer.from(pdf) });
  try { assert.match((await parser.getText()).text, /Hello Claudinho/); } finally { await parser.destroy(); }
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url)));
  await readFile(new URL(`../${config.functions['api/webhook.js'].includeFiles}`, import.meta.url));
});
