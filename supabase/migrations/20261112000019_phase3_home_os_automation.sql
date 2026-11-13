-- =============================================================================
-- MyLife Hub — Phase 3: 가정 운영 자동화 & 살림 결산
--
--   * utility_bills   : 공과금·관리비 고지서(전기·가스·수도·관리비·통신·기타) — 월별 합계와 전월 대비를 리포트에 보여준다
--   * kitchen_activity: 월말 결산용 "무슨 일을 했는지" 기록(소진 / 폐기 / 장봄) — 추가만 가능(수정·삭제 불가)한 로그
--   * generate_due_notifications: 렌탈 의무 약정 D-90 … D-85 구간 진입 시 1회 방어 알림(RENTAL_EXPIRING) 추가
--       - 기존 D-60 / D-30 알림은 그대로. 중복 방지 키는 'rental-expiring:<asset>:<obligation_end_date>:d90' (약정당 1회).
--       - 알림 클릭 시 기존 딥링크 그대로: /assets?openAssetId=<asset>&tab=compare (환승 비교 탭).
--
-- 가구 구성원 판별은 이전 마이그레이션과 같다: household_members 테이블은 없고 구성원 = profiles 행 → public.current_household_id().
-- 선택적 적용: 앱은 이 마이그레이션 전에도 깨지지 않는다 (테이블이 없으면 해당 카드가 "준비 중" 안내로 대체되고,
--   활동 기록은 조용히 건너뛴다).
-- 멱등: 여러 번 실행해도 안전 (if not exists / drop policy if exists / create or replace).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. utility_bills
-- -----------------------------------------------------------------------------
create table if not exists public.utility_bills (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  created_by    uuid references auth.users (id) on delete set null,
  bill_type     text not null,
  billing_month text not null,
  amount        integer not null,
  due_date      date,
  provider_name text,
  memo          text,
  created_at    timestamptz not null default now(),
  constraint utility_bills_type_check   check (bill_type in ('ELECTRICITY', 'GAS', 'WATER', 'MAINTENANCE', 'INTERNET', 'ETC')),
  constraint utility_bills_month_check  check (billing_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  constraint utility_bills_amount_check check (amount >= 0 and amount <= 100000000),
  constraint utility_bills_provider_len check (provider_name is null or char_length(provider_name) <= 50),
  constraint utility_bills_memo_len     check (memo is null or char_length(memo) <= 200)
);

create index if not exists utility_bills_household_month_idx
  on public.utility_bills (household_id, billing_month desc, created_at desc);

alter table public.utility_bills enable row level security;

revoke all on public.utility_bills from anon;
grant select, insert, update, delete on public.utility_bills to authenticated;

drop policy if exists utility_bills_select on public.utility_bills;
create policy utility_bills_select on public.utility_bills
  for select to authenticated
  using (household_id = public.current_household_id());

drop policy if exists utility_bills_insert on public.utility_bills;
create policy utility_bills_insert on public.utility_bills
  for insert to authenticated
  with check (household_id = public.current_household_id() and created_by = auth.uid());

drop policy if exists utility_bills_update on public.utility_bills;
create policy utility_bills_update on public.utility_bills
  for update to authenticated
  using (household_id = public.current_household_id())
  with check (household_id = public.current_household_id());

drop policy if exists utility_bills_delete on public.utility_bills;
create policy utility_bills_delete on public.utility_bills
  for delete to authenticated
  using (household_id = public.current_household_id());

-- -----------------------------------------------------------------------------
-- 2. kitchen_activity (append-only log for the monthly settlement)
-- -----------------------------------------------------------------------------
create table if not exists public.kitchen_activity (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  created_by   uuid references auth.users (id) on delete set null,
  kind         text not null,
  name         text not null,
  est_amount   integer not null default 0,
  created_at   timestamptz not null default now(),
  constraint kitchen_activity_kind_check   check (kind in ('CONSUMED', 'DISCARDED', 'SHOPPED')),
  constraint kitchen_activity_name_len     check (char_length(btrim(name)) between 1 and 100),
  constraint kitchen_activity_amount_check check (est_amount between 0 and 100000000)
);

create index if not exists kitchen_activity_household_created_idx
  on public.kitchen_activity (household_id, created_at desc);

alter table public.kitchen_activity enable row level security;

revoke all on public.kitchen_activity from anon;
grant select, insert on public.kitchen_activity to authenticated;
revoke update, delete on public.kitchen_activity from authenticated;

drop policy if exists kitchen_activity_select on public.kitchen_activity;
create policy kitchen_activity_select on public.kitchen_activity
  for select to authenticated
  using (household_id = public.current_household_id());

drop policy if exists kitchen_activity_insert on public.kitchen_activity;
create policy kitchen_activity_insert on public.kitchen_activity
  for insert to authenticated
  with check (household_id = public.current_household_id() and created_by = auth.uid());

-- -----------------------------------------------------------------------------
-- 3. generate_due_notifications — task windows, rental D-90 / D-60 / D-30, kitchen D-3 (service_role only)
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

  -- ---- rental obligation expiry, early warning: D-90 … D-85 (once per contract) ----------------------
  --      Auto-renewal / penalty terms are easiest to act on three months ahead. The dedupe key has no day count, so an
  --      appliance that sits in the window for six daily runs is still announced exactly once per obligation_end_date.
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
       and (a.obligation_end_date - v_today) between 85 and 90
       and (p_household_id is null or a.household_id = p_household_id)
  ),
  ins as (
    insert into public.notifications (household_id, user_id, type, task_id, asset_id, title, body, dedupe_key)
    select tg.household_id,
           p.id,
           'RENTAL_EXPIRING',
           null::uuid,
           tg.id,
           '[' || tg.name || '] 렌탈 약정 만료 3개월 전',
           '약정 만료가 약 ' || tg.remaining_days::text || '일 남았어요. 자동 연장·위약금 조건을 미리 확인하고 환승 비용을 비교해 보세요.',
           'rental-expiring:' || tg.id::text || ':' || tg.obligation_end_date::text || ':d90'
      from targets tg
      join public.profiles p
        on p.household_id = tg.household_id
       and (tg.visibility = 'FAMILY' or p.id = tg.owner_id)
    on conflict (user_id, dedupe_key) do nothing
    returning 1
  )
  select v_rental + count(*) into v_rental from ins;

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

commit;
