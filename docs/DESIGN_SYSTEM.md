# MyLife Hub UX/UI Design System Specification (v3 · Modern Tech Minimal)

> **필수 준수:** 모든 프론트엔드 UI 컴포넌트와 페이지는 이 문서의 토큰·패턴을 따른다 (CLAUDE.md §4.F).
> 벤치마크: CookSaver 스타일 — 따뜻한 웜 슬레이트 배경, 상태 중심 뱃지, 알약 필터, 아이콘 박스 카드.
> **v3 (현재 규격) — Vercel / Supabase 대시보드 스타일의 모던 테크 미니멀리즘 + 완전한 라이트/다크.** 아래 "v3 토큰" 절이 v2 본문과 충돌하면 **v3가 우선**한다 (v2 본문의 `slate-*` 색은 `zinc` 스케일로 매핑되고, 컨테이너 `rounded-2xl`은 `rounded-xl`, 내부 요소 `rounded-xl`은 `rounded-lg`, 카드 그림자는 1px 보더로 대체).
> v2 변경 요약: 와이드 컨테이너(`max-w-6xl`) · 블러 헤더 · 틴트/인셋 요약 배너 + 펄스 · 3열 그리드 + 소모품 게이지 · 섹션별 성격 분리(Overdue/Today/Upcoming) · 올 클리어 일러스트 · 스켈레톤.

## 00. v4 — 밝고 친근한 에듀테크 톤 (최우선 · 아래 v3 및 §K~Q의 "1px 보더" 규칙을 대체)
> 방향: 학습 앱처럼 **맑고 밝고 말랑한** 화면. 라이트가 기본이고, 다크는 헤더 토글로만 켠다(OS 설정을 따라가지 않는다). 아래 규칙이 v3 문서와 충돌하면 **이 절이 이긴다.** 상태 의미(D-Day 신호등·게이지 단계·댕냥이 경고 등)와 `data-testid`는 그대로다.

- **무드·배경:** 페이지는 맑은 오프화이트 `bg-slate-50`(다크 `dark:bg-zinc-950`), 그 위에 흰 카드가 떠 있는(elevated) 느낌. `slate`는 Tailwind 기본(쿨 블루그레이)을 쓴다. 오로라 배경은 파스텔 그대로 유지한다.
- **카드:** `rounded-3xl bg-white shadow-sm`(호버 `hover:shadow-md`), 다크 `dark:bg-zinc-900`. **하드한 1px 보더 금지** — 구분은 그림자·면색으로만 한다. 카드 안의 하위 패널은 보더 없이 `rounded-2xl bg-slate-50`(다크 `dark:bg-zinc-800/60`). 모달은 `rounded-3xl shadow-xl`, 하단 탭은 `rounded-t-3xl` + 위로 퍼지는 그림자.
- **버튼·입력:** 기본(Primary)은 **Sky Blue** `bg-sky-600 text-white shadow-sm hover:bg-sky-700`(다크 `dark:bg-sky-500`), 보조는 `bg-sky-50 text-sky-700` 또는 `bg-white shadow-sm`, 위험은 코랄 `bg-rose-500`. 입력은 보더 없는 채움형 `bg-slate-100 rounded-2xl`, 포커스 시 흰 배경 + `ring-2 ring-sky-400`. 눌림 피드백 `active:scale-95`(`motion-reduce` 존중).
- **터치:** 모든 주요 버튼·칩·입력은 **최소 높이 44px**(`min-h-11`), 칩 사이 간격 `gap-2` 이상. 가로로 넘치는 칩 줄은 `overflow-x-auto snap-x`로 스와이프하게 하고 스크롤바는 숨긴다.
- **타이포:** 제목 `font-extrabold`(`text-3xl`/`text-base`), 숫자·강조 `font-extrabold tabular-nums`, 본문 보조 `text-slate-500 font-medium`(최소 12px, 읽는 글은 14px 이상). 라벨은 굵게(`font-bold`)해 모바일에서 또렷하게.
- **컬러:** 네온 금지. 포인트는 **Sky Blue**(기본·선택) · **Mint**(`emerald-400/teal-400`, 성공·절약) · **Coral**(`rose-400/500`, 경고·초과) · Sunny(`amber-400`, 주의). 상태 칩은 보더 없는 `*-50` 면 + `*-600` 글자(다크 `*-950/40` + `*-300`). 의미 매핑은 불변: D-Day ≤2일 Rose / ≤7일 Amber / 그 외 Emerald / 지난 날짜 진한 Rose 채움, 화석 Cyan, 게이지 80% Amber·100% Rose·그 외 Mint.
- **게이미피케이션:** `ProgressRing`(`ui/progress-ring.tsx`, 굵은 둥근 호 + 가운데 %, 100% 초과는 호를 가득 채우고 숫자는 실제 값) · 두툼한 진도율 바(`h-4 rounded-full`, 흰 트랙 `shadow-inner`) · 성취 뱃지(절약액 민트 그라데이션 알약, `구출 N번` 선샤인 알약) · 오늘의 권장 식비 팝 알약(Sky→Teal 그라데이션 + 그림자, 초과 시 코랄 틴트로 전환).
- **키친 적용:** `KitchenPulse` = 컬러 아이콘 버블 + `text-3xl` 숫자 · `KitchenBudgetCard` = 링 + 팝 알약 + 두툼한 게이지 2개 + 둥근 최근 지출 행(구분선 없음) · `KitchenItemCard` = 여백 넉넉한 `rounded-3xl` 카드(지난 재료는 코랄 틴트 + `ring-2`), D-Day·화석·펫 칩은 보더 없는 둥근 칩, 액션은 `min-h-10` 소프트 버튼(`다 먹었어요`만 Sky) · `StorageTabs`·`LocalLifeRadar` = 큼직한 라운드 칩(`min-h-11/12`), 활성 칩은 Sky 채움 + 그림자.
- **접근성:** 색만으로 상태를 구분하지 않고 항상 텍스트(`D-2`, `85%`, `초과`)를 병기한다. 본문 대비는 WCAG AA(4.5:1), 흰 글자 Sky 버튼은 `sky-600` 이상만 쓴다.

## 0. v3 토큰 (우선 적용 → v4로 대체됨: 위 "00. v4" 참고)

### 테마
- `next-themes`: `attribute="class"`, `defaultTheme="system"`, `enableSystem`, `<html suppressHydrationWarning>`. 사용자가 헤더의 **Sun/Moon 토글**로 라이트/다크를 고르면 localStorage(`theme`)에 저장, 선택 전에는 OS 설정을 따른다.
- 토글(`ThemeToggle`): `h-8 w-8 rounded-lg` 고스트 아이콘 버튼, Sun과 Moon을 겹쳐 놓고 `dark:` 클래스로 **회전 + 스케일 + 투명도 크로스페이드**(`transition-all duration-300`, `motion-reduce:transition-none`). 하이드레이션 불일치가 없도록 아이콘 전환은 CSS(`dark:`)로만 한다. 공개 페이지(로그인·Magic Link·초대)에는 우상단 고정 토글.
- 모든 색 클래스는 라이트/다크 쌍으로 쓴다(`dark:` 필수, CLAUDE.md §4.F).

### 색 (zinc 중립 + 의미색 액센트)
| 용도 | Light | Dark |
|---|---|---|
| 페이지 바탕 | `bg-white` | `dark:bg-black` |
| 표면(카드·모달·팝오버) | `bg-white border border-zinc-200` | `dark:bg-zinc-950 dark:border-zinc-800` |
| 보조 표면(입력·패널 틴트) | `bg-zinc-50` | `dark:bg-zinc-900/50` |
| 본문 / 보조 텍스트 | `text-zinc-900` / `text-zinc-500` | `dark:text-zinc-50` / `dark:text-zinc-400` |
| Primary 버튼·활성 알약 | `bg-black text-white hover:bg-zinc-800` | `dark:bg-white dark:text-black dark:hover:bg-zinc-200` |
| Secondary / Outline | `border border-zinc-200 bg-transparent text-zinc-900 hover:bg-zinc-100` | `dark:border-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-900` |
| 입력 | `rounded-lg border-zinc-200 bg-white` | `dark:border-zinc-800 dark:bg-black` |
| 입력 포커스(날렵한 단색 링) | `focus-visible:border-zinc-900 focus-visible:ring-1 focus-visible:ring-zinc-900` | `dark:focus-visible:border-zinc-100 dark:focus-visible:ring-zinc-100` |
| 헤더 | `sticky top-0 z-50 backdrop-blur-md bg-white/80 border-b border-zinc-200/80` | `dark:bg-black/80 dark:border-zinc-800/80` |
- **의미색 액센트**(Supabase 스타일, 은은하게): 완료·활성·성공 = emerald, 렌탈·구독 = violet, 정보 = sky, 주의 = amber, 위험 = rose. 면적은 작게(뱃지·아이콘·1px 보더·점).

### 모양
- 카드·모달·배너 `rounded-xl`, 버튼·입력·아이콘 박스·칩 `rounded-lg`, 알약·캡슐·아바타 `rounded-full`.
- **그림자 없음**: 카드는 `border border-zinc-200 dark:border-zinc-800` 1px 보더만. 오버레이(모달·팝오버·드롭다운·토스트)에만 `shadow-lg`. 호버는 보더 색 전환(`hover:border-zinc-300 dark:hover:border-zinc-700`, `transition-colors`).

