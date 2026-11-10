-- =============================================================================
-- MyLife Hub — Phase 1-1: Initial schema, RLS, Storage policies
-- All timestamps are timestamptz (UTC). Recurrence math (Asia/Seoul wall-clock)
-- is done in Phase 1-2 RPCs; this file only stores the rule data.
-- =============================================================================
begin;

-- -----------------------------------------------------------------------------
-- 1. ENUM types
-- -----------------------------------------------------------------------------
create type public.user_role       as enum ('ADMIN', 'MEMBER');
create type public.visibility_type as enum ('FAMILY', 'PRIVATE');
create type public.task_status     as enum ('PENDING', 'COMPLETED', 'SNOOZED', 'CANCELLED');
create type public.recurring_type  as enum ('NONE', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY');
create type public.anchor_type     as enum ('DUE_DATE', 'COMPLETION_DATE');
create type public.event_type      as enum (
  'ASSET_CREATED', 'TASK_CREATED', 'TASK_COMPLETED', 'TASK_SNOOZED', 'MAGIC_LINK_COMPLETED'
);

-- -----------------------------------------------------------------------------
-- 2. Tables
-- -----------------------------------------------------------------------------
create table public.households (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 100),
  created_at timestamptz not null default now()
);

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  role         public.user_role not null default 'MEMBER',
  display_name text not null check (char_length(display_name) between 1 and 50),
  created_at   timestamptz not null default now()
);
create index profiles_household_idx on public.profiles (household_id);

