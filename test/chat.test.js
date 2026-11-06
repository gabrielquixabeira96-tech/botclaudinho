import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildContent, extractPdf, InputError, MAX_FILE_BYTES } from '../lib/chat.js';
import { createHandler } from '../api/chat.js';
const env = { ANTHROPIC_API_KEY: 'test-secret-key' };
const request = (body = { text: 'Oi' }) => ({ method: 'POST', body, headers: { origin: 'https://app.example', host: 'app.example', 'content-type': 'application/json' } });
const response = () => ({ code: 200, headers: {}, setHeader(k,v) { this.headers[k]=v; }, status(code) { this.code=code; return this; }, json(body) { this.body=body; return this; }, end() { return this; } });
const file = (name, data) => ({ name, data: Buffer.from(data).toString('base64') });

test('texto obrigatório, limites e mensagem sem anexo', async () => {
  assert.deepEqual(await buildContent({ text: 'Oi' }), [{ type: 'text', text: 'Oi' }]);
  for (const body of [null, {}, { text: '' }, { text: 'a'.repeat(60001) }]) await assert.rejects(buildContent(body), InputError);
});
test('TXT, PDF e legenda', async () => {
  assert.match((await buildContent({ text: 'resuma', file: file('a.txt', 'documento') }))[0].text, /documento/);
  const content = await buildContent({ text: '', file: file('a.pdf', '%PDF-test') }, async () => 'texto PDF');
  assert.match(content[0].text, /texto PDF/); assert.match(content[1].text, /Analise/);
  await assert.rejects(buildContent({ text: '', file: file('a.pdf', '%PDF-test') }, async () => ''), /sem texto/);
  await assert.rejects(buildContent({ text: '', file: file('a.pdf', '%PDF-test') }, async () => { throw new Error('provider-secret'); }), /Não consegui ler/);
});
test('base64, formato, assinatura e tamanho validados', async () => {
  const png = Buffer.from([137,80,78,71,13,10,26,10]);
  assert.equal((await buildContent({ text: '', file: file('a.png', png) }))[0].source.media_type, 'image/png');
  for (const attachment of [file('a.exe','abc'), file('a.png','abc'), file('a.pdf','abc'), {name:'a.txt',data:'!'}, file('a.txt',Buffer.alloc(MAX_FILE_BYTES+1))]) {
    await assert.rejects(buildContent({text:'',file:attachment}), InputError);
  }
  await assert.rejects(buildContent({text:'a',file:file('a.txt','b'.repeat(60000))}), /excedem/);
});
test('GET informa configuração sem expor chave; método inválido rejeitado', async () => {
  const res=response(); await createHandler({env})({method:'GET'},res);
  assert.equal(res.body.configured,true); assert.ok(!JSON.stringify(res).includes(env.ANTHROPIC_API_KEY));
  const bad=response(); await createHandler({env})({method:'DELETE'},bad); assert.equal(bad.code,405);
});
test('origem ausente/cruzada e formato inválido bloqueados antes da IA', async () => {
  const handler=createHandler({env,complete:()=>assert.fail()});
  for (const origin of [undefined,'https://evil.example','http://app.example']) {
    const req=request(); req.headers.origin=origin; const res=response(); await handler(req,res); assert.equal(res.code,403);
  }
  const req=request(); req.headers['content-type']='text/plain'; const res=response(); await handler(req,res); assert.equal(res.code,415);
});
test('sem chave retorna erro de configuração', async () => {
  const res=response(); await createHandler({env:{}})(request(),res); assert.equal(res.code,503);
});
test('somente a mensagem atual vai ao Claude, resposta combina blocos de texto', async () => {
  const calls=[]; const handler=createHandler({env,complete:async messages=>{calls.push(messages);return {content:[{type:'thinking'},{type:'text',text:'Resposta'},{type:'text',text:'final'}]};}});
  for (const text of ['primeira','segunda']) { const res=response();await handler(request({text}),res);assert.equal(res.body.answer,'Resposta\nfinal'); }
  assert.equal(calls[1].length,1);assert.equal(calls[1][0].content[0].text,'segunda');
});
test('erros de provedor não expõem detalhes e não fazem retry', async () => {
  let calls=0;const handler=createHandler({env,complete:async()=>{calls++;throw Object.assign(new Error('secret-key'),{status:401});}});
  const res=response(); await handler(request(),res);assert.equal(res.code,502);assert.equal(calls,1);assert.ok(!JSON.stringify(res).includes('secret-key'));
});
test('payload inválido não chama IA', async () => {
  const handler=createHandler({env,complete:()=>assert.fail()});const res=response();await handler(request({text:''}),res);assert.equal(res.code,400);
});
test('PDF real processado com worker instalado', async () => {
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const stream='BT /F1 12 Tf 72 720 Td (Hello Claudinho) Tj ET';objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  let pdf='%PDF-1.4\n';const offsets=[];
  for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
  const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  assert.match(await extractPdf(Buffer.from(pdf)),/Hello Claudinho/);
  const config=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url)));
  await readFile(new URL(`../${config.functions['api/chat.js'].includeFiles}`,import.meta.url));
});
