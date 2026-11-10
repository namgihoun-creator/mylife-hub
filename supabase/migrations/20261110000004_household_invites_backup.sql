-- =============================================================================
-- MyLife Hub — Phase 1-5: household invitations + JSON backup restore
--   household_invites (hash-only, single-use, expiring)
--   create_household_invite · get_invite_preview · accept_household_invite
--   restore_household_backup (atomic, idempotent merge)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Invitations (same hashing model as magic_tokens: the raw code never reaches the DB)
-- -----------------------------------------------------------------------------
create table if not exists public.household_invites (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  code_hash    text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  created_by   uuid references public.profiles (id) on delete set null,
  expires_at   timestamptz not null,
  used_at      timestamptz,
  used_by      uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists household_invites_household_idx on public.household_invites (household_id, expires_at);

alter table public.household_invites enable row level security;   -- no policies = closed to clients
revoke all on public.household_invites from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. create_household_invite  (ADMIN only)
-- -----------------------------------------------------------------------------
create or replace function public.create_household_invite(
  p_code_hash  text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  v_hid    uuid;
  v_active int;
  v_id     uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  v_hid := public.current_household_id();
  if v_hid is null or not public.is_household_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_CODE_HASH' using errcode = '22023';
  end if;
  if p_expires_at is null or p_expires_at <= now() or p_expires_at > now() + interval '30 days' then
    raise exception 'INVALID_EXPIRY' using errcode = '22023';
  end if;

  select count(*) into v_active
    from public.household_invites
   where household_id = v_hid and used_at is null and expires_at > now();
  if v_active >= 20 then
    raise exception 'TOO_MANY_INVITES' using errcode = '54000';
  end if;

  insert into public.household_invites (household_id, code_hash, created_by, expires_at)
  values (v_hid, p_code_hash, v_uid, p_expires_at)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'expires_at', p_expires_at);
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. get_invite_preview  (read-only; callable before login so the page can show the household name)
--    Collapses unknown codes into INVALID. Codes are 256-bit random, so guessing is infeasible.
-- -----------------------------------------------------------------------------
create or replace function public.get_invite_preview(p_code_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_inv  public.household_invites;
  v_name text;
begin
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'INVALID');
  end if;

  select * into v_inv from public.household_invites where code_hash = p_code_hash;
  if not found then
    return jsonb_build_object('status', 'INVALID');
  end if;
  if v_inv.used_at is not null then
    return jsonb_build_object('status', 'USED');
  end if;
  if v_inv.expires_at <= now() then
    return jsonb_build_object('status', 'EXPIRED');
  end if;

  select name into v_name from public.households where id = v_inv.household_id;
  return jsonb_build_object('status', 'ACTIVE', 'household_name', v_name, 'expires_at', v_inv.expires_at);
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. accept_household_invite  (logged-in user without a household; single-use)
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
  v_uid  uuid := auth.uid();
  v_inv  public.household_invites;
  v_name text := btrim(coalesce(p_display_name, ''));
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

  return v_inv.household_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. restore_household_backup  (ADMIN only; one transaction; idempotent merge)
--    * Rows are forced into the caller's household and owned by the caller.
--    * Original ids are kept and conflicts are skipped (ON CONFLICT DO NOTHING), so restoring the
--      same file twice changes nothing; ids that exist in ANOTHER household are skipped, never taken over.
--    * References to assets/rules/tasks that are not in the caller's household are nulled out.
--    * Secrets (magic tokens, idempotency keys, invites) are never part of a backup.
-- -----------------------------------------------------------------------------
create or replace function public.restore_household_backup(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_hid uuid;
  k     text;
  v_max int;
  n_assets  int := 0;
  n_rules   int := 0;
  n_tasks   int := 0;
  n_events  int := 0;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  v_hid := public.current_household_id();
  if v_hid is null or not public.is_household_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  if p_payload is null
     or jsonb_typeof(p_payload) <> 'object'
     or (p_payload ->> 'version') is distinct from '1' then
    raise exception 'INVALID_BACKUP' using errcode = '22023';
  end if;

  foreach k in array array['assets', 'task_rules', 'tasks', 'event_logs'] loop
    if p_payload ? k then
      if jsonb_typeof(p_payload -> k) <> 'array' then
        raise exception 'INVALID_BACKUP' using errcode = '22023';
      end if;
      -- (computed first: a CASE ... THEN inside an IF condition confuses the PL/pgSQL parser)
      v_max := case k when 'event_logs' then 20000 else 5000 end;
      if jsonb_array_length(p_payload -> k) > v_max then
        raise exception 'BACKUP_TOO_LARGE' using errcode = '54000';
      end if;
    end if;
  end loop;

  -- Serialize concurrent restores of the same household.
  perform pg_advisory_xact_lock(hashtextextended('restore:' || v_hid::text, 0));

  -- assets
  with ins as (
    insert into public.assets (id, household_id, owner_id, visibility, name, space, category, preset_key, note, created_at)
    select r.id, v_hid, v_uid, coalesce(r.visibility, 'FAMILY'), r.name, r.space, r.category, r.preset_key, r.note,
           coalesce(r.created_at, now())
      from jsonb_to_recordset(coalesce(p_payload -> 'assets', '[]'::jsonb))
           as r(id uuid, visibility public.visibility_type, name text, space text, category text,
                preset_key text, note text, created_at timestamptz)
    on conflict do nothing
    returning 1
  )
  select count(*) into n_assets from ins;

  -- task_rules
  with ins as (
    insert into public.task_rules (id, household_id, owner_id, visibility, asset_id, title, recurring_type,
                                   interval_n, anchor, day_of_month, timezone, next_iteration_no, active, created_at)
    select r.id, v_hid, v_uid, coalesce(r.visibility, 'FAMILY'),
           case when exists (select 1 from public.assets a where a.id = r.asset_id and a.household_id = v_hid)
                then r.asset_id end,
           r.title, coalesce(r.recurring_type, 'NONE'), coalesce(r.interval_n, 1), coalesce(r.anchor, 'DUE_DATE'),
           r.day_of_month, coalesce(r.timezone, 'Asia/Seoul'), coalesce(r.next_iteration_no, 1),
           coalesce(r.active, true), coalesce(r.created_at, now())
      from jsonb_to_recordset(coalesce(p_payload -> 'task_rules', '[]'::jsonb))
           as r(id uuid, visibility public.visibility_type, asset_id uuid, title text,
                recurring_type public.recurring_type, interval_n int, anchor public.anchor_type,
                day_of_month smallint, timezone text, next_iteration_no int, active boolean, created_at timestamptz)
    on conflict do nothing
    returning 1
  )
  select count(*) into n_rules from ins;

  -- tasks
  with ins as (
    insert into public.tasks (id, household_id, owner_id, visibility, asset_id, rule_id, iteration_no, title,
                              due_date, status, completed_at, snoozed_until, created_at)
    select r.id, v_hid, v_uid, coalesce(r.visibility, 'FAMILY'),
           case when exists (select 1 from public.assets a where a.id = r.asset_id and a.household_id = v_hid)
                then r.asset_id end,
           case when exists (select 1 from public.task_rules tr where tr.id = r.rule_id and tr.household_id = v_hid)
                then r.rule_id end,
           r.iteration_no, r.title, r.due_date, coalesce(r.status, 'PENDING'), r.completed_at, r.snoozed_until,
           coalesce(r.created_at, now())
      from jsonb_to_recordset(coalesce(p_payload -> 'tasks', '[]'::jsonb))
           as r(id uuid, visibility public.visibility_type, asset_id uuid, rule_id uuid, iteration_no int,
                title text, due_date date, status public.task_status, completed_at timestamptz,
                snoozed_until date, created_at timestamptz)
    on conflict do nothing
    returning 1
  )
  select count(*) into n_tasks from ins;

  -- event_logs (completion history). Idempotency keys are dropped on purpose.
  with ins as (
    insert into public.event_logs (id, household_id, owner_id, visibility, task_id, asset_id, event_type,
                                   actor_identifier, idempotency_key, payload, created_at)
    select r.id, v_hid, v_uid, coalesce(r.visibility, 'FAMILY'),
           case when exists (select 1 from public.tasks t where t.id = r.task_id and t.household_id = v_hid)
                then r.task_id end,
           case when exists (select 1 from public.assets a where a.id = r.asset_id and a.household_id = v_hid)
                then r.asset_id end,
           r.event_type, coalesce(r.actor_identifier, 'restore'), null, coalesce(r.payload, '{}'::jsonb),
           coalesce(r.created_at, now())
      from jsonb_to_recordset(coalesce(p_payload -> 'event_logs', '[]'::jsonb))
           as r(id uuid, visibility public.visibility_type, task_id uuid, asset_id uuid, event_type public.event_type,
                actor_identifier text, payload jsonb, created_at timestamptz)
    on conflict do nothing
    returning 1
  )
  select count(*) into n_events from ins;

  return jsonb_build_object(
    'assets',     jsonb_build_object('inserted', n_assets, 'total', jsonb_array_length(coalesce(p_payload -> 'assets', '[]'::jsonb))),
    'task_rules', jsonb_build_object('inserted', n_rules,  'total', jsonb_array_length(coalesce(p_payload -> 'task_rules', '[]'::jsonb))),
    'tasks',      jsonb_build_object('inserted', n_tasks,  'total', jsonb_array_length(coalesce(p_payload -> 'tasks', '[]'::jsonb))),
    'event_logs', jsonb_build_object('inserted', n_events, 'total', jsonb_array_length(coalesce(p_payload -> 'event_logs', '[]'::jsonb)))
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Privileges
-- -----------------------------------------------------------------------------
revoke all on function public.create_household_invite(text, timestamptz)   from public, anon;
revoke all on function public.get_invite_preview(text)                     from public;
revoke all on function public.accept_household_invite(text, text)          from public, anon;
revoke all on function public.restore_household_backup(jsonb)              from public, anon;

grant execute on function public.create_household_invite(text, timestamptz) to authenticated;
grant execute on function public.get_invite_preview(text)                   to anon, authenticated;
grant execute on function public.accept_household_invite(text, text)        to authenticated;
grant execute on function public.restore_household_backup(jsonb)            to authenticated;
