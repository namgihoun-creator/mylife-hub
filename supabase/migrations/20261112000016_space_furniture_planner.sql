-- =============================================================================
-- MyLife Hub — 공간·가구 플래너 (부부 공동), Phase 1: schema + RLS + private photo bucket
--
--   * space_projects             : 우리 집 공간 한 곳(거실 소파 자리, 안방 창가 …) — 사진, 사진 위 치수 선분, 선호 스타일, AI 진단 캐시
--   * space_furniture_candidates : 그 공간에 놓을 후보 가구(위시 보드) — 치수, 가격, 쇼핑몰 링크, 진행 상태
--
-- 가구 구성원 판별: household_members 테이블은 없고 구성원 = profiles 행이다 → public.current_household_id().
-- 공간 기록은 "부부 공동 자원"이다(키친과 같은 모델): 같은 가구 구성원 누구나 조회/등록/수정/삭제, 다른 가구는 접근 불가.
--   (assets 와 달리 owner_id / PRIVATE 가시성은 없다. created_by 는 "누가 올렸는지" 표시용.)
--
-- Storage: private 버킷 'space-photos', 객체 경로 규약  <household_id>/<space_id>/<filename>
--   첫 폴더 = 가구 경계. 같은 가구 구성원만 업로드/조회/수정/삭제. 5MB, jpeg/png/webp 만.
--
-- 멱등: 여러 번 실행해도 안전 (if not exists / drop policy if exists / on conflict).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. space_projects
-- -----------------------------------------------------------------------------
create table if not exists public.space_projects (
  id               uuid primary key default gen_random_uuid(),
  household_id     uuid not null references public.households (id) on delete cascade,
  created_by       uuid references auth.users (id) on delete set null,
  name             text not null,
  room_type        text not null default 'etc',
  photo_path       text,                                         -- space-photos 버킷 안의 경로
  annotations      jsonb not null default '[]'::jsonb,           -- [{ id, x1, y1, x2, y2, label, lengthCm }]
  style_preference text,
  ai_diagnosis     jsonb,                                        -- Gemini Vision 분석·추천 결과 캐시
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint space_projects_name_len check (char_length(btrim(name)) between 1 and 60),
  constraint space_projects_room_type_check check (room_type in ('living', 'bedroom', 'kitchen', 'study', 'kids', 'etc')),
  constraint space_projects_photo_path_len check (photo_path is null or char_length(photo_path) between 1 and 300),
  constraint space_projects_annotations_array check (jsonb_typeof(annotations) = 'array' and jsonb_array_length(annotations) <= 50),
  constraint space_projects_style_len check (style_preference is null or char_length(style_preference) <= 60),
  constraint space_projects_ai_object check (ai_diagnosis is null or jsonb_typeof(ai_diagnosis) = 'object'),
  -- 후보 가구가 "같은 가구의 공간"만 가리키도록 복합 FK 의 대상으로 쓴다.
  constraint space_projects_id_household_uniq unique (id, household_id)
);

create index if not exists space_projects_household_idx on public.space_projects (household_id, created_at desc);

drop trigger if exists space_projects_set_updated_at on public.space_projects;
create trigger space_projects_set_updated_at
  before update on public.space_projects
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. space_furniture_candidates
-- -----------------------------------------------------------------------------
create table if not exists public.space_furniture_candidates (
  id           uuid primary key default gen_random_uuid(),
  space_id     uuid not null,
  household_id uuid not null references public.households (id) on delete cascade,
  name         text not null,
  category     text,
  price        integer,
  width_cm     numeric(6, 1),
  depth_cm     numeric(6, 1),
  height_cm    numeric(6, 1),
  product_url  text,
  source_mall  text,
  status       text not null default 'CANDIDATE',
  memo         text,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint space_candidates_space_fk
    foreign key (space_id, household_id) references public.space_projects (id, household_id) on delete cascade,
  constraint space_candidates_name_len     check (char_length(btrim(name)) between 1 and 100),
  constraint space_candidates_category_len check (category is null or char_length(category) <= 30),
  constraint space_candidates_price_check  check (price is null or price between 0 and 1000000000),
  constraint space_candidates_size_check   check (
    (width_cm  is null or width_cm  between 1 and 2000) and
    (depth_cm  is null or depth_cm  between 1 and 2000) and
    (height_cm is null or height_cm between 1 and 1000)),
  constraint space_candidates_url_check    check (product_url is null or (char_length(product_url) <= 2000 and product_url ~* '^https?://')),
  constraint space_candidates_mall_len     check (source_mall is null or char_length(source_mall) <= 30),
  constraint space_candidates_status_check check (status in ('CANDIDATE', 'SELECTED', 'PURCHASED')),
  constraint space_candidates_memo_len     check (memo is null or char_length(memo) <= 300)
);

create index if not exists space_candidates_space_idx     on public.space_furniture_candidates (space_id, created_at);
create index if not exists space_candidates_household_idx on public.space_furniture_candidates (household_id);

-- -----------------------------------------------------------------------------
-- 3. Row Level Security — 가구 격리 (current_household_id() 기반)
--    anon 은 아무 권한이 없다. WITH CHECK 가 household_id 를 고정하므로 행을 다른 가구로 옮길 수 없고,
--    created_by 는 insert 때 본인(auth.uid())으로만 적을 수 있다.
-- -----------------------------------------------------------------------------
alter table public.space_projects             enable row level security;
alter table public.space_furniture_candidates enable row level security;

revoke all on public.space_projects, public.space_furniture_candidates from anon;
grant select, insert, update, delete on public.space_projects, public.space_furniture_candidates to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['space_projects', 'space_furniture_candidates'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (household_id = public.current_household_id())', t || '_select', t);

    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (household_id = public.current_household_id() and created_by = auth.uid())', t || '_insert', t);

    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('create policy %I on public.%I for update to authenticated using (household_id = public.current_household_id()) with check (household_id = public.current_household_id())', t || '_update', t);

    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for delete to authenticated using (household_id = public.current_household_id())', t || '_delete', t);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Storage: private bucket 'space-photos'  (<household_id>/<space_id>/<filename>)
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('space-photos', 'space-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists space_photos_select on storage.objects;
create policy space_photos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'space-photos'
    and (storage.foldername(name))[1] = public.current_household_id()::text
  );

drop policy if exists space_photos_insert on storage.objects;
create policy space_photos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'space-photos'
    and (storage.foldername(name))[1] = public.current_household_id()::text
  );

drop policy if exists space_photos_update on storage.objects;
create policy space_photos_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'space-photos'
    and (storage.foldername(name))[1] = public.current_household_id()::text
  )
  with check (
    bucket_id = 'space-photos'
    and (storage.foldername(name))[1] = public.current_household_id()::text
  );

drop policy if exists space_photos_delete on storage.objects;
create policy space_photos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'space-photos'
    and (storage.foldername(name))[1] = public.current_household_id()::text
  );

comment on table public.space_projects             is '공간·가구 플래너: 우리 집 공간 한 곳 — 사진, 치수 선분, 스타일, AI 진단 캐시 (가구 공유)';
comment on table public.space_furniture_candidates is '공간·가구 플래너: 공간별 후보 가구 위시 보드 — 치수, 가격, 쇼핑몰 링크, 상태 (가구 공유)';
comment on column public.space_projects.annotations is '사진 위 치수 선분 배열: [{ id, x1, y1, x2, y2, label, lengthCm }]';

commit;