### 앰비언트 메쉬 오로라 (페이지 최상단 배경)
- `AmbientBackground`: 페이지 래퍼(`relative isolate overflow-x-clip bg-white dark:bg-black`) 안 첫 자식, `absolute inset-x-0 top-0 -z-10 h-[520px] overflow-hidden pointer-events-none` + 아래로 사라지는 마스크(`[mask-image:linear-gradient(to_bottom,black,transparent)]`). 안에 흐릿한 파스텔 원 3개(violet · sky · emerald, `blur-3xl`): 라이트 `/25~30`, 다크 `/10~15` 불투명도. 정보 요소가 아니므로 `aria-hidden`.

### 소유 형태 선택형 세그먼트 카드 (Vercel Secret/Config 스타일)
- 2열 카드 라디오(`role="radiogroup"` / `role="radio" aria-checked`): 좌측 **라디오 인디케이터**(`h-4 w-4 rounded-full border`, 선택 시 안쪽 점), 제목(`text-sm font-medium`) + 한 줄 설명(`text-xs` 보조). 선택된 카드는 `border-zinc-900 ring-1 ring-zinc-900 dark:border-zinc-100 dark:ring-zinc-100`, 비선택은 `border-zinc-200 dark:border-zinc-800 hover:border-zinc-300`. 렌탈은 선택 시 인디케이터에 violet 액센트.

### 메트릭 카드 (요약 배너 · 렌탈 요약 · 3-Way 비교)
- 군더더기 없는 평평한 타일: `rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950`, 라벨(`text-xs` 보조) → 큰 숫자(`text-2xl font-semibold tracking-tight tabular-nums`) → 보조 한 줄. 아이콘은 `h-4 w-4` 모노톤(액센트는 점·뱃지로). 그라데이션 금지.

### 문서 & 보증서 탭 (Track B)
- 자산 상세 모달의 탭: `정보` · `환승 & 비용 비교`(렌탈 전용) · `문서 & 보증서`. 탭 알약은 `rounded-lg`, 활성은 Primary(`bg-black text-white dark:bg-white dark:text-black`), 비활성은 Outline.
- **문서 유형 선택**: 소유 형태 카드와 같은 라디오 인디케이터 칩(`rounded-lg border`, 선택 시 `border-zinc-900 ring-1`) — 영수증 · 보증서 · 설명서 · 기타.
- **파일 업로더(드롭존)**: `rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700`, 드래그 중 `border-zinc-900 bg-zinc-50`(다크 `border-zinc-100`). 중앙에 `h-10 w-10 rounded-lg` 아이콘 박스 → 제목(`text-sm font-medium`) → 제한 안내(`text-xs` 보조) → Outline "파일 선택" 버튼. 업로드 중에는 아이콘이 스피너로 바뀌고 버튼이 비활성화된다.
- **문서 카드**: `rounded-xl border` 1px 평평한 행. 좌측 `h-12 w-12 rounded-lg` 썸네일(이미지) 또는 PDF 아이콘(rose), 가운데 파일명(`truncate`) + 유형 태그(영수증 emerald · 보증서 violet · 설명서 sky · 기타 zinc) + `용량 · 날짜`, 우측 다운로드 / 삭제 아이콘 버튼(`h-8 w-8 rounded-lg`). 삭제는 2단계(`삭제 확인` rose 버튼 + `취소`).
- 상태 메시지: `text-xs font-medium`, 오류 rose / 성공 emerald (`role="status"`).

### 소모품 구매 (Track C)
- **소모품 스트립**: `rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/50` 한 줄. 좌측 `Package` 아이콘(모노톤), 이름 · 모델명(모델명은 `font-mono text-[11px]` 보조색), 우측 "복사" 고스트 버튼(복사 후 1.6초간 emerald `Check` + "복사됨"). 모델명이 있으면 모델명, 없으면 이름을 복사한다.
- **[소모품 구매 ↗] 버튼**: Outline 버튼(`h-8 rounded-lg border border-zinc-200 dark:border-zinc-800`, `text-xs font-medium`) + `ArrowUpRight` 아이콘. 사용자 지정 링크가 있으면 그 링크 하나, 없으면 네이버 쇼핑 검색 + 보조(회색 텍스트) "다나와 ↗". 항상 `target="_blank" rel="noopener noreferrer"`.
- 타임라인 카드: 소모품이 있으면 태그 아래 스트립, 하단 줄 우측에 구매 버튼(+ 더보기). 모바일에서는 줄바꿈(`flex-wrap`)한다. 완료 내역 카드에는 표시하지 않는다.
- 자산 상세 "관리 규칙": 규칙 행마다 스트립 + 구매 버튼 + (관리자) "소모품 등록/수정", 섹션 제목 옆 "규칙 추가"(Outline `h-7`). 규칙 모달은 소유 형태·문서 폼과 같은 입력 규격이며 소모품 정보는 `rounded-xl border` 묶음 안에 둔다.

## 1. 디자인 철학
- **따뜻하고 정돈된 생활 OS:** 딱딱한 관리자 도구가 아닌, 매일 열어보고 싶은 가족 친화적 SaaS 대시보드.
- **상태 중심 시각화:** 텍스트 나열을 지양하고 D-Day 뱃지, 카테고리 아이콘, 게이지, 요약 위젯으로 현황을 1초 만에 파악.
- **절제된 모션:** 호버 엘리베이션·펄스·축하 애니메이션은 모두 `motion-reduce:` 로 끌 수 있어야 한다.

## 2. 색상 토큰

| 용도 | Light | Dark |
|---|---|---|
| 페이지 배경 | `bg-slate-50/70` | `dark:bg-zinc-950` |
| Surface (카드·모달) | `bg-white border border-slate-200/80 shadow-sm` | `dark:bg-zinc-900/90 dark:border-zinc-800` |
| 본문 강조 텍스트 | `text-slate-900` | `dark:text-zinc-50` |
| 섹션 텍스트 | `text-slate-800` | `dark:text-zinc-200` |
| 보조 텍스트 | `text-slate-500` | `dark:text-zinc-400` |
| 구분선 | `border-slate-200/80` | `dark:border-zinc-800` |
| Primary 버튼 / 활성 필터 | `bg-slate-900 text-white` | `dark:bg-zinc-100 dark:text-zinc-900` |
| 헤더 | `bg-white/80 backdrop-blur-md border-slate-200/80` | `dark:bg-zinc-900/80 dark:border-zinc-800` |

### 긴급도 뱃지 (Urgency Semantics)
| 상태 | 조건 | 클래스 |
|---|---|---|
| 기한 초과 `overdue` | D < 0 | `bg-rose-50 text-rose-600 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-900` |
| 임박 `soon` | 0 ≤ D ≤ 7 | `bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900` |
| 여유 `ok` | D ≥ 8 | `bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900` |
| 정보 `info` / 예정 없음 | 과업 없음 | `bg-sky-50 text-sky-600 border-sky-200 dark:bg-sky-950/40 dark:text-sky-400 dark:border-sky-900` |

**D-Day 라벨:** 오늘 `D-Day` · 남음 `D-3` · 초과 `D+2`. 기준일은 **Asia/Seoul 달력 날짜**, 구현은 `src/shared/lib/dday.ts`.
뱃지 형태: `inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold tabular-nums` (큰 사이즈 `lg`: `px-3 py-1 text-sm`).
게이지 채움색: overdue `bg-rose-500` · soon `bg-amber-500` · ok `bg-emerald-500` · none `bg-sky-400` (`URGENCY_BAR_CLASS`).

### 아이콘 박스 톤 (톤다운 파스텔 · v2)
`bg-{c}-50 text-{c}-500 ring-1 ring-inset ring-{c}-100 dark:bg-{c}-950/40 dark:text-{c}-400 dark:ring-{c}-900/50` — c ∈ sky, amber, rose, emerald, violet, orange, cyan. slate는 `bg-slate-100 text-slate-500 ring-1 ring-inset ring-slate-200/70 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700/60`.
아이콘 박스에는 `shadow-sm` 을 함께 쓴다. (Tailwind JIT 때문에 클래스는 **완성된 문자열**로 코드에 적는다. 보간 금지.)

## 3. 타이포그래피 · 간격 · 모서리 · 레이아웃

| 역할 | 클래스 |
|---|---|
| 대시보드 타이틀 | `text-2xl font-bold tracking-tight text-slate-900 dark:text-zinc-50` |
| 섹션 타이틀 | `text-base font-semibold text-slate-800 dark:text-zinc-200` |
| 카드 제목(자산명·과업명) | `text-sm font-semibold text-slate-900 dark:text-zinc-50` |
| 보조 설명·메타 | `text-xs font-normal text-slate-500 dark:text-zinc-400` |
| 지표 숫자(요약 배너) | `text-2xl sm:text-3xl font-extrabold tracking-tight tabular-nums` |

