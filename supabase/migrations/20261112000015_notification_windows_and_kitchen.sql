-- =============================================================================
-- MyLife Hub — notification windows + kitchen expiry alerts
--
--   * Appliance / rental / consumable tasks: DUE_SOON now covers the WHOLE window D-7 … D-1 (it used to fire only on exactly D-3,
--     so a task created or re-scheduled inside the window was never announced). One alert per (task, due_date) — the dedupe key is
--     unchanged ('due-soon:<task>:<due_date>'), so a task alerts once when it first enters the window. Body: "N일 후 (MM/DD)".
--     DUE_TODAY (D-Day) and OVERDUE are unchanged.
--   * Kitchen: NEW type KITCHEN_EXPIRING — an ingredient whose expire_date is within D-3 … D-Day, plus "expired yesterday" (D+1),
--     alerts every household member once per (item, expire_date): dedupe 'kitchen-expiring:<item>:<expire_date>'.
--     Kitchen stock is a shared household resource, so there is no PRIVATE visibility: all members are notified.
--   * notifications.kitchen_item_id (nullable FK, on delete set null) = deep-link target (/kitchen?focus=<id>).
--   * claim_unsent_notifications() also returns kitchen_item_id, so push notifications deep-link like the bell does.
--   * Rental obligation expiry (D-60 / D-30) is unchanged.
-- generate_due_notifications() stays service_role only; the summary gains `kitchen_expiring` and `total` includes it.
-- Idempotent: safe to run more than once.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Column + allowed type
-- -----------------------------------------------------------------------------
alter table public.notifications
  add column if not exists kitchen_item_id uuid references public.kitchen_items (id) on delete set null;

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
    check (type in ('DUE_SOON', 'DUE_TODAY', 'OVERDUE', 'MAGIC_COMPLETED', 'INVITE_ACCEPTED', 'RENTAL_EXPIRING', 'KITCHEN_EXPIRING'));
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. generate_due_notifications
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
  v_kitchen int := 0;
begin
  -- ---- task due dates: D-7…D-1 / D-Day / overdue -----------------------------------------------
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
             when t.due_date > v_today then 'DUE_SOON'
             when t.due_date = v_today then 'DUE_TODAY'
             else 'OVERDUE'
           end as ntype
      from public.tasks t
      left join public.assets a on a.id = t.asset_id
     where t.status in ('PENDING', 'SNOOZED')
       and t.due_date <= v_today + 7
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
             when 'DUE_SOON'  then ' — ' || (tg.due_date - v_today)::text || '일 후 (' || to_char(tg.due_date, 'MM/DD') || ')'
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

  -- ---- rental obligation expiry: exactly D-60 and D-30 (unchanged) -------------------------------
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

  -- ---- kitchen: ingredients expiring within D-3 … D-Day (+ expired yesterday) ----------------------
  with targets as (
    select k.id,
           k.household_id,
           k.name,
           k.amount,
           k.expire_date,
           (k.expire_date - v_today) as days_left
      from public.kitchen_items k
     where k.expire_date between v_today - 1 and v_today + 3
       and (p_household_id is null or k.household_id = p_household_id)
  ),
  ins as (
    insert into public.notifications (household_id, user_id, type, task_id, asset_id, kitchen_item_id, title, body, dedupe_key)
    select tg.household_id,
           p.id,
           'KITCHEN_EXPIRING',
           null::uuid,
           null::uuid,
           tg.id,
           case when tg.days_left < 0 then '소비기한이 지난 재료가 있어요' else '소비기한이 임박한 재료가 있어요' end,
           tg.name || ' (' || tg.amount || ')' ||
           case
             when tg.days_left < 0 then ' — ' || (-tg.days_left)::text || '일 지났어요'
             when tg.days_left = 0 then ' — 오늘까지'
             else ' — ' || tg.days_left::text || '일 후 (' || to_char(tg.expire_date, 'MM/DD') || ')'
           end,
           'kitchen-expiring:' || tg.id::text || ':' || tg.expire_date::text
      from targets tg
      join public.profiles p on p.household_id = tg.household_id   -- shared stock: every member
    on conflict (user_id, dedupe_key) do nothing
    returning 1
  )
  select count(*) into v_kitchen from ins;

  return jsonb_build_object(
    'date', v_today,
    'due_soon', v_soon,
    'due_today', v_due,
    'overdue', v_over,
    'rental_expiring', v_rental,
    'kitchen_expiring', v_kitchen,
    'total', v_soon + v_due + v_over + v_rental + v_kitchen
  );
end;
$$;

revoke all on function public.generate_due_notifications(uuid) from public, anon, authenticated;
grant execute on function public.generate_due_notifications(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 3. claim_unsent_notifications — as before, now also returning kitchen_item_id (push deep link)
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
    returning n.id, n.user_id, n.type, n.title, n.body, n.task_id, n.asset_id, n.kitchen_item_id
  )
  select coalesce(jsonb_agg(to_jsonb(u)), '[]'::jsonb) into v_rows from u;

  return v_rows;
end;
$$;

revoke all on function public.claim_unsent_notifications(int, uuid[]) from public, anon, authenticated;
grant execute on function public.claim_unsent_notifications(int, uuid[]) to service_role;

commit;