create table public.assets (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  owner_id     uuid not null references public.profiles (id) on delete restrict,
  visibility   public.visibility_type not null default 'FAMILY',
  name         text not null check (char_length(name) between 1 and 100),
  space        text,            -- 거실/주방 등
  category     text,
  preset_key   text,            -- 30종 기본 프리셋 키
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index assets_household_idx on public.assets (household_id, space);
create index assets_owner_idx     on public.assets (owner_id);

create table public.task_rules (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references public.households (id) on delete cascade,
  owner_id          uuid not null references public.profiles (id) on delete restrict,
  visibility        public.visibility_type not null default 'FAMILY',
  asset_id          uuid references public.assets (id) on delete cascade,
  title             text not null check (char_length(title) between 1 and 200),
  recurring_type    public.recurring_type not null default 'NONE',
  interval_n        integer not null default 1 check (interval_n >= 1),
  anchor            public.anchor_type not null default 'DUE_DATE',
  day_of_month      smallint check (day_of_month between 1 and 31),  -- 말일 보정 대상
  timezone          text not null default 'Asia/Seoul',
  next_iteration_no integer not null default 1 check (next_iteration_no >= 1),
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index task_rules_household_idx on public.task_rules (household_id);
create index task_rules_owner_idx     on public.task_rules (owner_id);
create index task_rules_asset_idx     on public.task_rules (asset_id);

create table public.tasks (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  owner_id      uuid not null references public.profiles (id) on delete restrict,
  visibility    public.visibility_type not null default 'FAMILY',
  asset_id      uuid references public.assets (id) on delete set null,
  rule_id       uuid references public.task_rules (id) on delete set null,
  iteration_no  integer check (iteration_no >= 1),
  title         text not null check (char_length(title) between 1 and 200),
  due_date      date not null,                       -- Asia/Seoul wall-clock date
  status        public.task_status not null default 'PENDING',
  completed_at  timestamptz,
  snoozed_until date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- 반복 과업 인스턴스 중복 생성 차단
  constraint tasks_rule_iteration_uniq unique (rule_id, iteration_no),
  constraint tasks_rule_requires_iteration check (rule_id is null or iteration_no is not null),
  constraint tasks_completed_consistency  check ((status = 'COMPLETED') = (completed_at is not null))
);
create index tasks_household_due_idx on public.tasks (household_id, status, due_date);
create index tasks_owner_idx         on public.tasks (owner_id);
create index tasks_asset_idx         on public.tasks (asset_id);

create table public.event_logs (
  id               uuid primary key default gen_random_uuid(),
  household_id     uuid not null references public.households (id) on delete cascade,
  owner_id         uuid not null references public.profiles (id) on delete restrict,
  visibility       public.visibility_type not null default 'FAMILY',
  task_id          uuid references public.tasks (id) on delete set null,
  asset_id         uuid references public.assets (id) on delete set null,
  event_type       public.event_type not null,
  actor_identifier text not null,         -- 'user:<uuid>' | 'magic:<token_id>'
  idempotency_key  text,
  payload          jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);
create index event_logs_timeline_idx on public.event_logs (household_id, created_at desc);
create index event_logs_owner_idx    on public.event_logs (owner_id);
create index event_logs_task_idx     on public.event_logs (task_id);

-- 중복 방지: 과업당 완료 로그는 1건만
create unique index event_logs_one_completion_per_task
  on public.event_logs (task_id)
  where event_type in ('TASK_COMPLETED', 'MAGIC_LINK_COMPLETED') and task_id is not null;

-- 중복 방지: 동일 요청(멱등성 키)의 로그 재기록 차단
create unique index event_logs_idempotency_uniq
  on public.event_logs (household_id, actor_identifier, idempotency_key)
  where idempotency_key is not null;

create table public.magic_tokens (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  task_id      uuid not null references public.tasks (id) on delete cascade,
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),  -- SHA-256 hex only
  expires_at   timestamptz not null,
  consumed_at  timestamptz,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index magic_tokens_task_idx on public.magic_tokens (task_id);

create table public.idempotency_keys (
  id               uuid primary key default gen_random_uuid(),
  household_id     uuid not null references public.households (id) on delete cascade,
  actor_identifier text not null,
  idempotency_key  text not null check (char_length(idempotency_key) between 8 and 128),
  response         jsonb,
  created_at       timestamptz not null default now(),
  constraint idempotency_keys_uniq unique (household_id, actor_identifier, idempotency_key)
);

-- 파일 메타데이터 (실제 바이너리는 Storage의 manuals / receipts 버킷)
create table public.files (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id),
  owner_id     uuid not null references public.profiles (id),
  asset_id     uuid references public.assets (id) on delete cascade,  -- 자산 매뉴얼/영수증
  task_id      uuid references public.tasks (id) on delete cascade,   -- 과업 관련 파일
  bucket_id    text not null check (bucket_id in ('manuals', 'receipts')),
  file_path    text not null,   -- storage 오브젝트 경로: <household_id>/<family|private>/<owner_id>/<file>
  file_name    text not null,   -- 원본 파일명
  file_size    bigint not null check (file_size >= 0),
  mime_type    text not null,
  visibility   public.visibility_type not null default 'FAMILY',
  created_at   timestamptz not null default now(),
  constraint files_bucket_path_uniq unique (bucket_id, file_path)
);
create index files_household_idx on public.files (household_id, created_at desc);
create index files_owner_idx     on public.files (owner_id);
create index files_asset_idx     on public.files (asset_id);
create index files_task_idx      on public.files (task_id);

-- -----------------------------------------------------------------------------
-- 3. updated_at trigger
-- -----------------------------------------------------------------------------
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger assets_set_updated_at     before update on public.assets     for each row execute function public.set_updated_at();
create trigger task_rules_set_updated_at before update on public.task_rules for each row execute function public.set_updated_at();
create trigger tasks_set_updated_at      before update on public.tasks      for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. RLS helper functions (SECURITY DEFINER avoids policy recursion on profiles)
-- -----------------------------------------------------------------------------
create function public.current_household_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select household_id from public.profiles where id = auth.uid();
$$;

create function public.is_household_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select role = 'ADMIN' from public.profiles where id = auth.uid()),
    false
  );
$$;

