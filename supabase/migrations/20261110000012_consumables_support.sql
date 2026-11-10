-- =============================================================================
-- MyLife Hub — Track C: 소모품 원클릭 구매 / 최저가 검색
--   * assets.model_name                       : 가전 모델명 (검색어 조합용)
--   * task_rules / tasks : consumable_name, consumable_model, custom_purchase_url
--       (참고: 이 프로젝트의 규칙 테이블 이름은 task_rules 이다 — maintenance_rules 는 없다)
--   * _insert_next_task  : 다음 회차 과업 생성 시 규칙의 소모품 정보를 복사 (완료/건너뛰기 RPC가 모두 이 함수를 사용)
--   * set_rule_consumable: 규칙 + 열린 과업(PENDING/SNOOZED)의 소모품 정보를 한 트랜잭션으로 갱신 (SECURITY INVOKER → RLS 적용)
--   * restore_household_backup: 백업 복구가 새 컬럼도 복원하도록 갱신 (내보내기 컬럼은 앱 코드에서 확장)
-- 멱등: 여러 번 실행해도 안전.
-- =============================================================================

begin;

-- 1. Columns + constraints -----------------------------------------------------
alter table public.assets
  add column if not exists model_name text;

alter table public.task_rules
  add column if not exists consumable_name    text,
  add column if not exists consumable_model   text,
  add column if not exists custom_purchase_url text;

alter table public.tasks
  add column if not exists consumable_name    text,
  add column if not exists consumable_model   text,
  add column if not exists custom_purchase_url text;

do $$
declare t text;
begin
  if not exists (select 1 from pg_constraint where conname = 'assets_model_name_len') then
    alter table public.assets add constraint assets_model_name_len check (model_name is null or char_length(model_name) between 1 and 100);
  end if;
  foreach t in array array['task_rules', 'tasks'] loop
    if not exists (select 1 from pg_constraint where conname = t || '_consumable_name_len') then
      execute format('alter table public.%I add constraint %I check (consumable_name is null or char_length(consumable_name) between 1 and 100)', t, t || '_consumable_name_len');
    end if;
    if not exists (select 1 from pg_constraint where conname = t || '_consumable_model_len') then
      execute format('alter table public.%I add constraint %I check (consumable_model is null or char_length(consumable_model) between 1 and 100)', t, t || '_consumable_model_len');
    end if;
    -- http(s) only, no whitespace, <= 2048 chars (blocks javascript:/data: URLs at the data layer)
    if not exists (select 1 from pg_constraint where conname = t || '_purchase_url_http') then
      execute format('alter table public.%I add constraint %I check (custom_purchase_url is null or (char_length(custom_purchase_url) <= 2048 and custom_purchase_url ~* %L))', t, t || '_purchase_url_http', '^https?://[^[:space:]]+$');
    end if;
  end loop;
end $$;

-- 2. Next occurrence inherits the rule's consumable info -----------------------
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
as $fn$
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
    iteration_no, title, due_date, status,
    consumable_name, consumable_model, custom_purchase_url
  ) values (
    p_task.household_id, p_task.owner_id, p_task.visibility, p_task.asset_id, p_task.rule_id,
    p_task.iteration_no + 1, p_task.title, (v_next at time zone 'Asia/Seoul')::date, 'PENDING',
    p_rule.consumable_name, p_rule.consumable_model, p_rule.custom_purchase_url
  )
  on conflict (rule_id, iteration_no) do nothing
  returning id into v_id;

  update public.task_rules
     set next_iteration_no = greatest(next_iteration_no, p_task.iteration_no + 2)
   where id = p_rule.id;

  return v_id;
end;
$fn$;

-- 3. Atomic rule + open-task consumable update ---------------------------------
create or replace function public.set_rule_consumable(
  p_rule_id uuid,
  p_name    text,
  p_model   text,
  p_url     text
)
returns integer            -- number of open tasks updated
language plpgsql
security invoker           -- RLS decides who may update (ADMIN, visible rows only)
set search_path = public, pg_temp
as $fn$
declare
  v_rules int;
  v_tasks int;
