-- =============================================================================
-- MyLife Hub — Phase 2-2: notification center (DB is the single source of truth)
--   notifications table + RLS, _notify helper, notification hooks in
--   complete_via_magic_token / accept_household_invite, read/cleanup RPCs.
-- Clients can only read their own rows and set read_at; rows are created by SECURITY DEFINER code.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Table
-- -----------------------------------------------------------------------------
create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  type         text not null
               check (type in ('DUE_SOON', 'DUE_TODAY', 'OVERDUE', 'MAGIC_COMPLETED', 'INVITE_ACCEPTED')),
  task_id      uuid references public.tasks (id) on delete set null,
  asset_id     uuid references public.assets (id) on delete set null,
  title        text not null,
  body         text not null,
  dedupe_key   text not null,
  read_at      timestamptz,
  created_at   timestamptz not null default now(),
  constraint notifications_user_dedupe_uniq unique (user_id, dedupe_key)
);

create index if not exists notifications_user_read_created_idx
  on public.notifications (user_id, read_at, created_at desc);

-- -----------------------------------------------------------------------------
-- 2. RLS + privileges
--    SELECT / UPDATE: own rows only. UPDATE is further limited to the read_at column by a column grant.
--    No INSERT / DELETE policy and no grant: only SECURITY DEFINER functions (owner) can create/delete rows.
-- -----------------------------------------------------------------------------
alter table public.notifications enable row level security;

revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 3. _notify (internal helper)
--    Inserts one notification per distinct recipient who really belongs to the household.
--    (user_id, dedupe_key) is UNIQUE, so repeating the same event never duplicates a notification.
-- -----------------------------------------------------------------------------
create or replace function public._notify(
  p_household_id uuid,
  p_user_ids     uuid[],
  p_type         text,
  p_task_id      uuid,
  p_asset_id     uuid,
  p_title        text,
  p_body         text,
  p_dedupe_key   text
)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  insert into public.notifications (household_id, user_id, type, task_id, asset_id, title, body, dedupe_key)
  select p_household_id, p.id, p_type, p_task_id, p_asset_id, p_title, p_body, p_dedupe_key
    from public.profiles p
   where p.household_id = p_household_id
     and p.id = any (p_user_ids)
  on conflict (user_id, dedupe_key) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public._notify(uuid, uuid[], text, uuid, uuid, text, text, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. complete_via_magic_token  — now notifies the task owner and the household ADMINs (MAGIC_COMPLETED)
--    Same body as Phase 1-2 plus the notification block. A PRIVATE task notifies its owner only,
--    so admins never learn the title of another member's private task.
-- -----------------------------------------------------------------------------
create or replace function public.complete_via_magic_token(
  p_token           text,
  p_idempotency_key text,
  p_request_hash    text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hash       text;
  v_mt         public.magic_tokens;
  v_actor      text;
  v_cached     jsonb;
  v_result     jsonb;
  v_title      text;
  v_owner      uuid;
  v_visibility public.visibility_type;
  v_asset_id   uuid;
  v_asset_name text;
  v_recipients uuid[];
begin
  if p_token is null or char_length(p_token) not between 16 and 512 then
    raise exception 'INVALID_TOKEN';
  end if;
  v_hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');

  -- LOCK 1: magic_tokens
  select * into v_mt from public.magic_tokens where token_hash = v_hash for update;
  if not found then
    raise exception 'INVALID_TOKEN';
  end if;
  v_actor := 'magic:' || v_mt.id::text;

  v_cached := public._claim_idempotency(v_mt.household_id, v_actor, p_idempotency_key, p_request_hash);
  if v_cached is not null then
    return v_cached;
  end if;

  if v_mt.consumed_at is not null then
    raise exception 'TOKEN_CONSUMED';
  end if;
  if v_mt.expires_at <= now() then
    raise exception 'TOKEN_EXPIRED';
  end if;

  -- LOCKS 2 & 3: tasks, task_rules (inside core)
  v_result := public._complete_task_core(
    v_mt.task_id, v_mt.household_id, v_actor, null, 'MAGIC_LINK_COMPLETED', p_idempotency_key);

  update public.magic_tokens set consumed_at = now() where id = v_mt.id;

  -- Notify only when THIS call really completed the task (not for "already completed").
  if coalesce((v_result ->> 'already_completed')::boolean, false) = false then
    select t.title, t.owner_id, t.visibility, t.asset_id, a.name
      into v_title, v_owner, v_visibility, v_asset_id, v_asset_name
      from public.tasks t
      left join public.assets a on a.id = t.asset_id
     where t.id = v_mt.task_id;

    v_recipients := array[v_owner];
    if v_visibility <> 'PRIVATE' then
      select coalesce(array_agg(distinct x), '{}')
        into v_recipients
        from (
          select unnest(v_recipients) as x
          union
          select id from public.profiles where household_id = v_mt.household_id and role = 'ADMIN'
        ) s;
    end if;

    perform public._notify(
      v_mt.household_id,
      v_recipients,
      'MAGIC_COMPLETED',
      v_mt.task_id,
      v_asset_id,
      '가족이 과업을 완료했어요',
      coalesce(v_asset_name || ' · ', '') || v_title,
      'magic:' || v_mt.id::text
    );
  end if;

  perform public._store_idempotency_response(v_mt.household_id, v_actor, p_idempotency_key, v_result);
  return v_result;
end;
$$;

revoke all on function public.complete_via_magic_token(text, text, text) from public, anon, authenticated;
grant execute on function public.complete_via_magic_token(text, text, text) to service_role;

-- -----------------------------------------------------------------------------
-- 5. accept_household_invite — now notifies the household ADMINs (INVITE_ACCEPTED)
-- -----------------------------------------------------------------------------
create or replace function public.accept_household_invite(
  p_code_hash    text,
  p_display_name text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  v_inv    public.household_invites;
  v_name   text := btrim(coalesce(p_display_name, ''));
  v_admins uuid[];
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if char_length(v_name) not between 1 and 50 then
    raise exception 'INVALID_DISPLAY_NAME' using errcode = '22023';
  end if;
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_INVITE' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'ALREADY_MEMBER' using errcode = '23505';
  end if;

  -- Row lock: two people racing for the same single-use code are serialized.
  select * into v_inv from public.household_invites where code_hash = p_code_hash for update;
  if not found then
    raise exception 'INVALID_INVITE' using errcode = '22023';
  end if;
  if v_inv.used_at is not null then
    raise exception 'INVITE_USED' using errcode = '22023';
  end if;
  if v_inv.expires_at <= now() then
    raise exception 'INVITE_EXPIRED' using errcode = '22023';
  end if;

  insert into public.profiles (id, household_id, role, display_name)
  values (v_uid, v_inv.household_id, 'MEMBER', v_name);

  update public.household_invites set used_at = now(), used_by = v_uid where id = v_inv.id;

  select coalesce(array_agg(id), '{}') into v_admins
    from public.profiles
   where household_id = v_inv.household_id and role = 'ADMIN';

  perform public._notify(
    v_inv.household_id,
    v_admins,
    'INVITE_ACCEPTED',
    null,
    null,
    '새 구성원이 참여했어요',
    v_name || '님이 가구에 참여했어요',
    'invite:' || v_inv.id::text
  );

  return v_inv.household_id;
end;
$$;

revoke all on function public.accept_household_invite(text, text) from public, anon;
grant execute on function public.accept_household_invite(text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Utility RPCs
-- -----------------------------------------------------------------------------

-- Marks one of the caller's own notifications as read. Returns false when it is not theirs / does not exist.
create or replace function public.mark_notification_read(p_notification_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_n   int;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  update public.notifications
     set read_at = coalesce(read_at, now())
   where id = p_notification_id and user_id = v_uid;

  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

-- Marks all of the caller's unread notifications as read. Returns how many changed.
create or replace function public.mark_all_notifications_read()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_n   int;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  update public.notifications
     set read_at = now()
   where user_id = v_uid and read_at is null;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Retention (global maintenance, scheduled job / service role only):
-- read more than 30 days ago, or created more than 90 days ago.
create or replace function public.cleanup_old_notifications()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n int;
begin
  delete from public.notifications
   where (read_at is not null and read_at < now() - interval '30 days')
      or created_at < now() - interval '90 days';

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.mark_notification_read(uuid)   from public, anon;
revoke all on function public.mark_all_notifications_read()  from public, anon;
revoke all on function public.cleanup_old_notifications()    from public, anon, authenticated;

grant execute on function public.mark_notification_read(uuid)  to authenticated;
grant execute on function public.mark_all_notifications_read() to authenticated;
grant execute on function public.cleanup_old_notifications()   to service_role;
