-- =============================================================================
-- MyLife Hub — Phase 1-2: Core RPC functions
--   calculate_next_due_date · complete_task_and_generate_next
--   skip_task_and_generate_next · complete_via_magic_token
-- Lock order (CLAUDE.md §4.B): magic_tokens -> tasks -> task_rules
-- All DB timestamps UTC; recurrence math in Asia/Seoul wall-clock.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Schema additions required by the RPCs
--    (new enum values are only referenced inside plpgsql bodies, i.e. at runtime)
-- -----------------------------------------------------------------------------
alter type public.task_status add value if not exists 'SKIPPED';
alter type public.event_type  add value if not exists 'TASK_SKIPPED';

alter table public.idempotency_keys add column if not exists request_hash text;

-- -----------------------------------------------------------------------------
-- 1. calculate_next_due_date
--    Wall-clock (Asia/Seoul) arithmetic, result converted back to UTC timestamptz.
--    MONTHLY / YEARLY: target day is clamped to the last day of the target month
--    (31 -> 28/29 in Feb, 30 in Apr/Jun/Sep/Nov). p_target_day NULL = keep current day.
--    Returns NULL for recurring_type NONE.
-- -----------------------------------------------------------------------------
create or replace function public.calculate_next_due_date(
  p_current_due    timestamptz,
  p_recurring_type public.recurring_type,
  p_interval       int,
  p_target_day     int default null
)
returns timestamptz
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_local       timestamp;
  v_month_start timestamp;
  v_last_day    int;
  v_day         int;
begin
  if p_current_due is null then
    raise exception 'p_current_due is required';
  end if;
  if p_recurring_type = 'NONE' then
    return null;
  end if;
  if p_interval is null or p_interval < 1 then
    raise exception 'p_interval must be >= 1';
  end if;
  if p_target_day is not null and p_target_day not between 1 and 31 then
    raise exception 'p_target_day must be between 1 and 31';
  end if;

  v_local := p_current_due at time zone 'Asia/Seoul';   -- wall-clock

  if p_recurring_type = 'DAILY' then
    return (v_local + make_interval(days => p_interval)) at time zone 'Asia/Seoul';
  elsif p_recurring_type = 'WEEKLY' then
    return (v_local + make_interval(days => 7 * p_interval)) at time zone 'Asia/Seoul';
  end if;

  -- MONTHLY / YEARLY
  v_month_start := date_trunc('month', v_local)
                   + make_interval(months => case p_recurring_type
                                               when 'YEARLY' then 12 * p_interval
                                               else p_interval
                                             end);
  v_last_day := extract(day from (v_month_start + interval '1 month' - interval '1 day'))::int;
  v_day      := least(coalesce(p_target_day, extract(day from v_local)::int), v_last_day);

  return (v_month_start
          + make_interval(days => v_day - 1)
          + (v_local - date_trunc('day', v_local))) at time zone 'Asia/Seoul';
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Internal helpers (not callable by API roles)
-- -----------------------------------------------------------------------------

