-- =============================================================================
-- MyLife Hub — Phase 3-1: rental / subscription support on assets
--
-- NOTE: this file was reconstructed from the LIVE cloud schema (column definitions, defaults, column comments
-- and CHECK behaviour were read back from the running project) because the original SQL that was applied in
-- the SQL Editor was not available locally. It is written to be idempotent, so running it against the project
-- where 09 is already applied is a no-op and running it on a fresh database reproduces the same shape.
-- If the original statement contained anything else (indexes, triggers, …), diff it against this file.
--
-- Verified against the live DB:
--   * ownership_type  : 'OWNED' | 'RENTAL' (CHECK assets_ownership_type_check, NULL allowed), default 'OWNED'
--   * care_type       : 'VISIT' | 'SELF' | 'NONE' (CHECK assets_care_type_check, NULL allowed), default 'NONE'
--   * billing_day     : 1..31 (CHECK assets_billing_day_check)
--   * NOT constrained in the DB: monthly_fee >= 0, obligation_end_date >= contract_start_date,
--     "rental fields only when RENTAL" — the application validates these (zod, features/assets/schemas).
-- =============================================================================

alter table public.assets
  add column if not exists ownership_type         text default 'OWNED',
  add column if not exists rental_provider        text,
  add column if not exists monthly_fee            integer,
  add column if not exists billing_day            integer,
  add column if not exists contract_start_date    date,
  add column if not exists obligation_end_date    date,
  add column if not exists ownership_transfer_date date,
  add column if not exists care_type              text default 'NONE',
  add column if not exists payment_card_note      text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'assets_ownership_type_check' and conrelid = 'public.assets'::regclass) then
    alter table public.assets
      add constraint assets_ownership_type_check check (ownership_type in ('OWNED', 'RENTAL'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'assets_care_type_check' and conrelid = 'public.assets'::regclass) then
    alter table public.assets
      add constraint assets_care_type_check check (care_type in ('VISIT', 'SELF', 'NONE'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'assets_billing_day_check' and conrelid = 'public.assets'::regclass) then
    alter table public.assets
      add constraint assets_billing_day_check check (billing_day between 1 and 31);
  end if;
end;
$$;

comment on column public.assets.ownership_type          is '소유 형태 (OWNED: 직접 구매, RENTAL: 렌탈/구독)';
comment on column public.assets.rental_provider         is '렌탈사명 (예: 코웨이, SK매직, LG)';
comment on column public.assets.monthly_fee             is '월 렌탈료 (원)';
comment on column public.assets.billing_day             is '매월 결제일 (1~31)';
comment on column public.assets.obligation_end_date     is '의무 약정 만료일 (위약금 면제 기점)';
comment on column public.assets.ownership_transfer_date is '소유권 이전 만료일';
comment on column public.assets.care_type               is '케어 방식 (VISIT: 방문 코디, SELF: 자가 관리/정기 배송, NONE: 없음)';
comment on column public.assets.payment_card_note       is '제휴카드 및 실적 조건 메모 (예: KB국민 30만원 실적)';