-- 첫 가입자가 household를 만들고 ADMIN이 되는 부트스트랩 함수
create function public.create_household(p_name text, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_hid uuid;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'profile already exists' using errcode = '23505';
  end if;

  insert into public.households (name) values (p_name) returning id into v_hid;
  insert into public.profiles (id, household_id, role, display_name)
  values (v_uid, v_hid, 'ADMIN', p_display_name);
  return v_hid;
end;
$$;

revoke all on function public.current_household_id()              from public, anon;
revoke all on function public.is_household_admin()                from public, anon;
revoke all on function public.create_household(text, text)        from public, anon;
grant execute on function public.current_household_id()           to authenticated;
grant execute on function public.is_household_admin()             to authenticated;
grant execute on function public.create_household(text, text)     to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Table privileges (defense in depth on top of RLS)
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from anon;

-- magic_tokens / idempotency_keys: 클라이언트 직접 접근 완전 차단 (SECURITY DEFINER RPC 전용)
revoke all on public.magic_tokens     from anon, authenticated;
revoke all on public.idempotency_keys from anon, authenticated;

-- event_logs: 클라이언트는 조회만 (기록은 RPC 전용)
revoke insert, update, delete on public.event_logs from authenticated;

-- -----------------------------------------------------------------------------
-- 6. Row Level Security
-- -----------------------------------------------------------------------------
alter table public.households       enable row level security;
alter table public.profiles         enable row level security;
alter table public.assets           enable row level security;
alter table public.task_rules       enable row level security;
alter table public.tasks            enable row level security;
alter table public.event_logs       enable row level security;
alter table public.files            enable row level security;
alter table public.magic_tokens     enable row level security;   -- 정책 없음 = 전면 차단
alter table public.idempotency_keys enable row level security;   -- 정책 없음 = 전면 차단

-- households
create policy households_select on public.households
  for select to authenticated
  using (id = public.current_household_id());
create policy households_update_admin on public.households
  for update to authenticated
  using (id = public.current_household_id() and public.is_household_admin())
  with check (id = public.current_household_id());

-- profiles
create policy profiles_select on public.profiles
  for select to authenticated
  using (household_id = public.current_household_id());
create policy profiles_update_admin on public.profiles
  for update to authenticated
  using (household_id = public.current_household_id() and public.is_household_admin())
  with check (household_id = public.current_household_id());
create policy profiles_delete_admin on public.profiles
  for delete to authenticated
  using (household_id = public.current_household_id() and public.is_household_admin() and id <> auth.uid());

-- assets: 조회=가족공유 or 본인 PRIVATE / CUD=ADMIN
create policy assets_select on public.assets
  for select to authenticated
  using (household_id = public.current_household_id()
         and (visibility = 'FAMILY' or owner_id = auth.uid()));
create policy assets_insert_admin on public.assets
  for insert to authenticated
  with check (household_id = public.current_household_id()
              and public.is_household_admin()
              and owner_id = auth.uid());
create policy assets_update_admin on public.assets
  for update to authenticated
  using (household_id = public.current_household_id()
         and public.is_household_admin()
         and (visibility = 'FAMILY' or owner_id = auth.uid()))
  with check (household_id = public.current_household_id());
create policy assets_delete_admin on public.assets
  for delete to authenticated
  using (household_id = public.current_household_id()
         and public.is_household_admin()
         and (visibility = 'FAMILY' or owner_id = auth.uid()));

-- task_rules: assets와 동일
create policy task_rules_select on public.task_rules
  for select to authenticated
  using (household_id = public.current_household_id()
         and (visibility = 'FAMILY' or owner_id = auth.uid()));
create policy task_rules_insert_admin on public.task_rules
  for insert to authenticated
  with check (household_id = public.current_household_id()
              and public.is_household_admin()
              and owner_id = auth.uid());
create policy task_rules_update_admin on public.task_rules
  for update to authenticated
  using (household_id = public.current_household_id()
         and public.is_household_admin()
         and (visibility = 'FAMILY' or owner_id = auth.uid()))
  with check (household_id = public.current_household_id());
create policy task_rules_delete_admin on public.task_rules
  for delete to authenticated
  using (household_id = public.current_household_id()
         and public.is_household_admin()
         and (visibility = 'FAMILY' or owner_id = auth.uid()));

-- tasks: 조회=assets와 동일 / INSERT·DELETE=ADMIN / UPDATE=ADMIN(가족공유) 또는 본인 소유
-- (가족 Task 완료/연기는 Phase 1-2의 SECURITY DEFINER RPC가 처리)
create policy tasks_select on public.tasks
  for select to authenticated
  using (household_id = public.current_household_id()
         and (visibility = 'FAMILY' or owner_id = auth.uid()));
create policy tasks_insert_admin on public.tasks
  for insert to authenticated
  with check (household_id = public.current_household_id()
              and public.is_household_admin()
              and owner_id = auth.uid());
create policy tasks_update on public.tasks
  for update to authenticated
  using (household_id = public.current_household_id()
         and ((visibility = 'FAMILY' and public.is_household_admin())
              or owner_id = auth.uid()))
  with check (household_id = public.current_household_id());
create policy tasks_delete_admin on public.tasks
  for delete to authenticated
  using (household_id = public.current_household_id()
         and public.is_household_admin()
         and (visibility = 'FAMILY' or owner_id = auth.uid()));

-- event_logs: 조회만 (INSERT/UPDATE/DELETE 정책 없음)
create policy event_logs_select on public.event_logs
  for select to authenticated
  using (household_id = public.current_household_id()
         and (visibility = 'FAMILY' or owner_id = auth.uid()));

-- files: 조회=FAMILY는 가구 전체 / PRIVATE는 소유자만
create policy files_select on public.files
  for select to authenticated
  using (household_id = public.current_household_id()
         and (visibility = 'FAMILY' or owner_id = auth.uid()));
-- INSERT: 가구 구성원, owner_id는 auth.uid() 강제.
-- 경로는 Storage 규약과 일치해야 하고, 참조하는 asset/task는 (RLS상) 접근 가능한 것이어야 함.
create policy files_insert on public.files
  for insert to authenticated
  with check (
    household_id = public.current_household_id()
    and owner_id = auth.uid()
    and file_path like household_id::text || '/' || lower(visibility::text) || '/' || owner_id::text || '/%'
    and (asset_id is null or exists (select 1 from public.assets a where a.id = asset_id))
    and (task_id  is null or exists (select 1 from public.tasks  t where t.id = task_id))
  );
-- DELETE: 본인 파일, 또는 ADMIN은 FAMILY 파일만 (PRIVATE는 소유자만). UPDATE 정책 없음 = 수정 불가
create policy files_delete on public.files
  for delete to authenticated
  using (household_id = public.current_household_id()
         and (owner_id = auth.uid()
              or (visibility = 'FAMILY' and public.is_household_admin())));

-- -----------------------------------------------------------------------------
-- 7. Storage: buckets + RLS (manuals, receipts)
-- Object path convention: <household_id>/<family|private>/<owner_id>/<filename>
--   [1] household_id : 가구 경계
--   [2] family|private: 가족 공유 / 개인 전용
--   [3] owner_id     : 업로더(소유자)
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('manuals', 'manuals', false), ('receipts', 'receipts', false)
on conflict (id) do update set public = false;

create policy mylife_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id in ('manuals', 'receipts')
    and (storage.foldername(name))[1] = public.current_household_id()::text
    and ((storage.foldername(name))[2] = 'family'
         or (storage.foldername(name))[3] = auth.uid()::text)
  );

