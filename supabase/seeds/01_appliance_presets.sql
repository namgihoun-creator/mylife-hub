-- =============================================================================
-- MyLife Hub — Phase 1-3 seed: 생활가전 30종 기본 프리셋 (공통 참조 데이터)
-- default_tasks 의 각 원소는 task_rules 컬럼과 1:1 대응:
--   { title, recurring_type (DAILY|WEEKLY|MONTHLY|YEARLY), interval_n, anchor (DUE_DATE|COMPLETION_DATE) }
-- 6개월 = MONTHLY/6, 2년 = YEARLY/2 처럼 표현. 재실행 안전(upsert).
-- =============================================================================

create table if not exists public.appliance_presets (
  preset_key    text primary key,
  name_ko       text    not null,
  category      text    not null check (category in ('주방가전', '생활·환경가전', '계절·기타가전')),
  default_space text    not null,
  sort_order    integer not null,
  default_tasks jsonb   not null default '[]'::jsonb check (jsonb_typeof(default_tasks) = 'array')
);

alter table public.appliance_presets enable row level security;

drop policy if exists appliance_presets_select on public.appliance_presets;
create policy appliance_presets_select on public.appliance_presets
  for select to authenticated using (true);

revoke all on public.appliance_presets from anon, authenticated;
grant select on public.appliance_presets to authenticated;

insert into public.appliance_presets (preset_key, name_ko, category, default_space, sort_order, default_tasks) values
-- ---------------------------------------------------------------- 주방가전
('refrigerator',      '냉장고',        '주방가전', '주방', 1,
 '[{"title":"냉장고 내부 청소·성에 제거","recurring_type":"MONTHLY","interval_n":3,"anchor":"COMPLETION_DATE"},
   {"title":"냉장고 정수 필터 교체","recurring_type":"MONTHLY","interval_n":6,"anchor":"DUE_DATE"}]'),
('kimchi_refrigerator','김치냉장고',    '주방가전', '주방', 2,
 '[{"title":"김치냉장고 내부 청소","recurring_type":"MONTHLY","interval_n":3,"anchor":"COMPLETION_DATE"},
   {"title":"김치냉장고 탈취 필터 교체","recurring_type":"YEARLY","interval_n":1,"anchor":"DUE_DATE"}]'),
('dishwasher',        '식기세척기',     '주방가전', '주방', 3,
 '[{"title":"식기세척기 배수 필터 청소","recurring_type":"WEEKLY","interval_n":2,"anchor":"COMPLETION_DATE"},
   {"title":"식기세척기 통세척(세정제)","recurring_type":"MONTHLY","interval_n":1,"anchor":"COMPLETION_DATE"}]'),
('induction',         '인덕션/전기레인지','주방가전', '주방', 4,
 '[{"title":"인덕션 상판·흡기구 청소","recurring_type":"MONTHLY","interval_n":1,"anchor":"COMPLETION_DATE"}]'),
('water_purifier',    '정수기',        '주방가전', '주방', 5,
 '[{"title":"정수기 필터 교체","recurring_type":"MONTHLY","interval_n":6,"anchor":"DUE_DATE"},
   {"title":"정수기 위생관리(탱크·코크 세척)","recurring_type":"MONTHLY","interval_n":3,"anchor":"COMPLETION_DATE"}]'),
('microwave',         '전자레인지',     '주방가전', '주방', 6,
 '[{"title":"전자레인지 내부 청소","recurring_type":"MONTHLY","interval_n":1,"anchor":"COMPLETION_DATE"}]'),
('rice_cooker',       '전기밥솥',      '주방가전', '주방', 7,
 '[{"title":"밥솥 고무패킹 교체","recurring_type":"YEARLY","interval_n":1,"anchor":"DUE_DATE"},
   {"title":"밥솥 스팀 배출구·내솥 점검 청소","recurring_type":"MONTHLY","interval_n":1,"anchor":"COMPLETION_DATE"}]'),
