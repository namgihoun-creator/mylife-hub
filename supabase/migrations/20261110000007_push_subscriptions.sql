-- =============================================================================
-- MyLife Hub — Phase 2-3: Web Push infrastructure
--   push_subscriptions (+RLS), notifications.push_sent_at (delivery marker),
--   upsert_push_subscription, delete_expired_subscription,
--   claim_unsent_notifications / release_notification_push (used by /api/push/dispatch).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Delivery marker on notifications
--    NULL = not pushed yet. The dispatcher claims rows atomically by stamping push_sent_at.
-- -----------------------------------------------------------------------------
alter table public.notifications add column if not exists push_sent_at timestamptz;

create index if not exists notifications_push_pending_idx
  on public.notifications (created_at)
  where push_sent_at is null;

-- -----------------------------------------------------------------------------
-- 2. push_subscriptions
-- -----------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  endpoint     text not null unique
               check (endpoint ~ '^https://' and char_length(endpoint) <= 2048),
  p256dh       text not null check (char_length(p256dh) between 20 and 200),
  auth         text not null check (char_length(auth) between 8 and 100),
  user_agent   text check (char_length(user_agent) <= 400),
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- Own rows only. No UPDATE policy/grant: re-subscribing goes through upsert_push_subscription.
-- Bulk sending and expiry cleanup use service_role / SECURITY DEFINER code.
revoke all on public.push_subscriptions from anon, authenticated;
grant select, insert, delete on public.push_subscriptions to authenticated;

drop policy if exists push_subscriptions_select_own on public.push_subscriptions;
create policy push_subscriptions_select_own on public.push_subscriptions
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists push_subscriptions_insert_own on public.push_subscriptions;
create policy push_subscriptions_insert_own on public.push_subscriptions
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists push_subscriptions_delete_own on public.push_subscriptions;
create policy push_subscriptions_delete_own on public.push_subscriptions
  for delete to authenticated
  using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 3. upsert_push_subscription  (logged-in user registers / refreshes THIS browser)
--    A browser endpoint identifies one browser profile. If another account was subscribed on it before
--    (shared device), the subscription is handed over to the current user — a plain INSERT would hit the
--    UNIQUE(endpoint) conflict on a row the new user cannot even see.
-- -----------------------------------------------------------------------------
create or replace function public.upsert_push_subscription(
  p_endpoint   text,
  p_p256dh     text,
  p_auth       text,
  p_user_agent text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_id    uuid;
  v_count int;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'NO_HOUSEHOLD' using errcode = '28000';
  end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or char_length(p_endpoint) > 2048 then
    raise exception 'INVALID_SUBSCRIPTION' using errcode = '22023';
  end if;

  -- A user may keep at most 10 browsers/devices (re-subscribing an existing endpoint does not count).
  if not exists (select 1 from public.push_subscriptions where endpoint = p_endpoint and user_id = v_uid) then
    select count(*) into v_count from public.push_subscriptions where user_id = v_uid;
    if v_count >= 10 then
      raise exception 'TOO_MANY_SUBSCRIPTIONS' using errcode = '54000';
    end if;
  end if;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, last_used_at)
  values (v_uid, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 400), now())
  on conflict (endpoint) do update
    set user_id      = excluded.user_id,
        p256dh       = excluded.p256dh,
        auth         = excluded.auth,
        user_agent   = excluded.user_agent,
        last_used_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. delete_expired_subscription  (dispatcher: push service answered 404 / 410 Gone)
-- -----------------------------------------------------------------------------
create or replace function public.delete_expired_subscription(p_endpoint text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n int;
begin
  delete from public.push_subscriptions where endpoint = p_endpoint;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. claim_unsent_notifications / release_notification_push
--    claim: atomically stamps push_sent_at on up to p_limit notifications created in the last 24h
--    (older ones are never pushed: nobody wants a day-old "due today"), optionally for specific users only.
--    FOR UPDATE SKIP LOCKED makes overlapping dispatch runs take disjoint sets -> no double push.
--    release: gives claimed rows back (transient push-service failure) so the next run retries them.
-- -----------------------------------------------------------------------------
create or replace function public.claim_unsent_notifications(
  p_limit    int default 100,
  p_user_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows jsonb;
begin
  with c as (
    select n.id
      from public.notifications n
     where n.push_sent_at is null
       and n.created_at > now() - interval '24 hours'
       and (p_user_ids is null or n.user_id = any (p_user_ids))
     order by n.created_at asc
     limit least(greatest(coalesce(p_limit, 100), 1), 200)
       for update skip locked
  ),
  u as (
    update public.notifications n
       set push_sent_at = now()
      from c
     where n.id = c.id
    returning n.id, n.user_id, n.type, n.title, n.body, n.task_id
  )
  select coalesce(jsonb_agg(to_jsonb(u)), '[]'::jsonb) into v_rows from u;

  return v_rows;
end;
$$;

create or replace function public.release_notification_push(p_ids uuid[])
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n int;
begin
  update public.notifications set push_sent_at = null where id = any (p_ids);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Privileges
-- -----------------------------------------------------------------------------
revoke all on function public.upsert_push_subscription(text, text, text, text)  from public, anon;
revoke all on function public.delete_expired_subscription(text)                 from public, anon, authenticated;
revoke all on function public.claim_unsent_notifications(int, uuid[])           from public, anon, authenticated;
revoke all on function public.release_notification_push(uuid[])                 from public, anon, authenticated;

grant execute on function public.upsert_push_subscription(text, text, text, text) to authenticated;
grant execute on function public.delete_expired_subscription(text)                to service_role;
grant execute on function public.claim_unsent_notifications(int, uuid[])          to service_role;
grant execute on function public.release_notification_push(uuid[])                to service_role;
