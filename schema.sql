-- Execute uma vez no SQL Editor do seu projeto Supabase.
-- Nenhuma policy de acesso público: apenas service_role pode acessar os dados/RPCs.
begin;
create table if not exists public.telegram_conversations (
  user_id bigint primary key,
  history jsonb not null default '[]'::jsonb check (jsonb_typeof(history) = 'array'),
  last_update_id bigint not null default -1,
  lease_id uuid,
  processing_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.telegram_conversations enable row level security;
-- Remove a policy insegura se o exemplo original tiver sido executado.
drop policy if exists "Acesso Total para Service Role" on public.telegram_conversations;
revoke all on public.telegram_conversations from public, anon, authenticated;
grant select, insert, update, delete on public.telegram_conversations to service_role;

create or replace function public.claim_telegram_update(p_user_id bigint, p_update_id bigint, p_lease uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.telegram_conversations%rowtype;
begin
  insert into public.telegram_conversations(user_id) values (p_user_id) on conflict do nothing;
  select * into r from public.telegram_conversations where user_id = p_user_id for update;
  -- Telegram can reset its update sequence after a week without updates.
  if r.last_update_id >= p_update_id and r.updated_at > now() - interval '7 days' then
    return jsonb_build_object('status', 'done');
  end if;
  if r.processing_until > now() then return jsonb_build_object('status', 'busy'); end if;
  update public.telegram_conversations set lease_id = p_lease,
    processing_until = now() + interval '6 minutes' where user_id = p_user_id;
  return jsonb_build_object('status', 'acquired', 'history', r.history);
end;
$$;

create or replace function public.finish_telegram_update(p_user_id bigint, p_update_id bigint, p_lease uuid, p_history jsonb)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  update public.telegram_conversations set history = p_history, last_update_id = p_update_id,
    lease_id = null, processing_until = null, updated_at = now()
    where user_id = p_user_id and lease_id = p_lease;
  return found;
end;
$$;
revoke all on function public.claim_telegram_update(bigint, bigint, uuid) from public, anon, authenticated;
revoke all on function public.finish_telegram_update(bigint, bigint, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.claim_telegram_update(bigint, bigint, uuid) to service_role;
grant execute on function public.finish_telegram_update(bigint, bigint, uuid, jsonb) to service_role;
commit;
