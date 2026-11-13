-- =============================================================================
-- MyLife Hub — Phase 2: 부부 협업 & 액션 루프
--
--   * shopping_items                         : 부부 공동 장보기 리스트 (키친 재료가 떨어져 갈 때 바로 담기, 장본 뒤 보관함으로 입고)
--   * space_furniture_candidates.liked_by    : 위시 가구 "좋아요" 투표(누른 구성원 user_id 배열) → 부부 공동 픽
--
-- 가구 구성원 판별은 공간 플래너와 같다: household_members 테이블은 없고 구성원 = profiles 행 → public.current_household_id().
-- 장보기 리스트는 키친처럼 "부부 공동 자원": 같은 가구 구성원 누구나 조회/등록/수정/삭제, 다른 가구는 접근 불가.
--
-- 선택적 적용: 앱은 이 마이그레이션 전에도 깨지지 않는다 (liked_by 가 없으면 위시 보드는 투표 UI 없이 동작하고,
-- shopping_items 가 없으면 장보기 탭이 "준비 중" 안내를 보여준다).
-- 멱등: 여러 번 실행해도 안전 (if not exists / drop ... if exists / create or replace).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. shopping_items
-- -----------------------------------------------------------------------------
create table if not exists public.shopping_items (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  created_by   uuid references auth.users (id) on delete set null,
  name         text not null,
  quantity     text default '1개',
  category     text default '식재료',
  is_checked   boolean not null default false,
  source_type  text not null default 'MANUAL',
  created_at   timestamptz not null default now(),
  constraint shopping_items_name_len     check (char_length(btrim(name)) between 1 and 100),
  constraint shopping_items_quantity_len check (quantity is null or char_length(quantity) <= 50),
  constraint shopping_items_category_len check (category is null or char_length(category) <= 30),
  constraint shopping_items_source_check check (source_type in ('MANUAL', 'KITCHEN_CONSUMED', 'KITCHEN_EXPIRING'))
);

create index if not exists shopping_items_household_idx
  on public.shopping_items (household_id, is_checked, created_at);

alter table public.shopping_items enable row level security;

revoke all on public.shopping_items from anon;
grant select, insert, update, delete on public.shopping_items to authenticated;

drop policy if exists shopping_items_select on public.shopping_items;
create policy shopping_items_select on public.shopping_items
  for select to authenticated
  using (household_id = public.current_household_id());

drop policy if exists shopping_items_insert on public.shopping_items;
create policy shopping_items_insert on public.shopping_items
  for insert to authenticated
  with check (household_id = public.current_household_id() and created_by = auth.uid());

drop policy if exists shopping_items_update on public.shopping_items;
create policy shopping_items_update on public.shopping_items
  for update to authenticated
  using (household_id = public.current_household_id())
  with check (household_id = public.current_household_id());

drop policy if exists shopping_items_delete on public.shopping_items;
create policy shopping_items_delete on public.shopping_items
  for delete to authenticated
  using (household_id = public.current_household_id());

-- -----------------------------------------------------------------------------
-- 2. space_furniture_candidates.liked_by  (좋아요 투표)
--    같은 가구 구성원은 후보 가구를 모두 수정할 수 있으므로(공동 자원), 투표만큼은 "내 표만 바꾼다"를 트리거로 강제한다:
--    JWT 사용자가 liked_by 에서 추가/제거할 수 있는 값은 자기 user_id 하나뿐이고, 같은 id 를 두 번 넣을 수 없다.
--    (service_role / JWT 없는 관리 작업은 auth.uid() 가 null → 검사하지 않는다.)
-- -----------------------------------------------------------------------------
alter table public.space_furniture_candidates
  add column if not exists liked_by uuid[] not null default '{}'::uuid[];

alter table public.space_furniture_candidates
  drop constraint if exists space_furniture_candidates_liked_by_size;
alter table public.space_furniture_candidates
  add constraint space_furniture_candidates_liked_by_size check (cardinality(liked_by) <= 20);

create or replace function public.enforce_liked_by_self()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_old  uuid[] := case when tg_op = 'UPDATE' then old.liked_by else '{}'::uuid[] end;
  v_bad  int;
begin
  if v_uid is null then
    return new;
  end if;
  if new.liked_by is not distinct from v_old then
    return new;
  end if;

  if (select count(distinct x) from unnest(new.liked_by) as x) <> cardinality(new.liked_by) then
    raise exception 'LIKE_DUPLICATE' using errcode = '23514';
  end if;

  select count(*) into v_bad
    from (
      (select x from unnest(new.liked_by) as x except select x from unnest(v_old) as x)
      union all
      (select x from unnest(v_old) as x except select x from unnest(new.liked_by) as x)
    ) as changed
   where changed.x <> v_uid;
  if v_bad > 0 then
    raise exception 'LIKE_ONLY_SELF' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists space_furniture_candidates_liked_by_self on public.space_furniture_candidates;
create trigger space_furniture_candidates_liked_by_self
  before insert or update of liked_by on public.space_furniture_candidates
  for each row execute function public.enforce_liked_by_self();

commit;