- **레이아웃:** 헤더·본문 모두 `mx-auto w-full max-w-6xl px-4 sm:px-6`, 본문 상하 `py-6`, 모바일 하단 탭 바 여유 `pb-24 md:pb-8`.
- **모서리:** 컨테이너(카드·모달·배너) `rounded-2xl` · 내부 박스/버튼/입력 `rounded-xl` · 뱃지·필터·태그·캡슐 `rounded-full`.
- **간격:** 페이지 섹션 간 `space-y-6` · 카드 내부 패딩 `p-4`(리스트 카드) / `p-5`(배너·빈 상태) · 카드 그리드 `gap-4` · 필터 사이 `gap-2`.
- **폰트:** Noto Sans KR (`font-sans`, layout.tsx에서 주입). 본문 최소 `text-xs`.
- **터치 영역:** 버튼·필터 높이 최소 32px(`py-1.5` 이상).
- **모바일 안전 규칙 (Playwright 점검에서 확인된 항목):** ① 카드 그리드는 반드시 `grid-cols-1` 로 시작한다(암시적 컬럼은 내용 폭만큼 늘어나 가로 넘침 발생). ② 헤더 CTA 버튼은 `shrink-0 whitespace-nowrap`. ③ 카드 제목은 `line-clamp-2 break-keep`, 요약 배너 라벨은 모바일에서 줄바꿈 허용(`sm:truncate`).
- **자동 점검:** `npm run screens` 가 `/assets`·`/timeline` 을 데스크톱(1280×800)/모바일(375×812)로 캡처하고(`.screenshots/`) 레이아웃 규칙(3열 그리드, max-w-6xl 중앙 정렬, 배너, D-Day 뱃지, 게이지, 가로 넘침 없음)을 검사한다. UI 변경 후 반드시 실행한다.

## 4. 컴포넌트 표준 패턴

### 헤더 (Global Header)
- `sticky top-0 z-50 border-b border-slate-200/80 bg-white/80 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-900/80`, 높이 `h-14`.
- 좌측: **로고 뱃지**(`h-8 w-8 rounded-xl bg-slate-900 text-white` + 아이콘) + 워드마크(`text-sm font-bold tracking-tight`), 바로 옆 **가구명 캡슐**(`rounded-full border bg-slate-50 px-2.5 py-1 text-[11px] font-medium` + 작은 아이콘, `truncate`).
- 중앙: 데스크톱 세그먼트 내비 — 컨테이너 `rounded-full border bg-slate-100/60 p-1`, 항목 `rounded-full px-3.5 py-1.5 text-xs font-medium`, 활성 `bg-white text-slate-900 shadow-sm dark:bg-zinc-800`.
- 우측: 이니셜 아바타(`h-8 w-8 rounded-full`) + 로그아웃 아이콘 버튼. 모바일은 하단 탭 바.

### A. 요약 배너 (Summary Banner) — `ui/summary-banner.tsx`
- 컨테이너: `rounded-2xl border border-slate-200/80 bg-gradient-to-br from-white to-slate-50 p-4 sm:p-5 shadow-sm ring-1 ring-inset ring-white/60` (다크: `from-zinc-900 to-zinc-900/60 ring-white/5`) — 은은한 서피스 틴트 + 인셋 보더.
- `grid grid-cols-3 gap-3 sm:gap-4`, 각 칸은 `rounded-xl` 타일(`bg-white/70 ring-1 ring-inset ring-slate-200/60`): 아이콘 뱃지(`h-9 w-9 rounded-xl`, 상태색) + 지표 숫자 + 라벨(`text-xs` 보조).
- **경고 타일(danger):** 타일이 `bg-rose-50/80 ring-rose-200/70` 로 바뀌고, 우상단에 **펄스 점**(`animate-ping` + 고정 점, `motion-reduce:animate-none`), 숫자는 `text-rose-600`.
- 자산: 등록 가전 / 이번 달 도래 과업(말일까지, 기한 초과 포함) / 임박(D-7 이내, 기한 초과 포함 — 기한 초과 시 danger).
- 타임라인: 오늘 할 일(>0 amber, 0 emerald) / 기한 초과(>0 danger+펄스) / 7일 내 예정(sky).

### B. 세그먼트 필터 (Filter Pills)
- 탭 대신 알약 토글. 공통: `rounded-full px-4 py-1.5 text-xs font-medium transition-colors`.
- 활성: `bg-slate-900 text-white shadow-sm dark:bg-zinc-100 dark:text-zinc-900`
- 비활성: `bg-white text-slate-600 hover:bg-slate-100 border border-slate-200 dark:bg-zinc-900 dark:text-zinc-300 dark:border-zinc-800 dark:hover:bg-zinc-800`
- 가로가 넘치면 `flex gap-2 overflow-x-auto` (스크롤바 숨김), 줄바꿈 금지.

### C. 아이템 카드 (Asset & Task Card) — 3단 구조
`rounded-2xl border bg-white p-4 shadow-sm` + **호버 엘리베이션** `transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md motion-reduce:transform-none`
1. **좌측:** 톤다운 아이콘 박스 `h-11 w-11 shrink-0 rounded-xl shadow-sm` + Lucide 아이콘(`h-5 w-5`).
2. **중앙(`min-w-0 flex-1`):** 이름(굵게, `truncate`) · 위치/카테고리 태그(`rounded-full bg-slate-100 text-slate-600 px-2 py-0.5 text-[11px]`) · 주기 요약 문구(보조 텍스트).
3. **우측(`shrink-0`):** D-Day 뱃지 + 보조 요소(다음 과업명 또는 완료 버튼).

**C-1. 카드 푸터 (선택):** `mt-3 flex items-center justify-between border-t border-slate-100 pt-2 dark:border-zinc-800`. 좌측 메타(예: `11/13 예정`), 우측 **더보기** 트리거(`rounded-full border px-2.5 py-1 text-xs font-medium` + `MoreHorizontal`). 메뉴는 `rounded-xl` Surface, 항목은 아이콘 + 라벨, 파괴적/우회 동작(건너뛰기)은 구분선 아래.

**C-2. 낙관적 완료 상태:** 완료 직후(서버 응답 전) 카드 `opacity-60`, 제목 `line-through`, 완료 버튼 `bg-emerald-500 text-white scale-110`(`transition-all duration-300`). 실패 시 원복 + 상단 오류 배너(`rounded-xl border-rose-200 bg-rose-50 text-xs font-medium text-rose-600`).

**C-3. 접이식 섹션 헤더:** `button[aria-expanded]` = 아이콘 박스(`h-8 w-8 rounded-xl`) + 섹션 타이틀(`text-base font-semibold`) + 건수(보조) + 우측 `ChevronDown`(펼침 시 회전).

**C-4. 소모품 게이지 (자산 카드):** 카드 하단 `mt-3`. 트랙 `h-1.5 rounded-full bg-slate-100 dark:bg-zinc-800`, 채움 `rounded-full transition-[width] duration-500` (색은 긴급도 `URGENCY_BAR_CLASS`). 채움 폭 = **남은 일수 ÷ 주기 일수**(주기: DAILY n · WEEKLY 7n · MONTHLY 30n · YEARLY 365n, 0~100% 클램프). 기한 초과는 100% 로즈 채움. 우측 캡션 `text-[11px]` 보조(`24일 남음 · 80%` / `3일 초과`). `role="progressbar"` + `aria-valuenow`.

**C-5. 완료 체크 버튼:** 원형 `h-9 w-9 rounded-full border-2 border-slate-200 text-slate-400`, 호버 `border-emerald-400 bg-emerald-50 text-emerald-600`, 눌림 `active:scale-95`, 완료 `bg-emerald-500 border-emerald-500 text-white`.

### 타임라인 섹션 성격 (Overdue / Today / Upcoming)
| 섹션 | 컨테이너 | 라벨 | 카드 |
|---|---|---|---|
| 기한 초과 | `rounded-2xl border border-rose-200/80 bg-rose-50/60 p-4` (다크 `border-rose-900/60 bg-rose-950/20`) | `긴급` 칩 `bg-rose-600 text-white text-[10px] font-bold rounded-full px-2 py-0.5` | `border-rose-200/80` |
| 오늘 할 일 | `rounded-2xl border border-amber-300/70 bg-amber-50/40 p-4 ring-2 ring-amber-200/50` (다크 `border-amber-800/60 bg-amber-950/15 ring-amber-900/30`) | `TODAY` 칩 `bg-amber-500 text-white` | `border-l-4 border-l-amber-400` 액센트 |
| 다가오는 | 컨테이너 없음 | 없음 | 기본 Surface, **큰 D-Day 뱃지(`lg`)** 중심 |
| 최근 완료 | 컨테이너 없음 | 없음 | 기본 Surface + `opacity-60` |

### D. 엠프티 스테이트 (Empty State)
- 단순 텍스트 박스 금지. 구성: **원형 배경 아이콘(`h-14 w-14 rounded-full bg-slate-100 dark:bg-zinc-800`) → 제목 → 안내 문구 → Primary CTA**. 점선 테두리 `border-dashed` Surface, 중앙 정렬, 패딩 `p-10`. 컴포넌트: `ui/empty-state.tsx` (`art` prop으로 아이콘 영역 교체 가능).
- **올 클리어(All Clear):** `ui/celebration-art.tsx` — 그라데이션 라운드 박스(`from-amber-100 via-rose-100 to-violet-100`) + 파티 아이콘 + 주변 컨페티 점/반짝임(`animate-bounce`/`animate-ping`, 지연은 inline `animationDelay`, 전부 `motion-reduce:animate-none`).
- **로딩:** 라우트별 `loading.tsx` 에 `ui/skeleton.tsx`(`animate-pulse rounded-2xl bg-slate-200/70 dark:bg-zinc-800`)로 실제 레이아웃(배너·카드 그리드)과 같은 형태의 스켈레톤을 둔다.

### F. 토스트 (Inline Toast)
- 화면 하단 중앙 고정 알약: `fixed left-1/2 z-50 -translate-x-1/2 rounded-full px-4 py-2 text-xs font-medium shadow-lg` — 모바일은 하단 탭 바 위(`bottom-20`), 데스크톱 `md:bottom-6`. `role="status"`, 2.5초 후 자동 소멸.
- 성공 `bg-slate-900 text-white` (다크 `bg-zinc-100 text-zinc-900`) · 오류 `bg-rose-600 text-white`. 문구는 해요체/완료형("공유 링크가 복사되었습니다!").