begin
  update public.task_rules
     set consumable_name = nullif(btrim(p_name), ''),
         consumable_model = nullif(btrim(p_model), ''),
         custom_purchase_url = nullif(btrim(p_url), ''),
         updated_at = now()
   where id = p_rule_id;
  get diagnostics v_rules = row_count;
  if v_rules = 0 then
    raise exception 'RULE_NOT_FOUND_OR_FORBIDDEN' using errcode = '42501';
  end if;

  update public.tasks
     set consumable_name = nullif(btrim(p_name), ''),
         consumable_model = nullif(btrim(p_model), ''),
         custom_purchase_url = nullif(btrim(p_url), '')
   where rule_id = p_rule_id
     and status in ('PENDING', 'SNOOZED');
  get diagnostics v_tasks = row_count;
  return v_tasks;
end;
$fn$;

revoke all on function public.set_rule_consumable(uuid, text, text, text) from public, anon;
grant execute on function public.set_rule_consumable(uuid, text, text, text) to authenticated;

-- 4. Backup restore keeps the new columns --------------------------------------
create or replace function public.restore_household_backup(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
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
    insert into public.assets (id, household_id, owner_id, visibility, name, space, category, preset_key, note, model_name, created_at)
    select r.id, v_hid, v_uid, coalesce(r.visibility, 'FAMILY'), r.name, r.space, r.category, r.preset_key, r.note, r.model_name,
           coalesce(r.created_at, now())
      from jsonb_to_recordset(coalesce(p_payload -> 'assets', '[]'::jsonb))
           as r(id uuid, visibility public.visibility_type, name text, space text, category text,
                preset_key text, note text, model_name text, created_at timestamptz)
    on conflict do nothing
    returning 1
  )
  select count(*) into n_assets from ins;

  -- task_rules
  with ins as (
    insert into public.task_rules (id, household_id, owner_id, visibility, asset_id, title, recurring_type,
                                   interval_n, anchor, day_of_month, timezone, next_iteration_no, active,
                                   consumable_name, consumable_model, custom_purchase_url, created_at)
    select r.id, v_hid, v_uid, coalesce(r.visibility, 'FAMILY'),
           case when exists (select 1 from public.assets a where a.id = r.asset_id and a.household_id = v_hid)
                then r.asset_id end,
           r.title, coalesce(r.recurring_type, 'NONE'), coalesce(r.interval_n, 1), coalesce(r.anchor, 'DUE_DATE'),
           r.day_of_month, coalesce(r.timezone, 'Asia/Seoul'), coalesce(r.next_iteration_no, 1),
           coalesce(r.active, true), r.consumable_name, r.consumable_model, r.custom_purchase_url, coalesce(r.created_at, now())
      from jsonb_to_recordset(coalesce(p_payload -> 'task_rules', '[]'::jsonb))
           as r(id uuid, visibility public.visibility_type, asset_id uuid, title text,
                recurring_type public.recurring_type, interval_n int, anchor public.anchor_type,
                day_of_month smallint, timezone text, next_iteration_no int, active boolean,
                consumable_name text, consumable_model text, custom_purchase_url text, created_at timestamptz)
    on conflict do nothing
    returning 1
  )
  select count(*) into n_rules from ins;

  -- tasks
  with ins as (
    insert into public.tasks (id, household_id, owner_id, visibility, asset_id, rule_id, iteration_no, title,
                              due_date, status, completed_at, snoozed_until,
                              consumable_name, consumable_model, custom_purchase_url, created_at)
    select r.id, v_hid, v_uid, coalesce(r.visibility, 'FAMILY'),
           case when exists (select 1 from public.assets a where a.id = r.asset_id and a.household_id = v_hid)
                then r.asset_id end,
           case when exists (select 1 from public.task_rules tr where tr.id = r.rule_id and tr.household_id = v_hid)
                then r.rule_id end,
           r.iteration_no, r.title, r.due_date, coalesce(r.status, 'PENDING'), r.completed_at, r.snoozed_until,
           r.consumable_name, r.consumable_model, r.custom_purchase_url, coalesce(r.created_at, now())
      from jsonb_to_recordset(coalesce(p_payload -> 'tasks', '[]'::jsonb))
           as r(id uuid, visibility public.visibility_type, asset_id uuid, rule_id uuid, iteration_no int,
                title text, due_date date, status public.task_status, completed_at timestamptz,
                snoozed_until date, consumable_name text, consumable_model text, custom_purchase_url text,
                created_at timestamptz)
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
$fn$;

commit;
