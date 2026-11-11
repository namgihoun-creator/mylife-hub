-- =============================================================================
-- MyLife Hub — Smart Kitchen OS (CookSaver integration), Phase 1: schema + RLS
--
--   * kitchen_profiles        : 가구당 1행 (PK = household_id) — 반려동물 유형, 월 예산, 누적 구출/폐기/절약 통계
--   * kitchen_items           : 냉장고·냉동실·실온 식재료
--   * kitchen_shopping_items  : 장보기 목록
--   * kitchen_expenses        : 식비·배달·펫 케어 지출 (월 예산 집계용)
--
-- 가구 구성원 판별: 이 프로젝트에는 household_members 테이블이 없고, 구성원 = profiles 행이다.
--   public.current_household_id()  (SECURITY DEFINER, profiles 조회)  ← 모든 정책이 이 함수를 사용
-- 키친 데이터는 "가구 공동 자원"이다: 가구 구성원 누구나 조회/등록/수정/삭제할 수 있고, 다른 가구는 접근할 수 없다.
--   (assets 처럼 owner_id / PRIVATE 가시성은 두지 않는다 — 냉장고는 함께 쓰는 물건이기 때문.)
--   kitchen_profiles 는 행 삭제 정책이 없다(가구 삭제 시 cascade 로만 사라짐).
--
-- 날짜 규칙: 날짜 컬럼(expire_date, added_at, expense_date)은 Asia/Seoul 달력 날짜(date)다.
--   added_at 의 기본값은 서울 기준 오늘 — "냉동 30일+ 화석" 판정의 기준일.
--
-- 멱등: 여러 번 실행해도 안전 (if not exists / drop policy if exists).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. kitchen_profiles (가구당 1행)
-- -----------------------------------------------------------------------------
create table if not exists public.kitchen_profiles (
  household_id         uuid primary key references public.households (id) on delete cascade,
  pet_type             text    not null default 'none',
  human_monthly_budget integer not null default 350000,
  pet_monthly_budget   integer not null default 100000,
  rescued_count        integer not null default 0,
  discarded_count      integer not null default 0,
  saved_money          bigint  not null default 0,
  created_at           timestamptz not null default now(),
  constraint kitchen_profiles_pet_type_check
    check (pet_type in ('none', 'dog', 'cat', 'both')),
  constraint kitchen_profiles_human_budget_check
    check (human_monthly_budget between 0 and 100000000),
  constraint kitchen_profiles_pet_budget_check
    check (pet_monthly_budget between 0 and 100000000),
  constraint kitchen_profiles_counts_check
    check (rescued_count >= 0 and discarded_count >= 0 and saved_money >= 0)
);

-- -----------------------------------------------------------------------------
-- 2. kitchen_items (식재료)
-- -----------------------------------------------------------------------------
create table if not exists public.kitchen_items (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name         text not null,
  amount       text not null default '1개',                       -- 자유 입력 수량: '1모', '300g', '2개'
  storage_type text not null default 'FRIDGE',
  spot         text,                                              -- 냉장실 위치: '선반 앞' / '선반 깊숙이' …
  expire_date  date not null,
  added_at     date not null default ((now() at time zone 'Asia/Seoul')::date),
  is_pet       boolean not null default false,                    -- 반려동물용 간식·사료·캔
  memo         text,
  created_at   timestamptz not null default now(),
  constraint kitchen_items_name_len    check (char_length(btrim(name)) between 1 and 100),
  constraint kitchen_items_amount_len  check (char_length(amount) between 1 and 50),
  constraint kitchen_items_storage_check check (storage_type in ('FRIDGE', 'FREEZER', 'ROOM_TEMP')),
  constraint kitchen_items_spot_len    check (spot is null or char_length(spot) between 1 and 30),
  constraint kitchen_items_memo_len    check (memo is null or char_length(memo) <= 200)
);

create index if not exists kitchen_items_household_expire_idx on public.kitchen_items (household_id, expire_date);
create index if not exists kitchen_items_household_storage_idx on public.kitchen_items (household_id, storage_type);

