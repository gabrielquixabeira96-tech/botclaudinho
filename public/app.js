const form = document.querySelector('#chat-form');
const prompt = document.querySelector('#prompt');
const fileInput = document.querySelector('#file');
const status = document.querySelector('#status');
const send = document.querySelector('#send');
const messages = document.querySelector('#messages');
const attachment = document.querySelector('#attachment');
let file = null;
let busy = false;
let ready = false;

function showStatus(text) { status.textContent = text; }
function resetFile() { file = null; fileInput.value = ''; attachment.hidden = true; attachment.replaceChildren(); }
function addMessage(who, text) {
  const article = document.createElement('article'); article.className = who === 'Claude' ? 'claude' : 'user';
  const heading = document.createElement('h2'); heading.textContent = who;
  const content = document.createElement('div'); content.className = 'content'; content.textContent = text;
  article.append(heading, content); messages.append(article);
  document.querySelector('#welcome').hidden = true;
  return article;
}
function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    reader.readAsDataURL(file);
  });
}
fileInput.addEventListener('change', () => {
  const selected = fileInput.files[0];
  if (!selected) return;
  if (selected.size > 2 * 1024 * 1024 || !/\.(pdf|txt|jpe?g|png|webp)$/i.test(selected.name)) {
    resetFile(); showStatus('Use PDF, TXT, JPG, PNG ou WebP de até 2 MiB.'); return;
  }
  file = selected; attachment.hidden = false;
  const name = document.createElement('span'); name.textContent = `${file.name} · ${Math.ceil(file.size / 1024)} KiB`;
  const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remover'; remove.onclick = resetFile;
  attachment.replaceChildren(name, remove); showStatus('Arquivo pronto. Inclua sua pergunta ou clique em Enviar.');
});
document.querySelectorAll('[data-prompt]').forEach(button => button.addEventListener('click', () => { prompt.value = button.dataset.prompt; prompt.focus(); }));
document.querySelector('#new-chat').addEventListener('click', () => {
  if (busy) return;
  messages.replaceChildren(); prompt.value = ''; resetFile(); document.querySelector('#welcome').hidden = false;
  showStatus('Tela limpa. Cada envio é independente.');
});
prompt.addEventListener('keydown', event => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); form.requestSubmit(); }
});
form.addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  if (!ready) { showStatus('A chave da Anthropic ainda não está disponível nesta implantação.'); return; }
  const text = prompt.value.trim(); const selected = file;
  if (!text && !selected) { showStatus('Escreva uma mensagem ou anexe um arquivo.'); prompt.focus(); return; }
  busy = true; send.disabled = true; fileInput.disabled = true; send.textContent = 'Pensando…';
  showStatus('Claude está preparando sua resposta…');
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 180_000);
  try {
    const payload = { text };
    if (selected) payload.file = { name: selected.name, data: await toBase64(selected) };
    const response = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal });
    if (response.redirected || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Sua sessão pode ter expirado. Recarregue a página e entre na Vercel.');
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível obter uma resposta.');
    addMessage('Você', `${text || 'Analise este arquivo.'}${selected ? `\n📎 ${selected.name}` : ''}`);
    const answer = addMessage('Claude', result.answer);
    prompt.value = ''; resetFile(); showStatus('Resposta pronta. O próximo envio não incluirá esta conversa.');
    answer.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) { showStatus(error.name === 'AbortError' ? 'Tempo de espera esgotado. Uma chamada pode ter sido cobrada; não há repetição automática.' : error.message); }
  finally { clearTimeout(timer); busy = false; send.disabled = false; fileInput.disabled = false; send.textContent = 'Enviar ↑'; }
});
fetch('/api/chat').then(async response => {
  if (!response.ok || response.redirected) throw new Error();
  const data = await response.json(); ready = data.configured === true;
  showStatus(ready ? 'Pronto para conversar. Sua chave permanece no servidor.' : 'Interface pronta. A chave Anthropic precisa estar configurada neste ambiente.');
}).catch(() => showStatus('Não foi possível verificar a configuração. Recarregue a página e confira seu login Vercel.'));