### G. Magic Link 페이지 (`/m/[token]`, 비로그인·모바일 퍼스트)
- 헤더·내비·입력 폼 없음. 배경 `bg-slate-50/70`, 콘텐츠 `mx-auto max-w-md px-4 py-6 space-y-4`.
- **상단 가구 배너:** 틴트 그라데이션 카드(요약 배너 컨테이너와 동일) — 로고 뱃지 + `"{가구명} 가전 관리"`(`text-base font-semibold`) + 보조 `가족 공유 링크`.
- **중앙 과업 카드:** `rounded-2xl` Surface `p-5`, 큰 아이콘 박스(`h-16 w-16 rounded-2xl`) → 가전명(`text-lg font-bold`) + 공간 태그 → 구분선 → 라벨 `수행할 과업`(보조) + 과업명(`text-base font-semibold`) → `원래 예정일` + D-Day 뱃지(`lg`).
- **하단 단일 액션:** `h-14 w-full rounded-2xl text-base font-semibold` Primary 버튼 `[이 과업 완료하기]` (터치 영역 ≥ 48px). 처리 중 스피너 + 비활성, 실패 시 버튼 위 `text-xs font-medium text-rose-600` 오류.
- **상태 카드(결과/오류):** 엠프티 스테이트 패턴(§D) 재사용 — 완료 직후 `CelebrationArt` + "완료 처리되었어요!"(+ 다음 예정일), 이미 완료 `CheckCircle2` emerald + "이미 완료 처리된 과업입니다" + 완료 시각, 무효/만료 `AlertTriangle` rose + "유효하지 않거나 만료된 링크입니다".
- GET은 렌더링만 하고 토큰을 소비하지 않는다. 소비는 POST `/api/tasks/magic-complete` 성공 시에만.

### H. 가구 설정 모달 · 초대 페이지
- **트리거:** 헤더 우측 아이콘 버튼 `h-8 w-8 rounded-full`(설정 아이콘, `aria-label="가구 설정"`), 아바타 왼쪽.
- **모달 본문:** 섹션 카드 `rounded-2xl border bg-slate-50/60 p-4` 3개 — 구성원(이니셜 아바타 + 이름 + 역할 뱃지: 관리자 sky / 구성원 slate) · 구성원 초대 · 백업·복구. 섹션 타이틀 `text-sm font-semibold` + 아이콘, 설명 `text-xs` 보조. 관리자 전용 섹션은 구성원에게 숨기고 안내 문구만 둔다.
- **버튼:** 알약 `rounded-full px-3.5 py-1.5 text-xs font-medium` (Primary = 슬레이트 채움, 보조 = 흰색 + 보더). 처리 중 `Loader2` 스피너 + 비활성.
- **복구 확인:** 파일 선택 후 앰버 박스(`rounded-xl border-amber-200 bg-amber-50`) 안에서 "{파일명} 을(를) 복구할까요?" + [복구 실행] [취소]. 결과/오류는 모달 하단 `role="status"` 박스(성공 emerald · 오류 rose).
- **초대 페이지 `/invite/[code]`:** Magic Link 페이지(§G)와 같은 구조 — 가구 배너("{가구명} / 가구에 초대받았어요") → 상태별 단일 액션(비로그인 `로그인 / 가입하고 참여하기` · 로그인 `표시 이름` 입력 + `가구에 참여하기` `h-14 rounded-2xl`) → 오류는 엠프티 스테이트(USED/EXPIRED/INVALID).

### I. 알림 벨 · 팝오버
- **벨 버튼:** 헤더 우측(설정·아바타 왼쪽) `h-8 w-8 rounded-full` 아이콘 버튼. 안 읽은 알림이 있으면 우상단 카운트 뱃지 `min-w-4 h-4 rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white`(9 초과는 `9+`) + 뒤에서 퍼지는 펄스(`animate-ping bg-rose-400/60`, `motion-reduce:animate-none`). `aria-label="알림 N건"`.
- **팝오버:** `w-80 max-w-[92vw] rounded-2xl` Surface + `shadow-lg`, 패딩 없음. 상단 행 `px-4 py-3 border-b`: 제목 `알림`(`text-sm font-semibold`) + 우측 텍스트 버튼 `모두 읽음`(`text-xs font-medium`, 안 읽은 게 없으면 비활성).
- **목록 항목:** 아이콘 박스(`h-9 w-9 rounded-xl`, 유형별 톤: 완료 emerald · 참여 sky · 임박/당일 amber · 초과 rose) + 제목(`text-sm font-semibold`) + 내용(`text-xs` 보조, 2줄 클램프) + 상대 시간(`text-[11px]`: 방금 전 · 10분 전 · 3시간 전 · 2일 전). 안 읽음은 우측 로즈 점 + 연한 틴트 배경. 항목 전체가 버튼: 읽음 처리 후 해당 화면으로 이동.
- **빈 상태(컴팩트):** 원형 아이콘(`h-10 w-10`) + `새로운 알림이 없습니다`(`text-sm`), 패딩 `py-8`.
- **갱신:** 60초 폴링(탭이 보일 때만) + 창 포커스/탭 복귀 즉시 갱신. 낙관적으로 카운트를 줄이고 실패하면 서버 값으로 되돌린다.
- **푸시 토글(팝오버 하단 행):** 목록 아래 `border-t px-4 py-3` 행 — 아이콘 박스(`h-8 w-8 rounded-xl`) + 라벨 `푸시 알림`(`text-sm font-medium`) + 보조 문구(`text-[11px]`) + 스위치(`role="switch"`, `h-6 w-11 rounded-full`, 켜짐 `bg-emerald-500` · 꺼짐 `bg-slate-200 dark:bg-zinc-700`, 흰 노브 `h-5 w-5`). 처리 중에는 스피너로 교체. 미지원/차단/오류 안내는 스위치 아래 `text-[11px] font-medium text-rose-600`(`role="alert"`).

### J. 렌탈·구독 자산
- **소유 형태 토글(자산 추가 모달 최상단):** 2칸 세그먼트 `rounded-full border bg-slate-100/60 p-1` — `직접 구매` / `렌탈·구독`. 활성 칸은 `bg-white shadow-sm`(렌탈은 `text-violet-600`), `role="radiogroup"` + 각 칸 `role="radio" aria-checked`.
- **렌탈 입력 패널(렌탈 선택 시에만):** 토글 바로 아래에서 **높이 + 투명도 전환**으로 펼침/접힘 — 래퍼 `grid transition-[grid-template-rows,opacity] duration-300 ease-out` (`grid-rows-[0fr] opacity-0` ↔ `grid-rows-[1fr] opacity-100`), 안쪽 `overflow-hidden`, 접힌 상태는 `inert`(포커스 불가) + `motion-reduce:transition-none`. 패널 본체는 `rounded-2xl border border-violet-200/70 bg-violet-50/40 p-4`(다크 `border-violet-900/50 bg-violet-950/20`), 필드는 2열 그리드 `gap-3`, 라벨 `text-xs font-medium`, 입력 `h-9 rounded-xl text-sm`. 케어 방식은 `없음 / 방문 / 자가` 알약 세그먼트. 필수(렌탈사명)는 라벨 옆 `*`, 오류는 패널 하단 `text-xs font-medium text-rose-600`.
- **카드 뱃지:** 렌탈 자산 카드 최상단(이름 위)에 `[렌탈] {렌탈사명}` 알약 — 바깥 `inline-flex rounded-full border border-violet-200 bg-violet-50 py-0.5 pl-0.5 pr-2.5 text-[11px] font-semibold text-violet-600`(다크 `border-violet-900 bg-violet-950/40 text-violet-400`) 안에 채워진 `렌탈` 칩(`rounded-full bg-violet-600 px-1.5 text-[10px] font-bold text-white`) + 렌탈사명(`truncate`).
- **상세 모달:** 카드 우측 하단 `상세` 텍스트 버튼 → `Dialog`(§E). 본문은 섹션 카드. 렌탈 자산에는 **렌탈 정보 카드** 추가: ① 월 렌탈료(`text-2xl font-extrabold tabular-nums`, `32,900원`) + 결제일(`매월 15일`) ② **약정 만료까지 D-N** — 큰 D-Day 뱃지(`lg`, §2 긴급도 규칙) + 만료일 + 계약 진행률 게이지(§C-4와 같은 트랙 스타일, 채움 `bg-violet-500`) ③ 케어 방식 · 소유권 이전일 · 제휴카드 메모(보조 텍스트). 약정이 지났으면 `약정이 N일 전에 만료됐어요`(보조), 정보가 없으면 `약정 정보가 없어요`.