-- INSERT/UPDATE/DELETE: 같은 가구 구성원(ADMIN/MEMBER 무관)이 본인 경로(owner 폴더)에만 쓰기.
-- family/private 모두 동일 규칙.
create policy mylife_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('manuals', 'receipts')
    and (storage.foldername(name))[1] = public.current_household_id()::text
    and (storage.foldername(name))[2] in ('family', 'private')
    and (storage.foldername(name))[3] = auth.uid()::text
  );

create policy mylife_storage_update on storage.objects
  for update to authenticated
  using (
    bucket_id in ('manuals', 'receipts')
    and (storage.foldername(name))[1] = public.current_household_id()::text
    and (storage.foldername(name))[2] in ('family', 'private')
    and (storage.foldername(name))[3] = auth.uid()::text
  )
  with check (
    bucket_id in ('manuals', 'receipts')
    and (storage.foldername(name))[1] = public.current_household_id()::text
    and (storage.foldername(name))[2] in ('family', 'private')
    and (storage.foldername(name))[3] = auth.uid()::text
  );

-- DELETE: 본인 소유 파일, 또는 family/ 경로이면서 같은 가구의 ADMIN (고아 오브젝트 방지)
create policy mylife_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('manuals', 'receipts')
    and (storage.foldername(name))[1] = public.current_household_id()::text
    and (
      ((storage.foldername(name))[2] in ('family', 'private')
        and (storage.foldername(name))[3] = auth.uid()::text)
      or ((storage.foldername(name))[2] = 'family' and public.is_household_admin())
    )
  );

commit;
