-- =============================================================================
-- MyLife Hub — backup/restore patch: rental columns on assets
--
-- Before: the backup export and restore_household_backup omitted the 9 rental columns, so a rental asset came
-- back as a regular one after backup -> restore. The app now exports them (backup.actions.ts COLUMNS.assets);
-- this redefines restore_household_backup (12's body, only the assets block changed) to read them back.
-- Old backups without the keys still restore: ownership_type -> 'OWNED', care_type -> 'NONE' (the column defaults),
-- the other rental fields -> NULL. CHECK constraints (ownership_type / care_type / billing_day) still apply and
-- reject a malformed file as a 22/23 error, rolling the whole restore back.
-- Idempotent: create or replace.
-- =============================================================================

begin;
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
    insert into public.assets (id, household_id, owner_id, visibility, name, space, category, preset_key, note, model_name,
                               ownership_type, rental_provider, monthly_fee, billing_day, contract_start_date,
                               obligation_end_date, ownership_transfer_date, care_type, payment_card_note, created_at)
    select r.id, v_hid, v_uid, coalesce(r.visibility, 'FAMILY'), r.name, r.space, r.category, r.preset_key, r.note, r.model_name,
           coalesce(r.ownership_type, 'OWNED'), r.rental_provider, r.monthly_fee, r.billing_day, r.contract_start_date,
           r.obligation_end_date, r.ownership_transfer_date, coalesce(r.care_type, 'NONE'), r.payment_card_note,
           coalesce(r.created_at, now())
      from jsonb_to_recordset(coalesce(p_payload -> 'assets', '[]'::jsonb))
           as r(id uuid, visibility public.visibility_type, name text, space text, category text,
                preset_key text, note text, model_name text,
                ownership_type text, rental_provider text, monthly_fee integer, billing_day integer,
                contract_start_date date, obligation_end_date date, ownership_transfer_date date,
                care_type text, payment_card_note text, created_at timestamptz)
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