### J-2. 환승 & 비용 비교 (렌탈 자산 상세 모달의 두 번째 탭)
- **탭:** 상세 모달 헤더 아래 `role="tablist"` 2칸 — `정보` / `환승 & 비용 비교`(렌탈 자산에만). 필터 알약(§B)과 같은 형태, 활성 `bg-slate-900 text-white`.
- **면책 배너:** 탭 최상단 `rounded-xl border-amber-200 bg-amber-50 p-3 text-[11px]` — "추정치예요. 실제 조건은 업체·시점마다 달라요" (색은 amber = 주의).
- **추천 콜아웃:** 가장 유리한 선택 + 절약액 한 줄(`text-sm font-semibold`), 비용 차이가 5% 이내면 "비용 차이가 크지 않아요" 로 톤다운. 추천 카드에는 `추천` 칩(`bg-emerald-500 text-white text-[10px] font-bold rounded-full`)과 `border-emerald-300 ring-1 ring-emerald-200`.
- **옵션 카드 3개(세로 스택):** `현재 유지` · `신규 렌탈 환승` · `자가 구매` — 아이콘 박스 + 제목 + **3년(36개월) 부담 총액**(`text-xl font-extrabold tabular-nums`) + 월 평균(보조) + 산식 요약 줄(`text-[11px]`) + 상대 길이 막대(최대값 대비, 추천=emerald, 나머지=slate).
- **가정값 조정(접이식, §J Collapse):** 신규 렌탈 월 요금 · 환승 지원금 · 위약금 · 구매가 · 연 소모품비 숫자 입력 + `기본값으로` 텍스트 버튼. 값이 바뀌면 즉시 재계산.
- **외부 링크:** `최신 모델 렌탈 조건 비교하기 ↗` Primary 버튼(다나와) + 보조 버튼(네이버 쇼핑). `target="_blank" rel="noopener noreferrer"`, 주소의 검색어는 반드시 `encodeURIComponent`.

### J-3. 자산 수정 모달
- 상세 모달 설명 줄 우측 `수정` 알약 버튼(관리자에게만). 클릭하면 상세를 닫고 수정 모달(`max-w-lg rounded-2xl`)을 연다.
- 폼: 이름(필수) · 위치(select) · 카테고리 · 메모(textarea) · **소유 형태 토글 + 렌탈 패널**(§J 컴포넌트 재사용, 기존 값으로 채움). 렌탈 → 직접 구매로 바꾸면 렌탈 정보가 삭제된다는 안내(`text-[11px]` 보조)를 토글 아래에 표시. 하단 `취소`(보조) / `저장`(Primary, 처리 중 스피너). 오류는 버튼 위 `role="alert"`.

### J-4. 렌탈 요약 배너 · 알림 딥링크
- **렌탈 요약 배너:** 자산 목록 최상단(필터 알약 위)에 슬림 배너 — `rounded-2xl border border-violet-200/70 bg-violet-50/40 px-4 py-3`(다크 `border-violet-900/50 bg-violet-950/20`), 좌측 아이콘 박스(violet 톤) + 라벨 `우리 집 월 렌탈 지출`(`text-xs` 보조) + 값 `N개 품목, 월 XX,XXX원`(`text-base font-extrabold tabular-nums`). **렌탈 자산이 1개 이상일 때만** 표시. 월 렌탈료를 입력하지 않은 품목은 합계에서 빼고 `(요금 미입력 M개 제외)` 보조 문구.
- **알림 유형 `RENTAL_EXPIRING`:** 벨 목록 아이콘 `Repeat`(렌탈 환승), 톤 violet(§J 아이콘 박스 톤). 클릭/푸시 경로 `/assets?openAssetId=<자산ID>&tab=compare`.
- **딥링크 동작(`/assets?openAssetId=…&tab=compare|info`):** 해당 자산의 상세 모달을 자동으로 열고 `tab=compare`(렌탈 자산일 때)면 `환승 & 비용 비교` 탭을 바로 보여 준다. 처리 후 주소의 쿼리는 즉시 제거(같은 알림을 다시 눌러도 다시 열리도록). 현재 필터 때문에 카드가 숨겨져 있으면 필터를 `전체`로 되돌린다. 자산을 찾을 수 없으면(삭제·권한 없음) 목록 상단에 `role="status"` 안내 박스(`rounded-xl border-amber-200 bg-amber-50 text-xs`)를 닫기 버튼과 함께 표시하고 모달은 열지 않는다. `openAssetId`가 UUID가 아니면 무시.

### K. 리포트 (`/analytics`, 헤더 탭 "리포트")
- **내비게이션:** 헤더·하단 탭에 `리포트`(`BarChart3`) 추가, 활성은 기존 탭과 동일(`aria-current="page"`). 모바일 하단 탭은 3칸.
- **페이지 골격:** 제목 `리포트` + 보조 한 줄, 아래로 섹션 카드가 세로 스택(`space-y-6`). 모든 섹션은 평평한 `rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950` 카드(그림자·그라데이션 없음), 섹션 제목 `text-sm font-semibold` + 보조 설명 `text-xs`. 배경 오로라는 레이아웃 것을 그대로 사용.
- **MetricKpiGrid:** 4열(모바일 2×2) 평평한 메트릭 카드(§0 메트릭 카드) — 라벨 → 큰 숫자 → 보조 한 줄. 값이 없으면 `—`. 아이콘은 `h-4 w-4` 모노톤, 액센트는 작은 점/보조색만.
- **BillingScheduleStrip:** 1~31일 31칸 막대 타임라인(`grid-template-columns: repeat(31, minmax(0, 1fr))`). 결제 있는 날만 `bg-violet-500 dark:bg-violet-400` 막대(높이 = 그날 합계 / 최대값), 없는 날은 1px 눈금(`bg-zinc-200 dark:bg-zinc-800`). 축 라벨은 `1 · 8 · 15 · 22 · 29`(모바일은 `1 · 15 · 29`). 아래에 결제일 순 목록 행(날짜 칩 · 자산명 · 제휴카드 메모 보조 · 월 요금 `tabular-nums`).
- **SavingsOpportunityCard:** 인텔리전스 배너 — `rounded-xl border border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/60 dark:bg-emerald-950/20`(절약 = emerald). 소유권 이전 일정을 날짜순으로 `D-N · 자산명 · 이후 월 지출 X원`으로 나열하고 이전 후 월 지출 감소 예측을 한 줄로 요약. 약정 만료는 amber 보조 행(위약금 없이 환승 가능). 예측 대상이 없으면 `예정된 소유권 이전·약정 만료가 없어요` 중립 상태.
- **ConsumableQuarterlyBar:** 향후 4개 분기(달력 분기) 순수 CSS 막대. 소모품 가격 데이터가 없으므로 **금액이 아닌 교체·점검 예정 횟수**. 막대 높이 = 분기 합계 / 최대값, 소모품 등록 규칙 분량은 `bg-violet-500 dark:bg-violet-400`, 그 외 점검은 `bg-zinc-300 dark:bg-zinc-700`로 스택. 각 막대 위에 합계(`tabular-nums`), 아래에 `2026 Q4` 라벨. 범례 2개.
- **SpaceInventoryMatrix:** 공간(또는 카테고리) 한 줄 = 이름 · 총 개수 · 가로 스택 인디케이터(자가 `bg-zinc-900 dark:bg-zinc-100` / 렌탈 `bg-violet-500 dark:bg-violet-400`) + `렌탈 N · 자가 M`. 상단 세그먼트로 `공간별 / 카테고리별` 전환(소유 형태 칩과 같은 규격), 맨 위에 전체 소유 형태 비중 막대.
- **제로 상태:** 자산 0개 → 엠프티 스테이트(§D) 하나만. 렌탈 0개 → 결제 타임라인·절약 카드는 `렌탈·구독 자산이 없어요` 중립 안내, 나머지 섹션은 정상 표시.
- **접근성:** 막대마다 `role="img"` + `aria-label`(값 포함), 색만으로 구분하지 않고 숫자 병기. 모바일(375px)에서 가로 스크롤 없음.

### L. 브랜드 에셋 · 공유 메타데이터
- **팔레트:** 배경 `#09090b`(딥블랙), 글로우 violet(`rgb(139 92 246)`) · emerald(`rgb(16 185 129)`) 블러, 텍스트 `#fafafa` / 보조 `#a1a1aa`, 1px 보더 `rgba(255,255,255,.10~.22)`. 마크는 헤더 로고와 같은 `Home` 글리프(흰색 라인).
- **OG 카드(1200×630):** 안쪽 1px 프레임 · 상단 알약 배지(emerald 점) · 1px 보더 로고 박스 · `MyLife Hub` 128px 800 · 서브카피 · 기능 칩 4개. 파일: `src/app/opengraph-image.png`(+ `twitter-image.png`, `*.alt.txt`). 아이콘: `favicon.ico`(16/32/48), `icon.png`(512), `apple-icon.png`(180), PWA `public/icons/icon-192·512.png`.
- **재생성:** `node scripts/generate-brand-assets.mjs` (HTML → Playwright 캡처). 브랜드가 바뀔 때만 실행하고 결과물을 커밋한다.
- **메타데이터 규칙:** 기본 문구·URL은 `src/shared/lib/seo.ts`(`shareMetadata`)에서만 정의. `openGraph`를 덮어쓰는 페이지는 helper를 써서 이미지·siteName·locale을 유지한다. 토큰 페이지(`/m/*`, `/invite/*`)는 `noindex, nofollow` + `no-referrer`이며 공유 카드에 토큰·가구·과업 정보를 싣지 않는다.

