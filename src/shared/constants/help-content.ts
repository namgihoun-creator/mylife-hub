// 항목별 사용 가이드(3단계 슬라이드 튜토리얼) 콘텐츠. 문구는 여기서만 관리한다.
// 탭별 대표 가이드: 자산(appliance_dday) · 키친(zero_typing, 보조 smart_stock) · 타임라인(timeline_actions) · 리포트(analytics_report) · 공간(space_planner).
// 새 기능을 넣을 때는 해당 탭의 3단계 문구도 함께 현행화한다 (docs/DESIGN_SYSTEM.md §W).
export type HelpIconKey =
  | "plus" | "calendar" | "check" | "camera" | "fridge" | "wallet" | "ring" | "receipt"
  | "chef" | "paw" | "sparkles" | "users" | "lock" | "mic" | "timer" | "shield" | "ruler" | "sofa"
  | "bell" | "cart" | "chart" | "link";

export type HelpStep = { step: 1 | 2 | 3; title: string; desc: string; icon: HelpIconKey; badge: string };
export type HelpEntry = { title: string; label: string; steps: readonly [HelpStep, HelpStep, HelpStep] };

export const HELP_CONTENT = {
  space_planner: {
    title: "공간·가구 플래너",
    label: "사용 가이드",
    steps: [
      { step: 1, title: "1. 사진 위 치수 마킹 & AR 실측", desc: "공간 사진을 올리고 ‘선 긋기’로 손가락을 끌어 벽·창문 길이(cm)를 적어요. 안드로이드 Chrome에서는 ‘AR 카메라로 재기(Beta)’로 실제 길이를 바로 잴 수 있어요(조명에 따라 2~5cm 오차).", icon: "ruler", badge: "실측" },
      { step: 2, title: "2. AI 가구 추천 & 쇼핑몰 원클릭 검색", desc: "용도와 스타일을 고르면 AI가 가구 3가지를 추천하고, 어느 치수를 기준으로 들어가는지 근거와 함께 알려줘요. 오늘의집·네이버·쿠팡·이케아 버튼으로 바로 검색해요.", icon: "sparkles", badge: "AI 추천" },
      { step: 3, title: "3. 위시 보드: URL 자동 채움 · ♥ 투표 · 예산", desc: "상품 링크를 붙여넣으면 이름·가격·썸네일이 채워져요. 둘 다 ♥를 누르면 ‘부부 공동 픽’이 되고, 최종 픽·전체 후보 합계 금액이 실시간으로 보여요.", icon: "sofa", badge: "함께 고르기" },
    ],
  },
  appliance_dday: {
    title: "가전 자산 & 소모품 D-Day",
    label: "사용 가이드",
    steps: [
      { step: 1, title: "1. 기본 가전 1분 세팅", desc: "‘기본 가전 1분 세팅’에서 냉장고·세탁기 등 8종 중 있는 것만 고르고 자가·렌탈을 눌러 한 번에 등록해요. 청소·소모품 주기도 같이 만들어져요. 하나씩 고르려면 ‘+ 가전 추가’를 써요.", icon: "plus", badge: "1분 세팅" },
      { step: 2, title: "2. 소모품 D-7 사전 알림", desc: "필터·소모품 교체일 7일 전부터 알림 벨과 푸시로 미리 알려드려요. ‘교체 완료’를 누르면 다음 주기가 자동으로 만들어져요.", icon: "calendar", badge: "D-7 알림" },
      { step: 3, title: "3. 렌탈 약정 D-90 방어 알림", desc: "렌탈은 약정 만료 3개월 전(D-90)에 한 번, 이어서 D-60·D-30에 알려줘요. 알림을 누르면 환승 비교 탭이 열려 위약금 없는 타이밍을 놓치지 않아요.", icon: "shield", badge: "약정 방어" },
    ],
  },
  smart_stock: {
    title: "스마트 식재료 보관함",
    label: "사용 가이드",
    steps: [
      { step: 1, title: "1. 찰칵 영수증 입고", desc: "‘찰칵 입고’로 영수증이나 재료를 찍으면 품목과 보관 위치가 냉장고에 한 번에 등록돼요.", icon: "camera", badge: "입고" },
      { step: 2, title: "2. 유통기한 D-Day 확인", desc: "냉장·냉동·실온 탭에서 확인해요. 소비기한 3일 이내 재료는 노란색·빨간색 뱃지로 눈에 띄고 알림도 와요.", icon: "fridge", badge: "D-Day" },
      { step: 3, title: "3. 소진 체크 & + 장보기", desc: "다 쓴 재료는 한 번에 소진 처리하고, 떨어져 가는 재료는 카드의 ‘+ 장보기’로 부부 공동 장보기 리스트에 바로 보내요.", icon: "check", badge: "소진·장보기" },
    ],
  },
  daily_budget: {
    title: "오늘의 권장 식비란?",
    label: "사용 가이드",
    steps: [
      { step: 1, title: "1. 월 식비 예산 설정", desc: "이번 달 식비 예산을 정해 두면 계산의 기준이 돼요. 예산은 언제든 바꿀 수 있어요.", icon: "wallet", badge: "예산" },
      { step: 2, title: "2. 오늘 권장 식비 확인", desc: "남은 예산을 남은 일수로 나눈 ‘오늘 마음 편히 쓸 수 있는 금액’이 링과 알약에 표시돼요.", icon: "ring", badge: "오늘 예산" },
      { step: 3, title: "3. 지출 기록 시 실시간 방어", desc: "외식·배달비를 기록하면 바로 다시 계산돼요. 초과하면 빨간색 알림과 방어 가이드가 떠요. 한 달 성적은 리포트의 ‘월말 살림 결산’에서 봐요.", icon: "shield", badge: "실시간" },
    ],
  },
  zero_typing: {
    title: "키친 사용 가이드",
    label: "사용 가이드",
    steps: [
      { step: 1, title: "1. 영수증 찰칵 입고 & 일괄 검수", desc: "영수증을 찍으면 품목이 한 번에 읽혀요. 줄마다 냉장·냉동·실온을 한 번에 바꾸고, 소비기한은 -3일·+3일·+7일로 맞추고, 잘못 읽힌 품목은 휴지통으로 빼요. 합계는 실시간으로 보여요.", icon: "camera", badge: "일괄 검수" },
      { step: 2, title: "2. 소비기한 D-3 알림", desc: "소비기한 3일 전부터 알림이 와요. 알림 벨에서 ‘소진 완료’를 누르면 보관함에서 바로 정리돼요. 말로 입력해도 돼요.", icon: "timer", badge: "D-3 알림" },
      { step: 3, title: "3. 부부 공동 장보기 리스트", desc: "‘장보기’ 탭을 둘이 함께 쓰고, 보관함 카드의 ‘+ 장보기’로 떨어져 가는 재료를 한 번에 담아요. 장본 뒤에는 ‘보관함으로 바로 입고’ 한 번이면 끝나요.", icon: "cart", badge: "공동 장보기" },
    ],
  },
  timeline_actions: {
    title: "생활 타임라인 & 알림 벨",
    label: "사용 가이드",
    steps: [
      { step: 1, title: "1. 오늘 할 일 한눈에", desc: "타임라인에서 오늘·곧 올 관리 일정을 보고 완료·연기·건너뛰기를 바로 눌러요. 반복 일정은 완료하면 다음 예정일이 자동으로 생겨요.", icon: "calendar", badge: "타임라인" },
      { step: 2, title: "2. 알림 벨에서 원탭 완료", desc: "알림 벨의 ‘교체·점검 완료’, ‘소진 완료’ 캡슐을 누르면 화면을 옮기지 않고 바로 처리되고 알림도 읽음이 돼요. 이미 처리된 항목은 알림만 정리돼요.", icon: "bell", badge: "원탭 완료" },
      { step: 3, title: "3. 딥링크 바로가기 & 푸시", desc: "알림 본문을 누르면 해당 가전 상세, 렌탈 환승 비교, 키친 재료 위치로 곧장 이동해요. 아이폰은 공유 → ‘홈 화면에 추가’로 설치해야 아침 9시 푸시를 받아요.", icon: "link", badge: "바로가기" },
    ],
  },
  analytics_report: {
    title: "리포트 & 월말 결산",
    label: "사용 가이드",
    steps: [
      { step: 1, title: "1. 일일 권장 식비 방어", desc: "식비 예산을 정하면 ‘오늘 쓸 수 있는 금액’을 계산하고, 지출을 기록할 때마다 바로 다시 계산해 초과를 막아줘요. 이번 달 식비·양육비는 아래 카드에서 렌탈과 함께 봐요.", icon: "wallet", badge: "식비 방어" },
      { step: 2, title: "2. 공과금·관리비 고지서 찰칵 등록", desc: "전기·가스·수도·관리비·통신비 고지서를 찍으면 금액과 납부기한을 읽어요. 확인하고 저장하면 월별 합계와 전월 대비가 보여요. 사진 없이 직접 입력해도 돼요.", icon: "receipt", badge: "고지서" },
      { step: 3, title: "3. 월말 부부 살림 결산", desc: "‹ › 로 월을 넘기며 식비 예산 방어율, 만료·폐기 손실 추산, 둘이 함께 한 가전 점검·소진·장보기 건수를 한 장의 성적표로 확인해요.", icon: "chart", badge: "결산" },
    ],
  },
  ai_chef: {
    title: "냉장고 파먹기 AI 셰프",
    label: "사용 가이드",
    steps: [
      { step: 1, title: "1. 임박 재료 자동 선택", desc: "유통기한이 가까운 재료가 우선으로 골라져요. 따로 고를 필요가 없어요.", icon: "timer", badge: "임박 재료" },
      { step: 2, title: "2. AI 맞춤 레시피 생성", desc: "‘레시피 만들기’를 누르면 지금 있는 재료로 해먹기 좋은 요리를 제안해요.", icon: "chef", badge: "AI 레시피" },
      { step: 3, title: "3. 반려동물 독성 안전 체크", desc: "양파·초콜릿 같은 위험 재료는 안전 주의 문구가 함께 떠서 안심하고 만들 수 있어요.", icon: "paw", badge: "안전" },
    ],
  },
  household_sync: {
    title: "부부·가족 실시간 공유",
    label: "사용 가이드",
    steps: [
      { step: 1, title: "1. 가족 초대 링크 보내기", desc: "가구 설정에서 초대 링크를 만들어 가족에게 보내요. 링크는 한 번만 쓸 수 있어요.", icon: "users", badge: "초대" },
      { step: 2, title: "2. 같은 재고·가전을 함께", desc: "초대된 가족은 같은 냉장고 재고, 장보기 리스트, 가전 상태를 함께 보고 고쳐요.", icon: "fridge", badge: "공유" },
      { step: 3, title: "3. 나만 보기로 비공개", desc: "비상금이나 개인 메모는 ‘PRIVATE(나만보기)’로 설정하면 가족에게 보이지 않아요.", icon: "lock", badge: "비공개" },
    ],
  },
} as const satisfies Record<string, HelpEntry>;

export type HelpTopicKey = keyof typeof HELP_CONTENT;
