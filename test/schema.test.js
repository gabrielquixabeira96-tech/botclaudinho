import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('SQL: permissões, lock, idempotência e limpeza de histórico', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon, authenticated, service_role;');
    const sql = await readFile(new URL('../schema.sql', import.meta.url), 'utf8');
    await db.exec(sql);
    await db.exec(sql); // Migration is repeatable.
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query('select * from public.telegram_conversations'), /permission denied/);
      await assert.rejects(db.query("select public.claim_telegram_update(123, 1, '00000000-0000-0000-0000-000000000001')"), /permission denied/);
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    const lease = '00000000-0000-0000-0000-000000000001';
    const claim = async id => (await db.query('select public.claim_telegram_update(123, $1, $2) as result', [id, lease])).rows[0].result;
    assert.equal((await claim(1)).status, 'acquired');
    assert.equal((await claim(2)).status, 'busy');
    const finish = await db.query('select public.finish_telegram_update(123, 1, $1, $2) as ok', [lease, JSON.stringify([{ role: 'user', content: 'test' }])]);
    assert.equal(finish.rows[0].ok, true);
    assert.equal((await claim(1)).status, 'done');
    assert.equal((await claim(2)).history[0].content, 'test');
    await db.query("select public.finish_telegram_update(123, 2, $1, '[]'::jsonb)", [lease]);
    assert.deepEqual((await claim(3)).history, []);
  } finally { await db.close(); }
});