### M. 앱 설치 버튼 (PWA Install)
- **위치·형태:** 헤더 우측 클러스터의 `ThemeToggle` 바로 앞. `h-8 w-8 rounded-lg` 고스트 아이콘 버튼(`Download` 라인 아이콘 `h-4 w-4`), 기본은 투명 보더, 호버 시 `border-zinc-200 bg-zinc-100`(다크 `border-zinc-800 bg-zinc-900`). `ThemeToggle`과 같은 규격·포커스 링.
- **툴팁:** 호버/키보드 포커스 시 버튼 아래 `앱 설치하기` 라벨(`rounded-lg border bg-white text-xs font-medium`, 오버레이이므로 `shadow-lg`, 다크 `bg-zinc-900`). 순수 CSS(`group-hover` / `group-focus-visible`), `role="tooltip"`.
- **표시 조건:** 설치 경로가 있을 때만 — 캡처한 `beforeinstallprompt`가 있거나 iOS. **독립 실행(standalone) 모드·`appinstalled` 이후·설치 경로 없는 브라우저에서는 DOM에 렌더링하지 않는다.**
- **동작:** Android / 데스크톱 Chrome·Edge → 브라우저 네이티브 설치 대화상자(문구는 브라우저가 정함, 앱이 바꿀 수 없음). iOS → 네이티브 프롬프트가 없으므로 `Popover`(`w-72 rounded-xl p-4`)에 2단계 안내(공유 `Share` 아이콘 → `홈 화면에 추가`).

### N. 키친 OS (`/kitchen`, 헤더·하단 탭 "키친")
- **내비게이션:** `ChefHat` 아이콘, 활성 규칙은 기존 탭과 동일. (하단 탭은 §S의 5칸 규칙을 따른다.)
- **페이지 골격:** 제목 `키친` + 보조 한 줄 + 우측 `재료 추가`(Primary) → (조건부) 펫 경보 배너 → `KitchenPulse` → 보관 탭 + 목록. 카드·배너는 평평한 1px 보더(§0), 그림자 없음.
- **KitchenPulse:** 4열(모바일 2×2) 메트릭 타일 — 보관 중 · 소비 임박(D-3 이하, 지난 것 포함) · 냉동 화석(30일+) · 누적 절약액. 숫자는 `text-2xl font-semibold tabular-nums`, 임박이 있으면 값만 amber, 지난 재료가 있으면 rose + 보조 줄 `기한 지남 N건`.
- **D-Day 신호등 배지(알약, `rounded-full px-2 py-0.5 text-[11px] font-semibold`):** `≤2일` Rose(`border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300`) · `≤7일` Amber(`border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300`) · 그 외 Emerald(`border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300`). 날짜가 지났으면 **Rose Alert**: 진한 채움(`bg-rose-600 text-white dark:bg-rose-500 dark:text-black`) + 라벨 `D+n 지남`. 색만으로 구분하지 않고 항상 `D-n` 텍스트를 함께 쓴다.
- **화석 배지(Cyan):** `Snowflake` + `30일+ 냉동`, `border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-900 dark:bg-cyan-950/40 dark:text-cyan-300`. 버튼이며 누르면 전자레인지 해동 가이드 모달.
- **댕냥이 경보 배지:** 가구에 펫이 있고 재료 이름이 `PET_TOXIC`이면 `PawPrint` + `반려동물 위험`(Rose 알약). `is_pet` 재료는 중립 `펫 전용` 알약.
- **PetToxicAlertBanner:** 고대비 경보 — `rounded-xl border border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-100`, 좌측 `ShieldAlert`, 위험 재료 이름 나열, 우측 `응급 대처법`(Rose 채움 버튼). `role="alert"`. 펫이 없거나 위험 재료가 없으면 렌더링하지 않는다. 버튼은 `24시 응급 모달`(§E)을 연다: 단계 안내 + 24시 동물병원 검색 링크 + "수의학적 진단이 아니에요" 고지.
- **StorageTabs:** `[전체 | 냉장 | 냉동 | 실온]` 세그먼트 — 1px 보더 컨테이너 안의 `role="radiogroup"` 칩, 활성은 Primary(`bg-black text-white dark:bg-white dark:text-black`), 각 탭에 개수를 `tabular-nums`로 병기.
- **KitchenItemCard:** `rounded-xl border` 평평한 행/카드. 1줄 이름(`text-sm font-semibold truncate`) + D-Day 배지, 2줄 `수량 · 보관 장소(spot) · 소비기한`(보조색), 3줄 배지들(화석·펫), 하단 액션: `소진`(Outline, 주 동작) · `이동`(드롭다운: 냉장/냉동/실온) · `수정` · `삭제`(2단계 확인 `삭제 확인` rose). 만료된 카드는 보더 `border-rose-300 dark:border-rose-900`.
- **그리드(375px 반응형):** 모바일 1열, `sm` 2열, `lg` 3열; 모든 행은 `min-w-0`, 액션 줄은 `flex-wrap`. 가로 스크롤 없음.

### O. 키친 Zero-Typing (찰칵 입고 · 말로 정리)
- **진입점:** `/kitchen` 헤더 우측에 `찰칵 입고`(Outline, `Camera`) + `재료 추가`(Primary), 그 아래 한 줄 `SmartCheckoutBar`(입력창 + 마이크 + `말로 정리` Outline 버튼). 마이크는 Web Speech API가 있는 브라우저에서만 입력창 안쪽 우측에 나타나고, 듣는 동안 입력창 테두리·마이크가 Rose로 바뀌며 `듣고 있어요…`를 표시한다.
- **SnapIngestDialog(`max-w-lg`):** ① 선택 — `카메라로 찍기`(`capture="environment"`) / `갤러리에서 고르기` 2칸 + 개인정보 안내(사진은 분석용으로 Gemini에만 전송, 저장 안 함) ② 작업 중 스피너 ③ 검토 — 품목 행(체크박스 · 이름 · 수량 입력 · 냉장/냉동/실온 세그먼트 · 권장 일수) + `결제 총액 N원 지출 기록` 체크 ④ 하단 단일 CTA `N개 품목 한 번에 입고`(Primary `h-11`). AI 사용 불가 시 amber 안내 박스(가짜 샘플 데이터 없음).
- **SmartCheckoutDialog:** 읽은 문장을 따옴표로 보여 주고, 동작 카드(체크박스 + 동작 아이콘 박스 + 문장)를 나열 — 소진(emerald `Check`) · 이동(cyan `ArrowRightLeft`) · 폐기(rose `Trash2`) · 지출(violet `Wallet`). 냉장고에서 못 찾은 항목은 점선 카드 + 비활성 체크. 출처 한 줄(`AI가 읽었어요` / `글자 규칙으로 읽었어요 (사유)`), 하단 `N건 일괄 실행`. 일부 실패 시 결과 목록(✓/✗)을 보여 준다.
- **원칙:** AI는 제안만 하고 아무것도 쓰지 않는다. 확인 후 서버가 모든 효과(차감 수량·새 소비기한)를 다시 계산한다.

### P. 키친 머니로그 · 가계 종합 리포트
- **KitchenBudgetCard**(`/kitchen`, `KitchenPulse` 바로 아래): 평평한 `rounded-xl border` 카드. 상단 `오늘의 권장 식비 N원` 알약 — 정상은 고대비 `bg-black text-white dark:bg-white dark:text-black`, 식비 예산 100% 이상이면 Rose 경고(`border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300`, `TriangleAlert`, `예산 초과 · 오늘 권장 식비 0원`) + 보조 한 줄(남은 식비 ÷ 오늘 포함 남은 일수 / 초과액). 우측 `지출 등록 · 전체 보기`(Outline).
- **게이지 바**(사람 식비 · 댕냥이 케어비): `h-2 rounded-full` 트랙(`bg-zinc-100 dark:bg-zinc-900`) + 채움 — **80% 미만 Emerald · 80%+ Amber · 100%+ Rose**(너비는 100%로 캡), 오른쪽에 `n%`(`tabular-nums`), 아래 `지출 / 예산` + `N원 남음` 또는 Rose `N원 초과`. `role="progressbar"`. 예산 0원이면 `예산 미설정`.
- **방어액 뱃지:** Emerald 알약 `냉파 누적 방어액 N원` + `구출 N번`. **최근 지출 3건:** `날짜 · 분류 칩(장보기 Emerald / 배달·외식 Amber / 댕냥이 Cyan) · 메모 · 금액` 행.
- **ExpenseDialog(머니로그):** 분류 3칸 라디오 → 금액·날짜·메모 → `지출 등록`(Primary) · 이번 달 전체 내역(행마다 2단계 삭제) · 접이식 `월 예산 설정`. 오류는 `role="alert"` Rose.
- **KitchenExpenseStrip**(`/analytics`, KPI 그리드 아래, 모든 색은 §K 메트릭 카드 규격): 이번 달 식비 · 양육비 · 냉파로 아낀 금액(Emerald) 3타일 + **가계 종합 캐시플로우 요약** — `렌탈 고정 + 식비·양육비 변동 = 합계` 3열, 비중 스택 바(렌탈 violet · 식비 zinc · 양육비 cyan, `role="img"` + 퍼센트 라벨), 방어액 한 줄(누적값임을 명시). 방어액은 이번 달 값이 아니라 누적이므로 합계에서 빼지 않는다.

