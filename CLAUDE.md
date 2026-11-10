# CLAUDE.md - MyLife Hub Project Guidelines

## 1. Project Overview & Philosophy
- **Name:** MyLife Hub (개인·가족 통합 생활 OS)
- **Vision:** "사용자는 최소한으로 입력하고, MyLife Hub는 기억하고 연결하고 관리한다."
- **Core Loop:** [자산 등록] → [과업 생성] → [알림] → [앱 또는 Magic Link 완료] → [원자적 DB 트랜잭션: 완료 로그 + 다음 주기 생성]
- **Philosophy:** No-AI First (Phase 1 AI 기능 배제), 데이터 정확성 및 무결성 최우선, 1인 개발 유지보수성 최우선, 100% 무료 티어(Zero-Cost) 인프라.

---

## 2. Tech Stack & Infrastructure (Free Tier Only)
- **Frontend:** Next.js 14+ (App Router), TypeScript, Tailwind CSS, shadcn/ui, PWA (next-pwa or Serwist)
- **Backend / Database:** Supabase (PostgreSQL 15+, Auth, Storage, Edge Functions)
- **State Management & Caching:** TanStack Query v5, IndexedDB (Dexie.js는 로컬 캐시 전용)
- **Notification:** W3C 표준 Web Push (VAPID 기반, 외부 유료 발송사 금지)
- **Testing:** Vitest, Testing Library, pgTAP / Supabase CLI local testing

---

## 3. Strict Scope Control (Scope Freeze)

### MUST IMPLEMENT (Phase 1 In-Scope)
1. 생활가전 30종 기본 프리셋 및 공간별(거실/주방 등) 자산 관리
2. 1회성 Task 및 반복 Task (예정일 기준 / 실제 완료일 기준 선택, 말일 자동 보정)
3. PostgreSQL 원자적 RPC 기반 완료 처리 엔진 (멱등성 보장)
4. 피드 카드형 Life Timeline 및 보조 캘린더
5. 앱 내 알림 센터(DB SSOT) 및 Web Push
6. 비로그인 가족용 토큰 기반 Magic Link 완료 웹페이지 (GET 조회 / POST 완료 분리)
7. Supabase Storage 기반 파일(매뉴얼/영수증) 첨부 및 JSON 백업/복구

### STRICTLY FORBIDDEN (Phase 1 Out-of-Scope)
- **AI/LLM 사용 금지:** 자연어 파싱, 영수증/라벨 OCR, RAG 벡터 검색 구현 금지
- **외부 유료 메신저 금지:** 카카오 알림톡, 문자(SMS), 텔레그램 봇 연동 금지
- **복잡한 분산 아키텍처 금지:** 마이크로서비스, Kafka, CRDT 양방향 오프라인 동기화 구현 금지
- **임의 기능 확장 금지:** 간트차트, 가계부/비용 계산기, 복잡한 통계 대시보드 추가 금지

---

## 4. Database & Engineering Rules (Must Follow)

### A. Schema & Multi-tenancy Rules
- 모든 핵심 테이블(`assets`, `tasks`, `events`, `files`)은 `household_id`와 `owner_id`를 가짐.
- `visibility` 필드는 `FAMILY`(가족 공유)와 `PRIVATE`(개인 전용)로 구분.
- Role 분리:
  - `Admin`: 자산/규칙 CUD, 가족 관리, 백업/복원
  - `Member`: 데이터 조회, 본인 Task 처리, 허용된 가족 Task 완료/연기

### B. Concurrency & Idempotency Rules
1. **Locking Order (교착 상태 방지):**
   - 모든 완료/변경 트랜잭션은 반드시 다음 순서로 잠금:
     `[1. magic_tokens (FOR UPDATE)]` → `[2. tasks (FOR UPDATE)]` → `[3. task_rules (FOR UPDATE)]`
2. **Idempotency Engine:**
   - `idempotency_keys` 테이블 `(household_id, actor_identifier, idempotency_key)` UNIQUE 제약 필수.
   - 반복 과업 인스턴스는 `(rule_id, iteration_no)` 복합 UNIQUE 제약으로 중복 생성 차단.
