import { readConfig, telegramClient } from '../lib/bot.js';

try {
  const config = readConfig(process.env);
  const url = new URL(process.env.BOT_WEBHOOK_URL);
  if (url.protocol !== 'https:' || url.pathname !== '/api/webhook' || url.username || url.password || url.search) {
    throw new Error('invalid_url');
  }
  const telegram = telegramClient(config.token);
  await telegram('setWebhook', {
    url: url.href, secret_token: config.secret, max_connections: 1, allowed_updates: ['message'],
    drop_pending_updates: false,
  });
  const info = await telegram('getWebhookInfo', {});
  if (info.url !== url.href) throw new Error('registration_not_verified');
  console.log('Webhook registrado e URL confirmada. Teste /start no Telegram.');
} catch {
  console.error('Não foi possível registrar. Verifique .env.local, HTTPS e acesso à API Telegram. Nenhuma credencial foi exibida.');
  process.exitCode = 1;
}