### Q. AI 셰프 · 동네 생활 레이더 · 냉장고 자산 칩
- **배치(`/kitchen`):** 머니로그 카드 → **AiChefSection** → 보관 탭·재료 목록 → **LocalLifeRadar**(맨 아래). 모두 평평한 `rounded-xl border` 섹션 카드(§0), 그림자 없음.
- **AiChefSection:** 헤더(`ChefHat` 아이콘 박스 + 제목/설명) 우측에 `[즉석 냉파 | 댕냥이 특식]` 세그먼트(`role="radiogroup"`, 활성 Primary). **펫이 없으면 `댕냥이 특식`은 `disabled`(`opacity-40`, title 안내)**. Primary `레시피 만들기` 버튼(진행 중 스피너). 결과 위에 출처 알약(`AI 셰프` violet / `기본 레시피` 중립) + 사유 한 줄 + `기한이 지난 재료 N개는 제외했어요` + `사용한 재료` 칩(D-3 이하 amber, 소비기한순).
- **레시피 카드:** 제목 → 알약(시간 `Clock` · 난이도 · 칼로리 amber `Flame` · 펫은 cyan `염분 0%`) → **주재료 칩**(냉장고에 있음 emerald, 없음은 점선 + `· 없음`) → 양념 칩(펫은 없음) → 번호 단계 1~4(`h-5 w-5` 번호 박스) → TIP 박스(`bg-zinc-50`) → 하단 Outline 버튼 `이 재료들 소진 처리 (재료명)` — 누르면 그 레시피의 냉장고 재료를 삭제하고 구출 +N · 절약 +3,000원×N, 완료 후 emerald 결과 줄로 대체(중복 불가). 소진할 재료가 없으면 비활성. 그리드: 모바일 1열 · `lg` 3열.
- **댕냥이 특식 규칙:** cyan 안내 박스(소금·기름·양념 없이 삶거나 쪄서 식혀 급여, 처음엔 소량). 독성 재료는 프롬프트와 결과 모두에서 제외.
- **LocalLifeRadar:** 사람용 칩 3개(`ShoppingCart` 대형마트 · `Sprout` 전통시장 · `Store` 24시 편의점) + 펫 가구에만 두 번째 줄 3개(Rose `Siren` 24시 동물병원 · `Stethoscope` 동네 동물병원 · `PawPrint` 펫용품점). `h-9 rounded-lg border` 칩, 우측 `ExternalLink` 보조 아이콘. **일반 링크**(`https://m.map.kakao.com/actions/searchView?q=<encodeURIComponent>`, `target="_blank" rel="noopener noreferrer"`) — 스크립트 불필요, 방문자 위치를 묻거나 저장하지 않는다(위치는 카카오맵이 필요할 때 직접 묻는다).
- **냉장고 자산 칩(`FridgeKitchenChip`, `/assets`):** 카테고리가 `냉장고`이거나 이름에 `냉장고/냉동고`(김치냉장고 포함)가 든 자산 카드의 관리 규칙 줄 아래. `rounded-full` 알약 `ChefHat` + `보관 N개`, 임박(D-3 이하·기한 지남 포함)이 있으면 amber 틴트 + `(임박 M개)` + `TriangleAlert`. 클릭 시 `/kitchen`으로 이동(`next/link`).

### I-2. 알림 종류 · 이동 규칙 (§I 보강, v4)
- 팝오버: `rounded-3xl bg-white shadow-xl`(보더 없음), 헤더 "알림" + Sky 알약 [모두 읽음], 행은 `rounded-2xl`(안 읽음 `bg-sky-50` + 코랄 점), 하단 푸시 토글은 `rounded-2xl bg-slate-50` 패널. 화면 가장자리와 12px 간격 유지.
- 집계: 가전 과업 **D-7~D-1**(`DUE_SOON`, "N일 후"), D-Day(`DUE_TODAY`), 지연(`OVERDUE`), 렌탈 약정 D-60/30(`RENTAL_EXPIRING`), 키친 소비기한 **D-3~D-Day + 어제 만료**(`KITCHEN_EXPIRING`, 틸 냉장고 아이콘). 키친은 가구 공유 자원이라 구성원 전원에게 간다.
- 클릭 이동: 가전 알림 → `/assets?openAssetId=<id>`(상세 패널), 렌탈 → 같은 주소 + `&tab=compare`, 키친 → `/kitchen?focus=<id>`(전체 탭으로 전환·스크롤·Sky `ring-4` 하이라이트 4.5초). 대상이 삭제됐으면 목록 페이지로 이동하고 키친은 "이미 정리된 재료예요." 안내.

### R. 사용 가이드 뱃지 · 3단계 슬라이드 튜토리얼 — `ui/ContextHelpButton.tsx` · `help/SlideTutorialModal.tsx`
- 섹션 제목 옆 캡슐 뱃지 `<ContextHelpButton topic="…" />`: `rounded-full border-sky-200/80 bg-sky-50 text-sky-600 text-xs font-semibold shadow-sm`, `HelpCircle` 13px/stroke 2.5 + 라벨("사용 가이드", 등록 흐름은 "등록 튜토리얼"), 높이 32px 이상. `shrink-0 whitespace-nowrap`이며, 자리가 모자라면 부모 `flex-wrap`이 뱃지를 통째로 아래 줄로 내린다(280px 대응).
- 콘텐츠는 `src/shared/constants/help-content.ts`의 `steps`(정확히 3개: step·title·desc·icon·badge)에서만 관리. 설명은 2줄 안팎(좁은 폭에서는 늘어날 수 있음).
- 모달(`rounded-3xl bg-slate-50`, 폭 `calc(100%-2rem)`·최대 `max-w-sm`): 상단 "Step X / 3" + 3칸 진행 바(Sky→Teal) → 슬라이드(Sky/Mint 그라데이션 일러스트 박스 + 흰 아이콘 타일 + 우하단 뱃지, 볼드 타이틀, 설명) → [이전](1단계에서 숨김) / [다음] → 마지막은 그라데이션 CTA "직접 해보기 🚀"(닫힘).
- 이동: 버튼 · 키보드 ←/→ · 포인터 스와이프(40px 이상, `touch-pan-y`). 열 때마다 1단계부터. 비활성 슬라이드는 `inert`.

### S. 공간·가구 플래너 (`/spaces`, `/spaces/[id]`, 헤더·하단 탭 "공간 플래너")
- **내비게이션:** `Sofa` 아이콘, 5번째 탭(자산 · 타임라인 · 키친 · 공간 플래너 · 리포트). 데스크톱 상단 탭은 `px-3 lg:px-4` + `whitespace-nowrap`. **모바일 하단 탭은 5칸(`grid-cols-5`)이라 라벨을 4자 이하 `short`로 쓴다**(자산 · 타임라인 · 키친 · 공간 · 리포트, `text-[11px]`, `whitespace-nowrap`, `aria-label`에 전체 이름). 280px에서 셀 폭 56px 안에 라벨이 들어가야 하고 가로 스크롤은 없다.
- **`/spaces`:** 제목 + 보조 한 줄, 우측 `ContextHelpButton topic="space_planner"` + 그라데이션 CTA `+ 새 공간 등록`(`GRADIENT_CTA`). 카드 그리드(모바일 1열 · `sm` 2열 · `lg` 3열): `rounded-3xl bg-white shadow-sm` 카드, 4:3 썸네일(사진이 없으면 Sky→Teal 그라데이션 + `Sofa`), 공간명(`truncate`), 용도(Sky) · 스타일(Mint) 알약, `실측 N개 · 위시 N개`. 비어 있으면 EmptyState.
- **`/spaces/[id]`:** `← 공간 목록` → 제목 + 용도/스타일 알약 + 도움말 뱃지 + `공간 삭제`(2단계 확인 `삭제 확인` Rose) → 카드 3장을 세로로: ① 실측 치수 ② AI 공간 코디네이터 ③ 부부 위시 가구. 모든 카드는 `rounded-3xl bg-white p-4 shadow-sm sm:p-5`, 안쪽 블록은 `rounded-2xl bg-slate-50`, 보더 없음.
- **실측 캔버스(`SpaceDimensionAnnotator`):** 사진 위 SVG 오버레이(`viewBox 0 0 1 1`, `vector-effect: non-scaling-stroke`)로 선을 그리고, 끝점 핸들(터치 영역 32px)과 치수 캡슐(`bg-sky-600 text-white rounded-full`, `라벨 + N cm`)은 HTML을 `%`로 배치한다. **좌표는 항상 0~1 비율(`x1,y1,x2,y2`)로 저장**해 화면 크기와 무관하게 같은 자리에 남는다. 선 긋기를 켠 동안에만 오버레이가 `touch-none`(그 외에는 페이지 스크롤 유지). 선은 흰 밑선 6px + 색선 3px(선택 시 Amber). 입력 폼은 사진 아래 인라인: 축 알약(가로 · 깊이 · 높이 · 직접 입력) + 이름 + 길이(cm). 라벨은 `composeLabel`로 만들어 `annotationAxis`가 같은 축으로 되읽게 한다.
- **사진:** 브라우저에서 긴 변 1600px · JPEG · 5MB 이하로 줄여 비공개 버킷 `space-photos`의 `<household_id>/<space_id>/<uuid>.jpg`에 올리고, 화면에는 1시간짜리 Signed URL로만 보여 준다.
- **AI 패널(`SpaceAiCoordinator`):** 용도 6종 · 스타일 5종 알약(라디오) → `AI 가구 추천받기`(그라데이션). 저장된 진단(`ai_diagnosis`)이 있으면 곧바로 보여 주고 버튼은 `다시 분석하기`. 공간 진단 카드(`from-sky-50 to-teal-50`) + 추천 3장(카테고리 · 적합도 뱃지 · 이름 · 이유 · 권장 사이즈 `W×D×H cm` · 가격대 · 검색어 · 쇼핑 4버튼 · `위시 보드에 담기` Mint).
- **적합도 뱃지(`FitBadge`):** FIT 민트 `여유 N cm` · TIGHT 앰버 `딱 맞음 (N cm)` · OVERFLOW 로즈 `치수 초과 N cm` · UNKNOWN 슬레이트 `치수 미확인`. 항상 아이콘 + 글자를 함께 쓴다.
- **쇼핑 버튼:** 오늘의집 · 네이버 쇼핑 · 쿠팡 · 이케아 코리아, `rounded-full bg-slate-100`, `target="_blank" rel="noopener noreferrer"`, 높이 36px 이상.
- **위시 보드(`WishFurnitureBoard`):** 직접 추가 폼(이름 · 카테고리 · 가로/깊이/높이 · 가격 · 링크 · 메모, 현재 공간 기준 적합도 미리보기) + 카드 그리드(`md` 2열). 상태 알약 `후보 / 최종 픽 / 구매 완료`(`role="radiogroup"`, 활성은 Slate · Sky · Mint 채움). 파트너의 변경은 15초 폴링과 탭 복귀 시 동기화한다(그리는 중인 치수는 덮어쓰지 않음).

