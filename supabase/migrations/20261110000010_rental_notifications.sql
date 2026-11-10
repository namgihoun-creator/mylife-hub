-- =============================================================================
-- MyLife Hub — Phase 3-3: rental obligation-expiry notifications
--   * notifications.type now accepts 'RENTAL_EXPIRING'
--   * generate_due_notifications() additionally scans RENTAL assets whose obligation_end_date is exactly
--     60 or 30 days away (Seoul calendar date) and notifies:
--       dedupe_key 'rental-expiring:<asset_id>:<obligation_end_date>:<remaining_days>'
--       title "[가전명] 렌탈 의무 약정 D-60" (or D-30)
--       body  "위약금 없는 환승 타이밍! 현재 유지 vs 신규 환승 비용을 비교해 보세요."
--     Recipients: PRIVATE asset -> its owner only; FAMILY asset -> every household member.
--   * claim_unsent_notifications() now also returns asset_id, so the push payload can deep-link to
--     /assets?openAssetId=<id>&tab=compare (the app builds the URL from type + asset_id).
-- The summary returned by generate_due_notifications() gains `rental_expiring` and `total` includes it.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Allow the new notification type (replace the CHECK, whatever it was named)
-- -----------------------------------------------------------------------------
do $$
declare
  c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.notifications'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%MAGIC_COMPLETED%'
  loop
    execute format('alter table public.notifications drop constraint %I', c.conname);
  end loop;

  alter table public.notifications
    add constraint notifications_type_check
    check (type in ('DUE_SOON', 'DUE_TODAY', 'OVERDUE', 'MAGIC_COMPLETED', 'INVITE_ACCEPTED', 'RENTAL_EXPIRING'));
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. generate_due_notifications — task due dates (unchanged from 0008) + rental obligation expiry
-- -----------------------------------------------------------------------------
create or replace function public.generate_due_notifications(p_household_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_today   date := (now() at time zone 'Asia/Seoul')::date;   -- Seoul calendar date (CLAUDE.md §4.C)
  v_soon    int := 0;
  v_due     int := 0;
  v_over    int := 0;
  v_rental  int := 0;
begin
  -- ---- task due dates: D-3 / D-Day / overdue -------------------------------------------------
  with targets as (
    select t.id,
           t.household_id,
           t.owner_id,
           t.visibility,
           t.asset_id,
           t.title,
           t.due_date,
           a.name as asset_name,
           case
             when t.due_date = v_today + 3 then 'DUE_SOON'
             when t.due_date = v_today     then 'DUE_TODAY'
             else 'OVERDUE'
           end as ntype
      from public.tasks t
      left join public.assets a on a.id = t.asset_id
     where t.status in ('PENDING', 'SNOOZED')
       and (t.due_date <= v_today or t.due_date = v_today + 3)
       and (p_household_id is null or t.household_id = p_household_id)
  ),
  ins as (
    insert into public.notifications (household_id, user_id, type, task_id, asset_id, title, body, dedupe_key)
    select tg.household_id,
           p.id,
           tg.ntype,
           tg.id,
           tg.asset_id,
           case tg.ntype
             when 'DUE_SOON'  then '곧 관리 시기가 돌아와요'
             when 'DUE_TODAY' then '오늘 할 관리가 있어요'
             else '기한이 지난 관리가 있어요'
           end,
           coalesce(tg.asset_name || ' · ', '') || tg.title ||
           case tg.ntype
             when 'DUE_SOON'  then ' — 3일 후 (' || to_char(tg.due_date, 'MM/DD') || ')'
             when 'DUE_TODAY' then ' — 오늘까지'
             else ' — ' || (v_today - tg.due_date)::text || '일 지났어요'
           end,
           case tg.ntype
             when 'DUE_SOON'  then 'due-soon:'
             when 'DUE_TODAY' then 'due-today:'
             else 'overdue:'
           end || tg.id::text || ':' || tg.due_date::text
      from targets tg
      join public.profiles p
        on p.household_id = tg.household_id
       and (tg.visibility = 'FAMILY' or p.id = tg.owner_id)
    on conflict (user_id, dedupe_key) do nothing
    returning type
  )
  select count(*) filter (where type = 'DUE_SOON'),
         count(*) filter (where type = 'DUE_TODAY'),
         count(*) filter (where type = 'OVERDUE')
    into v_soon, v_due, v_over
    from ins;

  -- ---- rental obligation expiry: exactly D-60 and D-30 -----------------------------------------
  with targets as (
    select a.id,
           a.household_id,
           a.owner_id,
           a.visibility,
           a.name,
           a.obligation_end_date,
           (a.obligation_end_date - v_today) as remaining_days
      from public.assets a
     where a.ownership_type = 'RENTAL'
       and a.obligation_end_date is not null
       and (a.obligation_end_date - v_today) in (60, 30)
       and (p_household_id is null or a.household_id = p_household_id)
  ),
  ins as (
    insert into public.notifications (household_id, user_id, type, task_id, asset_id, title, body, dedupe_key)
    select tg.household_id,
           p.id,
           'RENTAL_EXPIRING',
           null::uuid,
           tg.id,
           '[' || tg.name || '] 렌탈 의무 약정 D-' || tg.remaining_days::text,
           '위약금 없는 환승 타이밍! 현재 유지 vs 신규 환승 비용을 비교해 보세요.',
           'rental-expiring:' || tg.id::text || ':' || tg.obligation_end_date::text || ':' || tg.remaining_days::text
      from targets tg
      join public.profiles p
        on p.household_id = tg.household_id
       and (tg.visibility = 'FAMILY' or p.id = tg.owner_id)
    on conflict (user_id, dedupe_key) do nothing
    returning 1
  )
  select count(*) into v_rental from ins;

  return jsonb_build_object(
    'date', v_today,
    'due_soon', v_soon,
    'due_today', v_due,
    'overdue', v_over,
    'rental_expiring', v_rental,
    'total', v_soon + v_due + v_over + v_rental
  );
end;
$$;

revoke all on function public.generate_due_notifications(uuid) from public, anon, authenticated;
grant execute on function public.generate_due_notifications(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 3. claim_unsent_notifications — same behaviour as 0007, now also returning asset_id (push deep link)
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
    returning n.id, n.user_id, n.type, n.title, n.body, n.task_id, n.asset_id
  )
  select coalesce(jsonb_agg(to_jsonb(u)), '[]'::jsonb) into v_rows from u;

  return v_rows;
end;
$$;

revoke all on function public.claim_unsent_notifications(int, uuid[]) from public, anon, authenticated;
grant execute on function public.claim_unsent_notifications(int, uuid[]) to service_role;
