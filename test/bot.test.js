import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PDFParse } from 'pdf-parse';
import { chunks, validSecret, messageContent, processMessage, readConfig, downloadFile, MAX_FILE_BYTES } from '../lib/bot.js';
import { createHandler } from '../api/webhook.js';

const env = { TELEGRAM_TOKEN: 'test', ANTHROPIC_API_KEY: 'test', ALLOWED_USER_ID: '123',
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
test('foto vai à IA sem retornar histórico', async () => {
  const result = await processMessage({ photo: [{ file_id: 'a' }] }, {
    download: async () => Buffer.from('image'), typing: async () => {},
    complete: async messages => {
      assert.equal(messages[0].content[0].type, 'image');
      return { content: [{ type: 'thinking' }, { type: 'text', text: 'Imagem.' }] };
    },
  });
  assert.equal(result.answer, 'Imagem.');
  assert.deepEqual(Object.keys(result), ['answer']);
});
test('TXT e PDF processados; documento vazio rejeitado', async () => {
  const deps = { download: async () => Buffer.from('conteúdo'), pdfText: async () => 'texto PDF' };
  assert.match((await messageContent({ document: { file_name: 'x.TXT' } }, deps)).content[0].text, /conteúdo/);
  assert.match((await messageContent({ document: { file_name: 'x.pdf' } }, deps)).content[0].text, /texto PDF/);
  await assert.rejects(messageContent({ document: { file_name: 'x.pdf' } }, { ...deps, pdfText: async () => '' }), /empty_document/);
});
test('erros de provedor nunca vazam', async () => {
  const result = await processMessage({ text: 'oi' }, { typing: async () => {}, complete: async () => { throw new Error('secret-api-key'); } });
  assert.ok(!result.answer.includes('secret-api-key'));
  assert.deepEqual(Object.keys(result), ['answer']);
});
test('cada chamada recebe só a mensagem atual', async () => {
  const calls = [];
  const deps = { typing: async () => {}, complete: async messages => {
    calls.push(messages);
    return { content: [{ type: 'text', text: 'ok' }] };
  } };
  await processMessage({ text: 'primeira pergunta' }, deps);
  await processMessage({ text: 'segunda pergunta' }, deps);
  assert.deepEqual(calls.map(messages => messages.length), [1, 1]);
  assert.equal(calls[1][0].content[0].text, 'segunda pergunta');
  assert.ok(!JSON.stringify(calls[1]).includes('primeira pergunta'));
});
test('/start e /clear explicam ausência de memória sem chamar IA', async () => {
  for (const text of ['/start', '/clear']) {
    const result = await processMessage({ text }, {});
    assert.match(result.answer, /independente/);
    assert.deepEqual(Object.keys(result), ['answer']);
  }
});
test('configuração não exige Supabase e mantém segredos/whitelist obrigatórios', () => {
  assert.equal(readConfig(env).userId, 123);
  for (const key of ['TELEGRAM_TOKEN', 'ANTHROPIC_API_KEY', 'ALLOWED_USER_ID', 'TELEGRAM_WEBHOOK_SECRET']) {
    assert.throws(() => readConfig({ ...env, [key]: undefined }), /configuration_missing/);
  }
  assert.throws(() => readConfig({ ...env, ALLOWED_USER_ID: 'username' }), /configuration_invalid/);
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
test('webhook autorizado funciona sem banco e updates repetidos não têm deduplicação durável', async () => {
  const calls = [];
  const sent = [];
  const handler = createHandler({ env, makeServices: () => ({
    complete: async messages => { calls.push(messages); return { content: [{ type: 'text', text: 'oi' }] }; },
    telegram: async (method, payload) => { if (method === 'sendMessage') sent.push(payload); },
  }) });
  for (const text of ['primeira', 'segunda']) {
    const req = request(); req.body.message.text = text;
    const res = response(); await handler(req, res); assert.equal(res.code, 200);
  }
  assert.equal(calls.length, 2);
  assert.equal(sent.length, 2);
  assert.equal(calls[1].length, 1);
  assert.equal(calls[1][0].content[0].text, 'segunda');
});
test('webhook não pede retry quando envio falha e não vaza erro', async () => {
  const handler = createHandler({ env, makeServices: () => ({
    complete: async () => ({ content: [{ type: 'text', text: 'oi' }] }),
    telegram: async () => { throw new Error('private-token'); },
  }) });
  const oldError = console.error;
  const logged = []; console.error = value => logged.push(value);
  try {
    const res = response(); await handler(request(), res); assert.equal(res.code, 200);
    assert.ok(!logged.join('').includes('private-token'));
  } finally { console.error = oldError; }
});
test('configuração incompleta e update malformado são rejeitados', async () => {
  const res = response();
  await createHandler({ env: { TELEGRAM_WEBHOOK_SECRET: env.TELEGRAM_WEBHOOK_SECRET } })(request(), res);
  assert.equal(res.code, 503);
  const req = request(); delete req.body.update_id;
  const invalid = response(); await createHandler({ env })(req, invalid); assert.equal(invalid.code, 400);
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
