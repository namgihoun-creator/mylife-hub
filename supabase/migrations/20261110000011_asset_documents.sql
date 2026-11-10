-- =============================================================================
-- MyLife Hub — Track B: 가전 영수증 / 보증서 / 설명서 문서 관리
--   * Storage bucket `asset-documents` (private, 10MB, jpeg/png/webp/pdf)
--   * public.asset_documents (메타데이터) + RLS
--   * storage.objects RLS (이 버킷 전용 정책)
--
-- 가구 구성원 판별: 이 프로젝트에는 household_members 테이블이 없고, 구성원 = profiles 행이다.
--   public.current_household_id()  (SECURITY DEFINER, profiles 조회)  ← 모든 정책이 이 함수를 사용
-- 자산 가시성: 문서는 "그 자산을 볼 수 있는 사람"에게만 보인다 (assets RLS가 서브쿼리에 그대로 적용됨).
--   → 다른 가구는 물론, 다른 구성원의 PRIVATE 자산 문서도 격리된다.
--
-- Storage 객체 경로: <household_id>/<asset_id>/<uuid>.<ext>
--   [1] household_id : 가구 경계,  [2] asset_id : 자산 경계
--
-- 업로드 흐름 (Vercel 서버리스 본문 한도 4.5MB 때문에 파일은 서버 액션을 거치지 않는다):
--   서버 액션이 권한/형식/크기를 검증하고 서명된 업로드 토큰 발급 → 브라우저가 Storage로 직접 업로드
--   → 서버 액션이 실제 저장된 객체의 크기/MIME을 다시 확인한 뒤 메타데이터 insert.
-- 멱등: 여러 번 실행해도 안전 (if not exists / on conflict / drop policy if exists).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Bucket (Private). 크기/형식 제한은 Storage 계층에서도 강제된다.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'asset-documents', 'asset-documents', false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
  set public = false,
      file_size_limit = 10485760,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

-- -----------------------------------------------------------------------------
-- 2. Metadata table
-- -----------------------------------------------------------------------------
create table if not exists public.asset_documents (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  asset_id      uuid not null references public.assets (id) on delete cascade,
  owner_id      uuid not null default auth.uid() references public.profiles (id) on delete cascade, -- 업로더
  file_name     text not null check (char_length(file_name) between 1 and 255),
  storage_path  text not null unique,
  file_size     integer not null check (file_size > 0 and file_size <= 10485760),
  mime_type     text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  document_type text not null default 'RECEIPT' check (document_type in ('RECEIPT', 'WARRANTY', 'MANUAL', 'OTHER')),
  created_at    timestamptz not null default now(),
  -- 행이 가리키는 객체는 반드시 같은 가구·같은 자산 폴더 안에 있어야 한다 (다른 가구 파일을 가리키는 행 위조 차단).
  constraint asset_documents_path_matches check (storage_path like household_id::text || '/' || asset_id::text || '/%')
);

create index if not exists asset_documents_asset_idx on public.asset_documents (asset_id, created_at desc);
create index if not exists asset_documents_household_idx on public.asset_documents (household_id);

alter table public.asset_documents enable row level security;

-- 이 테이블은 SELECT / INSERT / DELETE 만 허용한다 (UPDATE 정책 없음 = 불변 메타데이터).
drop policy if exists asset_documents_select on public.asset_documents;
create policy asset_documents_select on public.asset_documents
  for select to authenticated
  using (
    household_id = public.current_household_id()
    and exists (select 1 from public.assets a where a.id = asset_documents.asset_id) -- assets RLS: FAMILY 또는 본인 PRIVATE
  );

drop policy if exists asset_documents_insert on public.asset_documents;
create policy asset_documents_insert on public.asset_documents
  for insert to authenticated
  with check (
    household_id = public.current_household_id()
    and owner_id = auth.uid()
    and exists (select 1 from public.assets a where a.id = asset_documents.asset_id and a.household_id = asset_documents.household_id)
  );

drop policy if exists asset_documents_delete on public.asset_documents;
create policy asset_documents_delete on public.asset_documents
  for delete to authenticated
  using (
    household_id = public.current_household_id()
    and exists (select 1 from public.assets a where a.id = asset_documents.asset_id)
  );

revoke all on public.asset_documents from anon;
revoke update, truncate, references, trigger on public.asset_documents from authenticated;
grant select, insert, delete on public.asset_documents to authenticated;

-- -----------------------------------------------------------------------------
-- 3. storage.objects RLS (이 버킷 전용; 기존 manuals / receipts 정책과 무관)
--    (storage.foldername(name))[1] = household_id, [2] = asset_id
-- -----------------------------------------------------------------------------
drop policy if exists asset_documents_storage_select on storage.objects;
create policy asset_documents_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'asset-documents'
    and (storage.foldername(name))[1] = public.current_household_id()::text
    and exists (select 1 from public.assets a where a.id::text = (storage.foldername(objects.name))[2])
  );

drop policy if exists asset_documents_storage_insert on storage.objects;
create policy asset_documents_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'asset-documents'
    and (storage.foldername(name))[1] = public.current_household_id()::text
    and exists (select 1 from public.assets a where a.id::text = (storage.foldername(objects.name))[2])
  );

drop policy if exists asset_documents_storage_delete on storage.objects;
create policy asset_documents_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'asset-documents'
    and (storage.foldername(name))[1] = public.current_household_id()::text
    and exists (select 1 from public.assets a where a.id::text = (storage.foldername(objects.name))[2])
  );
-- UPDATE 정책 없음: 객체는 덮어쓸 수 없다 (upsert 불가).

commit;
