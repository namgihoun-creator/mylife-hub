-- 위시 가구 상품 썸네일(오픈그래프 og:image) URL. 선택적 마이그레이션:
-- 적용 전에도 앱은 이 컬럼 없이 조회/생성이 그대로 동작한다(서버 액션이 image_url 오류 시 컬럼 없이 재시도).
begin;

alter table public.space_furniture_candidates
  add column if not exists image_url text;

alter table public.space_furniture_candidates
  drop constraint if exists space_furniture_candidates_image_url_chk;
alter table public.space_furniture_candidates
  add constraint space_furniture_candidates_image_url_chk
  check (image_url is null or (char_length(image_url) <= 2000 and image_url ~* '^https?://'));

commit;