('coffee_machine',    '커피머신',      '주방가전', '주방', 8,
 '[{"title":"커피머신 스케일 제거(descaling)","recurring_type":"MONTHLY","interval_n":2,"anchor":"COMPLETION_DATE"},
   {"title":"커피머신 물탱크·필터 교체","recurring_type":"MONTHLY","interval_n":2,"anchor":"DUE_DATE"}]'),
('air_fryer',         '에어프라이어',    '주방가전', '주방', 9,
 '[{"title":"에어프라이어 바스켓·히터 덮개 깊은 청소","recurring_type":"MONTHLY","interval_n":1,"anchor":"COMPLETION_DATE"}]'),
('range_hood',        '주방 후드',     '주방가전', '주방', 10,
 '[{"title":"후드 필터(그리스 필터) 세척","recurring_type":"MONTHLY","interval_n":1,"anchor":"COMPLETION_DATE"},
   {"title":"후드 필터 교체","recurring_type":"YEARLY","interval_n":1,"anchor":"DUE_DATE"}]'),
('electric_kettle',   '전기포트',      '주방가전', '주방', 11,
 '[{"title":"전기포트 구연산 세척","recurring_type":"MONTHLY","interval_n":1,"anchor":"COMPLETION_DATE"}]'),
('gas_range',         '가스레인지',     '주방가전', '주방', 12,
 '[{"title":"가스레인지 버너 청소·점화 상태 확인","recurring_type":"MONTHLY","interval_n":1,"anchor":"COMPLETION_DATE"},
   {"title":"가스 호스·연결부 안전 점검","recurring_type":"YEARLY","interval_n":1,"anchor":"DUE_DATE"}]'),
-- ------------------------------------------------------------ 생활·환경가전
('washer',            '세탁기',        '생활·환경가전', '세탁실', 13,
 '[{"title":"세탁기 통세척","recurring_type":"MONTHLY","interval_n":1,"anchor":"COMPLETION_DATE"},
   {"title":"세탁기 먼지 거름망·배수필터 청소","recurring_type":"MONTHLY","interval_n":1,"anchor":"COMPLETION_DATE"}]'),
('dryer',             '건조기',        '생활·환경가전', '세탁실', 14,
 '[{"title":"건조기 먼지 필터 세척","recurring_type":"WEEKLY","interval_n":1,"anchor":"COMPLETION_DATE"},
   {"title":"건조기 열교환기(콘덴서) 청소","recurring_type":"MONTHLY","interval_n":3,"anchor":"COMPLETION_DATE"}]'),
('aircon',            '에어컨',        '생활·환경가전', '거실', 15,
 '[{"title":"에어컨 필터 청소","recurring_type":"MONTHLY","interval_n":1,"anchor":"COMPLETION_DATE"},
   {"title":"에어컨 전문 분해 세척","recurring_type":"YEARLY","interval_n":1,"anchor":"DUE_DATE"}]'),
('air_purifier',      '공기청정기',     '생활·환경가전', '거실', 16,
 '[{"title":"공기청정기 프리필터 청소","recurring_type":"MONTHLY","interval_n":1,"anchor":"COMPLETION_DATE"},
   {"title":"공기청정기 헤파필터 교체","recurring_type":"MONTHLY","interval_n":12,"anchor":"DUE_DATE"}]'),
('dehumidifier',      '제습기',        '생활·환경가전', '거실', 17,
 '[{"title":"제습기 물통·에어필터 청소","recurring_type":"WEEKLY","interval_n":2,"anchor":"COMPLETION_DATE"}]'),
('humidifier',        '가습기',        '생활·환경가전', '안방', 18,
 '[{"title":"가습기 물통·초음파 진동판 세척","recurring_type":"WEEKLY","interval_n":1,"anchor":"COMPLETION_DATE"},
   {"title":"가습기 필터 교체","recurring_type":"MONTHLY","interval_n":3,"anchor":"DUE_DATE"}]'),
('robot_vacuum',      '로봇청소기',     '생활·환경가전', '거실', 19,
 '[{"title":"로봇청소기 먼지통·센서 청소","recurring_type":"WEEKLY","interval_n":1,"anchor":"COMPLETION_DATE"},
   {"title":"로봇청소기 사이드브러시·필터 교체","recurring_type":"MONTHLY","interval_n":6,"anchor":"DUE_DATE"}]'),