- **URL 자동 채움(위시 폼):** 상품 링크 입력란 옆에 `정보 불러오기` Sky 캡슐(`bg-sky-50 text-sky-700`, `min-h-11`). 결과는 폼 안의 흰 안내 카드(썸네일 `h-14 w-14 rounded-xl` + 쇼핑몰 Sky 알약 + 제목·가격); 실패는 Amber 안내 카드로 메시지만 보여 주고 수동 입력을 막지 않는다. 카드의 상품 썸네일은 `object-cover`, `referrerPolicy="no-referrer"`.
- **적합도 근거(`FitBasis`):** 적합도 뱃지 바로 아래 `text-[11px] font-bold text-slate-500` 한 줄(예: `가로 소파 벽면 250cm 기준 · 40cm 여유`). 줄바꿈 허용, 판정 불가(UNKNOWN)면 표시하지 않는다.

### T. 기본 가전 1분 세팅 (`/assets`)
- `기본 가전 1분 세팅`은 `/assets` 헤더에서 `가전 추가` 옆의 Sky 캡슐(`rounded-full bg-sky-50 text-sky-700 shadow-sm`)이며, 가전이 0개일 때는 빈 상태 카드 안에도 같은 버튼을 둔다(모달 인스턴스는 하나, 이벤트로 연다).
- 모달: `rounded-3xl bg-slate-50`, 가전 8종은 `grid-cols-1 min-[420px]:grid-cols-2`의 흰 카드(`rounded-3xl shadow-sm`, 선택 시 `ring-2 ring-sky-400`). 카드 = 체크박스 행(`min-h-11`) + `자가 / 렌탈` 세그먼트(`min-h-9`, 선택 전에는 비활성 톤). 이미 등록된 가전은 흐리게 `이미 등록됨`. 하단 CTA는 `GRADIENT_CTA`(`선택한 N개 가전 한 번에 등록`).

### U. 영수증 일괄 검수 (키친 찰칵 입고)
- 상단 요약 바: `rounded-3xl bg-sky-50`에 `선택 N개 / 전체 M개`와 지출 합계(품목 금액이 있으면 선택 품목 합계, 없으면 영수증 총액).
- 품목 행: 흰 `rounded-3xl` 카드. 보관 위치 알약(냉장/냉동/실온, 선택은 Sky 채움), 소비기한 빠른 조정 Mint 알약 `-3일 / +3일 / +7일` + 날짜 입력, 오인식 품목을 바로 빼는 휴지통 버튼(Rose, 36px 이상).

### V. Phase 2 협업 · 액션 루프
- **알림 벨 원탭 액션:** 알림 행(`rounded-2xl`) 안, 본문 아래에 캡슐 한 개. 가전·소모품 알림 = Mint `교체·점검 완료`(`bg-teal-50 text-teal-700`), 키친 알림 = Sky `소진 완료`(`bg-sky-50 text-sky-700`). 높이 `min-h-9`, 행 전체 클릭(이동)과 분리되어 버블링하지 않는다. 처리 뒤에는 캡슐 자리에 결과 한 줄(`text-teal-700`, 실패는 Rose)이 남고 알림은 읽음. 소진 뒤에는 화면 하단에 흰 토스트(`rounded-3xl shadow-xl`, `document.body` 포털, 모바일은 하단 탭 위 `bottom-20`)로 `장보기 리스트에 바로 담을까요?` + Mint `담기`.
- **키친 `보관함 | 장보기` 세그먼트:** 헤더 아래 흰 알약 묶음(`rounded-full bg-white p-1 shadow-sm`), 활성은 Sky 채움, 장보기에는 열린 항목 수 Mint 배지. 장보기 패널은 `rounded-3xl bg-white shadow-sm`, 체크 행은 `rounded-2xl bg-slate-50 min-h-11`, 체크하면 취소선 + 하단 정렬. 일괄 버튼은 Mint 채움(`장본 품목 보관함으로 바로 입고`)과 Slate(`체크된 항목 비우기`). 보관함 카드의 `+ 장보기`는 작은 Mint 알약(`min-h-10`).
- **위시 ♥ 투표:** 카드의 `♥ N` 토글(`min-h-9 rounded-full`, 내가 누르면 Rose 틴트 + 채운 하트). 구성원 전원이 누르면 Mint `부부 공동 픽 ♥` 알약. 예산 합산기는 보드 상단 2칸 카드: `최종 픽 합계`(Sky 틴트)와 `전체 후보 합계`(Slate), 가격 미입력·구매 완료는 작은 보조 문구로 따로 표시한다.
- **iOS 설치 배너(`IosPwaInstallBanner`):** iOS/iPadOS Safari의 브라우저 탭에서만(설치된 앱·다른 iOS 브라우저·인앱 브라우저 제외). Sky→Mint 그라데이션 틴트 `rounded-3xl`(다크는 `from-sky-950/40 to-teal-950/30`), 공유 아이콘 박스 + 안내 문구 + `닫기` 흰 알약. 알림 벨 패널 맨 위와 가구 설정 모달에 같은 배너가 뜨고, `닫기`는 `localStorage`에 저장되어 둘 다 사라진다.

### W. Phase 3 가정 운영 자동화 · 결산 · 가이드 현행화
- **리포트 상단 월 선택(`MonthStepper`):** `‹ 2026년 11월 ›` 흰 원형 버튼 2개(44px) + 월 라벨(이번 달이면 Sky `이번 달` 알약). 미래 월은 선택할 수 없고 `?month=YYYY-MM`이 잘못되면 이번 달로 돌아간다. 결산·공과금 카드가 같은 월을 쓴다.
- **월말 부부 살림 결산(`MonthlySettlementCard`):** `ReportSection`(`rounded-3xl bg-white shadow-sm`) 안에 3칸 블록(`lg:grid-cols-3`, 모바일은 세로) — 식비 예산 방어율(Sky 막대: 80%↑ Amber, 초과 Rose), 기한 만료·폐기 손실 추산(재료 가격을 저장하지 않으므로 건당 3,000원 추정임을 문구로 밝힌다), 부부 공동 살림 달성도(Mint 숫자 + 항목 알약 3개 + 한 줄 메시지). 기록 테이블이 아직 없으면 해당 부분만 `준비 중` 문구로 대체하고 카드는 항상 그려진다.
- **공과금·관리비(`UtilityBillsCard` / `BillScanDialog`):** 월 합계 큰 숫자 + 전월 대비(`+12,300원 (▲ 8.4%)`, 오른 달 Rose · 내린 달 Mint) + 종류별 Sky 알약 + 고지서 행(종류 알약 · 기관 · 금액 · 2단계 삭제). `고지서 찰칵 등록`은 Sky 채움 캡슐(`min-h-11`). 다이얼로그는 사진(카메라·갤러리) 또는 `사진 없이 직접 입력` → AI가 읽은 값을 폼에 채워 확인 → 저장. 못 읽은 값은 비워 두고 Amber 안내를 띄운다. 테이블 미적용이면 카드 전체가 Sky `준비하고 있어요` 배너.
- **쇼핑몰 제휴 파라미터:** `NEXT_PUBLIC_AFFILIATE_{COUPANG,OHHOUSE,NAVER,IKEA}_TAG`에 `lptag=AF123` 같은 쿼리 조각을 넣으면 해당 몰 검색 URL 뒤에 병합된다(없거나 형식이 틀리면 기본 검색 URL 그대로, 검색어 파라미터는 건드리지 않음).
- **사용 가이드 현행화 원칙:** 탭마다 대표 3단계 가이드(`HELP_CONTENT`)를 두고(자산 `appliance_dday` · 키친 `zero_typing` · 타임라인 `timeline_actions` · 리포트 `analytics_report` · 공간 `space_planner`), 새 기능을 넣을 때 해당 탭 문구를 같은 커밋에서 고친다. 새 아이콘 키는 `SlideTutorialModal`의 `ICONS`에 함께 추가한다.

### E. 모달 (Dialog)
- 콘텐츠 `rounded-2xl`, 목록 항목은 카드 패턴 C의 축약형(아이콘 박스 `h-10 w-10`). 헤더에 제목 + 보조 설명 필수.

## 5. 가전 아이콘 매핑
`src/shared/lib/appliance-icons.ts` 가 단일 출처(SSOT). 새 프리셋 추가 시 이 매핑도 함께 갱신하고 없으면 `Package`/slate 폴백.

## 6. 구현 위치 규칙
- 도메인 전용 UI → `src/features/<domain>/components/`
- 2개 도메인 이상 공용(DDayBadge, EmptyState, SummaryBanner, Skeleton, 유틸) → `src/shared/`
- 페이지(`src/app`)는 조립만 한다 (Thin Route).
