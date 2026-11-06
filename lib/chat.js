export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_TEXT = 60_000;
export class InputError extends Error {}

export async function buildContent(body, pdfText) {
  if (!body || typeof body !== 'object' || typeof body.text !== 'string' || body.text.length > MAX_TEXT) {
    throw new InputError('Envie um texto de até 60.000 caracteres.');
  }
  const text = body.text.trim();
  const content = [];
  if (body.file != null) {
    const file = body.file;
    if (typeof file.name !== 'string' || file.name.length > 255 || typeof file.data !== 'string' ||
        file.data.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.data)) {
      throw new InputError('Arquivo inválido ou maior que 2 MiB.');
    }
    const buffer = Buffer.from(file.data, 'base64');
    if (!buffer.length || buffer.length > MAX_FILE_BYTES) throw new InputError('Arquivo vazio ou maior que 2 MiB.');
    const extension = file.name.split('.').at(-1).toLowerCase();
    if (['jpg', 'jpeg', 'png', 'webp'].includes(extension)) {
      const mime = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg';
      const valid = mime === 'image/png' ? buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
        : mime === 'image/jpeg' ? buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255
        : buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
      if (!valid) throw new InputError('O conteúdo não corresponde ao formato de imagem.');
      content.push({ type: 'image', source: { type: 'base64', media_type: mime, data: file.data } });
    } else if (extension === 'pdf' || extension === 'txt') {
      if (extension === 'pdf' && buffer.toString('ascii', 0, 5) !== '%PDF-') throw new InputError('PDF inválido.');
      let extracted;
      try { extracted = extension === 'pdf' ? await pdfText(buffer) : buffer.toString('utf8'); }
      catch { throw new InputError('Não consegui ler o PDF. Tente outro arquivo ou envie uma imagem.'); }
      if (!extracted.trim()) throw new InputError('Documento sem texto. Para PDF digitalizado, envie uma foto da página.');
      if (extracted.length + text.length > MAX_TEXT) throw new InputError('O documento e a pergunta excedem 60.000 caracteres.');
      content.push({ type: 'text', text: `[Documento do usuário]\n${extracted}` });
    } else throw new InputError('Use PDF, TXT, JPG, PNG ou WebP.');
  }
  if (!text && !content.length) throw new InputError('Escreva uma mensagem ou anexe um arquivo.');
  content.push({ type: 'text', text: text || 'Analise este arquivo detalhadamente, em português.' });
  return content;
}
export async function extractPdf(buffer) {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  try { return (await parser.getText()).text; } finally { await parser.destroy(); }
}
