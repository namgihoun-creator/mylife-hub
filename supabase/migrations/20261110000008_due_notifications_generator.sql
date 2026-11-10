-- =============================================================================
-- MyLife Hub — Phase 2-4: due-date notification generator
-- generate_due_notifications(): scans open tasks against the Seoul calendar date and creates
--   D-3  -> DUE_SOON   (dedupe 'due-soon:<task>:<due_date>')
--   D-0  -> DUE_TODAY  (dedupe 'due-today:<task>:<due_date>')
--   past -> OVERDUE    (dedupe 'overdue:<task>:<due_date>')
-- Recipients: PRIVATE task -> its owner only; FAMILY task -> every member of the household.
-- Idempotent: (user_id, dedupe_key) is UNIQUE, so re-running creates nothing new. Because due_date is part of the
-- key, a task that is snoozed / re-scheduled gets a fresh alert for its new date.
-- =============================================================================

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
begin
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

  return jsonb_build_object(
    'date', v_today,
    'due_soon', v_soon,
    'due_today', v_due,
    'overdue', v_over,
    'total', v_soon + v_due + v_over
  );
end;
$$;

-- Scheduler / dispatcher only (never callable by app users).
revoke all on function public.generate_due_notifications(uuid) from public, anon, authenticated;
grant execute on function public.generate_due_notifications(uuid) to service_role;