('cordless_vacuum',   '무선청소기',     '생활·환경가전', '거실', 20,
 '[{"title":"무선청소기 필터 세척","recurring_type":"MONTHLY","interval_n":1,"anchor":"COMPLETION_DATE"},
   {"title":"무선청소기 배터리 상태 점검","recurring_type":"MONTHLY","interval_n":12,"anchor":"DUE_DATE"}]'),
('styler',            '스타일러',      '생활·환경가전', '안방', 21,
 '[{"title":"스타일러 물통·배수 청소","recurring_type":"MONTHLY","interval_n":1,"anchor":"COMPLETION_DATE"},
   {"title":"스타일러 먼지 필터 교체","recurring_type":"MONTHLY","interval_n":6,"anchor":"DUE_DATE"}]'),
('boiler',            '보일러',        '생활·환경가전', '다용도실', 22,
 '[{"title":"보일러 난방 배관 점검(시즌 전)","recurring_type":"YEARLY","interval_n":1,"anchor":"DUE_DATE"},
   {"title":"보일러 압력·배관 연결 확인","recurring_type":"MONTHLY","interval_n":3,"anchor":"COMPLETION_DATE"}]'),
('bidet',             '비데',          '생활·환경가전', '화장실', 23,
 '[{"title":"비데 노즐 청소","recurring_type":"MONTHLY","interval_n":1,"anchor":"COMPLETION_DATE"},
   {"title":"비데 필터 교체","recurring_type":"MONTHLY","interval_n":3,"anchor":"DUE_DATE"}]'),
('tv',                'TV',           '생활·환경가전', '거실', 24,
 '[{"title":"TV 화면·통풍구 먼지 청소","recurring_type":"MONTHLY","interval_n":3,"anchor":"COMPLETION_DATE"}]'),
-- ------------------------------------------------------------ 계절·기타가전
('electric_fan',      '선풍기',        '계절·기타가전', '거실', 25,
 '[{"title":"선풍기 날개·보호망 청소(시즌 시작 전)","recurring_type":"YEARLY","interval_n":1,"anchor":"DUE_DATE"}]'),
('air_circulator',    '서큘레이터',     '계절·기타가전', '거실', 26,
 '[{"title":"서큘레이터 날개·모터 먼지 청소","recurring_type":"MONTHLY","interval_n":3,"anchor":"COMPLETION_DATE"}]'),
('electric_heater',   '전기히터/난로',   '계절·기타가전', '거실', 27,
 '[{"title":"전기히터 전선·안전장치 점검(시즌 전)","recurring_type":"YEARLY","interval_n":1,"anchor":"DUE_DATE"},
   {"title":"전기히터 흡기구 먼지 청소","recurring_type":"MONTHLY","interval_n":1,"anchor":"COMPLETION_DATE"}]'),
('electric_blanket',  '전기장판/전기요', '계절·기타가전', '안방', 28,
 '[{"title":"전기장판 전선·온도조절기 점검(시즌 전)","recurring_type":"YEARLY","interval_n":1,"anchor":"DUE_DATE"}]'),
('door_lock',         '디지털 도어락',   '계절·기타가전', '현관', 29,
 '[{"title":"도어락 건전지 교체","recurring_type":"MONTHLY","interval_n":6,"anchor":"DUE_DATE"}]'),
('smoke_detector',    '화재감지기',     '계절·기타가전', '거실', 30,
 '[{"title":"화재감지기 작동 테스트","recurring_type":"MONTHLY","interval_n":6,"anchor":"DUE_DATE"},
   {"title":"화재감지기 배터리 교체","recurring_type":"YEARLY","interval_n":1,"anchor":"DUE_DATE"}]')
on conflict (preset_key) do update set
  name_ko       = excluded.name_ko,
  category      = excluded.category,
  default_space = excluded.default_space,
  sort_order    = excluded.sort_order,
  default_tasks = excluded.default_tasks;