-- -----------------------------------------------------------------------------
-- 3. kitchen_shopping_items (장보기 목록)
-- -----------------------------------------------------------------------------
create table if not exists public.kitchen_shopping_items (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name         text not null,
  is_done      boolean not null default false,
  is_pet       boolean not null default false,
  created_at   timestamptz not null default now(),
  constraint kitchen_shopping_name_len check (char_length(btrim(name)) between 1 and 100)
);

create index if not exists kitchen_shopping_household_idx on public.kitchen_shopping_items (household_id, is_done, created_at);

-- -----------------------------------------------------------------------------
-- 4. kitchen_expenses (지출)
-- -----------------------------------------------------------------------------
create table if not exists public.kitchen_expenses (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  expense_date date not null default ((now() at time zone 'Asia/Seoul')::date),
  category     text not null,
  amount       integer not null,
  memo         text,
  created_at   timestamptz not null default now(),
  constraint kitchen_expenses_category_check check (category in ('human_groceries', 'human_delivery', 'pet_care')),
  constraint kitchen_expenses_amount_check   check (amount between 0 and 100000000),
  constraint kitchen_expenses_memo_len       check (memo is null or char_length(memo) <= 100)
);

create index if not exists kitchen_expenses_household_date_idx on public.kitchen_expenses (household_id, expense_date desc);

-- -----------------------------------------------------------------------------
-- 5. Row Level Security — 가구 격리 (current_household_id() 기반)
--    anon 은 아무 권한도 없고, authenticated 는 자기 가구의 행만 다룬다.
--    WITH CHECK 가 household_id 를 고정하므로 행을 다른 가구로 옮기거나 다른 가구 이름으로 만들 수 없다.
-- -----------------------------------------------------------------------------
alter table public.kitchen_profiles       enable row level security;
alter table public.kitchen_items          enable row level security;
alter table public.kitchen_shopping_items enable row level security;
alter table public.kitchen_expenses       enable row level security;

revoke all on public.kitchen_profiles, public.kitchen_items, public.kitchen_shopping_items, public.kitchen_expenses from anon;
grant select, insert, update, delete on public.kitchen_items, public.kitchen_shopping_items, public.kitchen_expenses to authenticated;
grant select, insert, update on public.kitchen_profiles to authenticated; -- 삭제 없음

-- kitchen_profiles: select / insert / update (delete 정책 없음)
drop policy if exists kitchen_profiles_select on public.kitchen_profiles;
create policy kitchen_profiles_select on public.kitchen_profiles
  for select to authenticated using (household_id = public.current_household_id());

drop policy if exists kitchen_profiles_insert on public.kitchen_profiles;
create policy kitchen_profiles_insert on public.kitchen_profiles
  for insert to authenticated with check (household_id = public.current_household_id());

drop policy if exists kitchen_profiles_update on public.kitchen_profiles;
create policy kitchen_profiles_update on public.kitchen_profiles
  for update to authenticated
  using (household_id = public.current_household_id())
  with check (household_id = public.current_household_id());

-- kitchen_items / kitchen_shopping_items / kitchen_expenses: 전체 CRUD (같은 형태 3벌)
do $$
declare
  t text;
begin
  foreach t in array array['kitchen_items', 'kitchen_shopping_items', 'kitchen_expenses'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (household_id = public.current_household_id())', t || '_select', t);

    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (household_id = public.current_household_id())', t || '_insert', t);

    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('create policy %I on public.%I for update to authenticated using (household_id = public.current_household_id()) with check (household_id = public.current_household_id())', t || '_update', t);

    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for delete to authenticated using (household_id = public.current_household_id())', t || '_delete', t);
  end loop;
end;
$$;

comment on table public.kitchen_profiles       is '스마트 키친: 가구당 1행 — 반려동물 유형, 월 예산, 구출/폐기/절약 누적 통계';
comment on table public.kitchen_items          is '스마트 키친: 냉장·냉동·실온 식재료 (가구 공유)';
comment on table public.kitchen_shopping_items is '스마트 키친: 장보기 목록 (가구 공유)';
comment on table public.kitchen_expenses       is '스마트 키친: 식비·배달·펫 케어 지출 (가구 공유)';
comment on column public.kitchen_items.added_at is '등록일(서울 기준 날짜) — 냉동 30일 이상이면 "화석"으로 판정';
comment on column public.kitchen_items.amount   is '자유 입력 수량 (예: 1모, 300g)';

commit;
