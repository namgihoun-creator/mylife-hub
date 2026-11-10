# MyLife Hub UX/UI Design System Specification (v2 · Visual Polish)

> **필수 준수:** 모든 프론트엔드 UI 컴포넌트와 페이지는 이 문서의 토큰·패턴을 따른다 (CLAUDE.md §4.F).
> 벤치마크: CookSaver 스타일 — 따뜻한 웜 슬레이트 배경, 상태 중심 뱃지, 알약 필터, 아이콘 박스 카드.
> v2 변경 요약: 와이드 컨테이너(`max-w-6xl`) · 블러 헤더 · 틴트/인셋 요약 배너 + 펄스 · 3열 그리드 + 소모품 게이지 · 섹션별 성격 분리(Overdue/Today/Upcoming) · 올 클리어 일러스트 · 스켈레톤.

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

### E. 모달 (Dialog)
- 콘텐츠 `rounded-2xl`, 목록 항목은 카드 패턴 C의 축약형(아이콘 박스 `h-10 w-10`). 헤더에 제목 + 보조 설명 필수.

## 5. 가전 아이콘 매핑
`src/shared/lib/appliance-icons.ts` 가 단일 출처(SSOT). 새 프리셋 추가 시 이 매핑도 함께 갱신하고 없으면 `Package`/slate 폴백.

## 6. 구현 위치 규칙
- 도메인 전용 UI → `src/features/<domain>/components/`
- 2개 도메인 이상 공용(DDayBadge, EmptyState, SummaryBanner, Skeleton, 유틸) → `src/shared/`
- 페이지(`src/app`)는 조립만 한다 (Thin Route).