-- Claims an idempotency key. Returns NULL when the key is newly claimed,
-- or the cached response when it was already processed. The unique index makes
-- concurrent callers with the same key wait for the first transaction to finish.
create or replace function public._claim_idempotency(
  p_household_id uuid,
  p_actor        text,
  p_key          text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id       uuid;
  v_hash     text;
  v_response jsonb;
begin
  if p_key is null or p_request_hash is null or p_request_hash = '' then
    raise exception 'IDEMPOTENCY_KEY_AND_REQUEST_HASH_REQUIRED' using errcode = '22023';
  end if;

  insert into public.idempotency_keys (household_id, actor_identifier, idempotency_key, request_hash)
  values (p_household_id, p_actor, p_key, p_request_hash)
  on conflict (household_id, actor_identifier, idempotency_key) do nothing
  returning id into v_id;

  if v_id is not null then
    return null;
  end if;

  select request_hash, response into v_hash, v_response
    from public.idempotency_keys
   where household_id = p_household_id
     and actor_identifier = p_actor
     and idempotency_key = p_key;

  if v_hash is distinct from p_request_hash then
    raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023';
  end if;
  return coalesce(v_response, '{}'::jsonb);
end;
$$;

create or replace function public._store_idempotency_response(
  p_household_id uuid,
  p_actor        text,
  p_key          text,
  p_response     jsonb
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.idempotency_keys
     set response = p_response
   where household_id = p_household_id
     and actor_identifier = p_actor
     and idempotency_key = p_key;
$$;

-- Inserts the next recurring instance (iteration_no + 1). Caller already holds the
-- task and rule row locks. (rule_id, iteration_no) UNIQUE makes this duplicate-safe.
create or replace function public._insert_next_task(
  p_task     public.tasks,
  p_rule     public.task_rules,
  p_base_due timestamptz,
  p_day      int
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_next timestamptz;
  v_id   uuid;
begin
  v_next := public.calculate_next_due_date(p_base_due, p_rule.recurring_type, p_rule.interval_n, p_day);
  if v_next is null then
    return null;
  end if;

  insert into public.tasks (
    household_id, owner_id, visibility, asset_id, rule_id,
    iteration_no, title, due_date, status
  ) values (
    p_task.household_id, p_task.owner_id, p_task.visibility, p_task.asset_id, p_task.rule_id,
    p_task.iteration_no + 1, p_task.title, (v_next at time zone 'Asia/Seoul')::date, 'PENDING'
  )
  on conflict (rule_id, iteration_no) do nothing
  returning id into v_id;

  update public.task_rules
     set next_iteration_no = greatest(next_iteration_no, p_task.iteration_no + 2)
   where id = p_rule.id;

  return v_id;
end;
$$;

-- Shared completion core. Caller must already hold any upstream locks
-- (magic_tokens). Locks tasks, then task_rules.
-- p_actor_uid: set for logged-in callers (visibility check); NULL for magic link.
create or replace function public._complete_task_core(
  p_task_id         uuid,
  p_household_id    uuid,
  p_actor           text,
  p_actor_uid       uuid,
  p_event           public.event_type,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_task    public.tasks;
  v_rule    public.task_rules;
  v_now     timestamptz := now();
  v_next_id uuid;
  v_base    timestamptz;
  v_day     int;
begin
  -- LOCK 2: tasks
  select * into v_task
    from public.tasks
   where id = p_task_id and household_id = p_household_id
     for update;

  if not found
     or (p_actor_uid is not null and v_task.visibility = 'PRIVATE' and v_task.owner_id <> p_actor_uid) then
    raise exception 'TASK_NOT_FOUND';
  end if;

  if v_task.status = 'COMPLETED' then
    return jsonb_build_object(
      'task_id', v_task.id, 'status', 'COMPLETED', 'completed_at', v_task.completed_at,
      'next_task_id', null, 'already_completed', true);
  end if;
  if v_task.status not in ('PENDING', 'SNOOZED') then
    raise exception 'TASK_NOT_ACTIONABLE';   -- SKIPPED / CANCELLED can never be completed
  end if;

  -- LOCK 3: task_rules
  if v_task.rule_id is not null then
    select * into v_rule from public.task_rules where id = v_task.rule_id for update;
  end if;

  update public.tasks
     set status = 'COMPLETED', completed_at = v_now, snoozed_until = null
   where id = v_task.id;

  insert into public.event_logs (
    household_id, owner_id, visibility, task_id, asset_id,
    event_type, actor_identifier, idempotency_key, payload
  ) values (
    v_task.household_id, v_task.owner_id, v_task.visibility, v_task.id, v_task.asset_id,
    p_event, p_actor, p_idempotency_key,
    jsonb_build_object('completed_at', v_now, 'iteration_no', v_task.iteration_no)
  );

  if v_task.rule_id is not null and v_rule.id is not null
     and v_rule.active and v_rule.recurring_type <> 'NONE' then
    if v_rule.anchor = 'COMPLETION_DATE' then
      v_base := ((v_now at time zone 'Asia/Seoul')::date)::timestamp at time zone 'Asia/Seoul';
      v_day  := null;
    else
      v_base := v_task.due_date::timestamp at time zone 'Asia/Seoul';
      v_day  := v_rule.day_of_month;
    end if;
    v_next_id := public._insert_next_task(v_task, v_rule, v_base, v_day);
  end if;

  return jsonb_build_object(
    'task_id', v_task.id, 'status', 'COMPLETED', 'completed_at', v_now,
    'next_task_id', v_next_id, 'already_completed', false);
end;
$$;

revoke all on function public._claim_idempotency(uuid, text, text, text)                              from public, anon, authenticated;
revoke all on function public._store_idempotency_response(uuid, text, text, jsonb)                    from public, anon, authenticated;
revoke all on function public._insert_next_task(public.tasks, public.task_rules, timestamptz, int)   from public, anon, authenticated;
revoke all on function public._complete_task_core(uuid, uuid, text, uuid, public.event_type, text)   from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. complete_task_and_generate_next  (logged-in users)
--    Atomic: [task COMPLETED] + [event log] + [next task] + [idempotency cache]
-- -----------------------------------------------------------------------------
create or replace function public.complete_task_and_generate_next(
  p_task_id         uuid,
  p_idempotency_key text,
  p_request_hash    text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  v_hid    uuid;
  v_actor  text;
  v_cached jsonb;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  v_hid := public.current_household_id();
  if v_hid is null then
    raise exception 'NO_HOUSEHOLD' using errcode = '28000';
  end if;
  v_actor := 'user:' || v_uid::text;

  v_cached := public._claim_idempotency(v_hid, v_actor, p_idempotency_key, p_request_hash);
  if v_cached is not null then
    return v_cached;
  end if;

  v_result := public._complete_task_core(
    p_task_id, v_hid, v_actor, v_uid, 'TASK_COMPLETED', p_idempotency_key);

  perform public._store_idempotency_response(v_hid, v_actor, p_idempotency_key, v_result);
  return v_result;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. skip_task_and_generate_next  (recurring tasks only)
--    Task -> SKIPPED (final, can never be completed). Next instance is derived
--    from the ORIGINAL due date, regardless of the rule's anchor setting.
-- -----------------------------------------------------------------------------
create or replace function public.skip_task_and_generate_next(
  p_task_id         uuid,
  p_idempotency_key text,
  p_request_hash    text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_hid     uuid;
  v_actor   text;
  v_cached  jsonb;
  v_task    public.tasks;
  v_rule    public.task_rules;
  v_now     timestamptz := now();
  v_next_id uuid;
  v_result  jsonb;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  v_hid := public.current_household_id();
  if v_hid is null then
    raise exception 'NO_HOUSEHOLD' using errcode = '28000';
  end if;
  v_actor := 'user:' || v_uid::text;

  v_cached := public._claim_idempotency(v_hid, v_actor, p_idempotency_key, p_request_hash);
  if v_cached is not null then
    return v_cached;
  end if;

  -- LOCK 1 (tasks)
  select * into v_task
    from public.tasks
   where id = p_task_id and household_id = v_hid
     for update;

  if not found or (v_task.visibility = 'PRIVATE' and v_task.owner_id <> v_uid) then
    raise exception 'TASK_NOT_FOUND';
  end if;
  if v_task.rule_id is null then
    raise exception 'TASK_NOT_RECURRING';
  end if;

  if v_task.status = 'SKIPPED' then
    v_result := jsonb_build_object('task_id', v_task.id, 'status', 'SKIPPED',
                                   'next_task_id', null, 'already_skipped', true);
    perform public._store_idempotency_response(v_hid, v_actor, p_idempotency_key, v_result);
    return v_result;
  end if;
  if v_task.status not in ('PENDING', 'SNOOZED') then
    raise exception 'TASK_NOT_ACTIONABLE';   -- COMPLETED / CANCELLED
  end if;

  -- LOCK 2 (task_rules)
  select * into v_rule from public.task_rules where id = v_task.rule_id for update;

  update public.tasks
     set status = 'SKIPPED', snoozed_until = null
   where id = v_task.id;

  insert into public.event_logs (
    household_id, owner_id, visibility, task_id, asset_id,
    event_type, actor_identifier, idempotency_key, payload
  ) values (
    v_task.household_id, v_task.owner_id, v_task.visibility, v_task.id, v_task.asset_id,
    'TASK_SKIPPED', v_actor, p_idempotency_key,
    jsonb_build_object('skipped_at', v_now, 'iteration_no', v_task.iteration_no)
  );

  if v_rule.id is not null and v_rule.active and v_rule.recurring_type <> 'NONE' then
    v_next_id := public._insert_next_task(
      v_task, v_rule, v_task.due_date::timestamp at time zone 'Asia/Seoul', v_rule.day_of_month);
  end if;

  v_result := jsonb_build_object('task_id', v_task.id, 'status', 'SKIPPED',
                                 'next_task_id', v_next_id, 'already_skipped', false);
  perform public._store_idempotency_response(v_hid, v_actor, p_idempotency_key, v_result);
  return v_result;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. complete_via_magic_token  (non-logged-in family link; POST only)
--    Lock order: magic_tokens -> tasks -> task_rules. Only the SHA-256 hash of the
--    token is ever compared/stored. Token is consumed in the same transaction.
--    Replays of the same idempotency key return the cached result even after the
--    token has been consumed.
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
  v_hash   text;
  v_mt     public.magic_tokens;
  v_actor  text;
  v_cached jsonb;
  v_result jsonb;
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

  perform public._store_idempotency_response(v_mt.household_id, v_actor, p_idempotency_key, v_result);
  return v_result;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Privileges
--    complete/skip: logged-in users only.
--    complete_via_magic_token: service_role only (called from the Next.js API route
--    with the service-role key, so the token endpoint is not exposed via PostgREST).
-- -----------------------------------------------------------------------------
revoke all on function public.calculate_next_due_date(timestamptz, public.recurring_type, int, int)  from public, anon;
revoke all on function public.complete_task_and_generate_next(uuid, text, text)                       from public, anon;
revoke all on function public.skip_task_and_generate_next(uuid, text, text)                           from public, anon;
revoke all on function public.complete_via_magic_token(text, text, text)                              from public, anon, authenticated;

grant execute on function public.calculate_next_due_date(timestamptz, public.recurring_type, int, int) to authenticated, service_role;
grant execute on function public.complete_task_and_generate_next(uuid, text, text)                     to authenticated;
grant execute on function public.skip_task_and_generate_next(uuid, text, text)                         to authenticated;
grant execute on function public.complete_via_magic_token(text, text, text)                            to service_role;