3. **Transaction Atomicity:**
   - `[Task 상태 COMPLETED]` + `[Event Log 기록]` + `[다음 Task 생성]`은 반드시 단일 RPC 트랜잭션으로 실행.

### C. Timezone & Recurring Rules
- 모든 DB 타임스탬프(`created_at`, `completed_at` 등)는 **UTC** 기준 `timestamptz`.
- 반복 과업 규칙 계산은 **Asia/Seoul(Wall-clock)** 기준으로 계산.
- **End-of-Month Clamping:** 매월 31일 반복 규칙이 2월, 4월 등 말일이 짧은 달을 만날 경우, **해당 월의 마지막 날로 자동 보정**.

### D. Magic Link Security
- DB에는 토큰 원본이 아닌 **SHA-256 해시값**만 저장.
- Magic Link 완료 RPC(`complete_via_magic_token`)는 `SECURITY DEFINER`로 작성하되, `SET search_path = public, pg_temp;` 고정.
- `GET` 요청은 단순 화면 렌더링만 수행하며, 토큰 소비 및 과업 처리는 **`POST` 요청 성공 시점에만 원자적으로 처리**.

### E. Directory & Architecture Conventions (Feature-Driven)
- **App Router (`src/app/`):** 라우팅과 레이아웃 구성에만 집중하며, 복잡한 비즈니스 로직과 UI 구현을 담지 않는다 (Thin Route).
- **Features (`src/features/<domain>/`):** 특정 도메인에 종속된 UI, 훅, 액션, 스키마는 반드시 해당 feature 폴더 내에 배치한다 (Colocation).
- **Shared (`src/shared/`):** 2개 이상의 도메인에서 공통으로 쓰이는 shadcn/ui, 글로벌 훅, Supabase 클라이언트 인스턴스만 배치한다.
- **Supabase Clients (`src/shared/lib/supabase/`):**
  - 클라이언트 컴포넌트: `createBrowserClient`
  - 서버 액션/서버 컴포넌트: `createServerClient` (쿠키 기반)
  - `SUPABASE_SERVICE_ROLE_KEY`는 API Route의 특수 백채널 작업 외에는 절대 클라이언트에 노출하지 않는다.

### F. UI Design System (Mandatory)
- **모든 프론트엔드 UI 컴포넌트 및 페이지 구현은 반드시 `docs/DESIGN_SYSTEM.md`의 디자인 토큰(색상·타이포·모서리·간격) 및 컴포넌트 패턴(요약 배너, 알약 필터, 아이콘 박스 카드, D-Day 뱃지, 엠프티 스테이트)을 준수해야 한다.**
- 새 화면/컴포넌트 작성 전 해당 문서를 먼저 읽고, 문서에 없는 패턴이 필요하면 임의로 만들지 말고 문서를 먼저 갱신한 뒤 구현한다.
- Tailwind 색상 클래스는 보간(`bg-${c}-100`) 없이 완성된 문자열로 작성하고, 모든 색상 클래스는 `dark:` 변형을 함께 정의한다.

---

## 5. Implementation Workflow (Step-by-Step)
코딩 진행 시 다음 단계를 엄격히 준수하며, 앞 단계 테스트 통과 전 다음 단계로 넘어가지 않는다.

1. **Phase 1-1:** Supabase DDL, RLS, Storage 정책 스크립트 작성
2. **Phase 1-2:** 핵심 RPC 함수 작성 (`complete_task_and_generate_next`, `complete_via_magic_token`)
3. **Phase 1-3:** Quality Gates 4대 단위 테스트 검증 (격리, 멱등성, 토큰 보안, 날짜 보정)
4. **Phase 1-4:** Next.js 프로젝트 세팅 및 UI 컴포넌트(shadcn/ui) 구현
5. **Phase 1-5:** Web Push 연동, Magic Link 페이지 및 JSON 백업/복구 구현