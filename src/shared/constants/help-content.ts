// 항목별 사용 가이드(3단계 슬라이드 튜토리얼) 콘텐츠. 문구는 여기서만 관리한다.
export type HelpIconKey =
  | "plus" | "calendar" | "check" | "camera" | "fridge" | "wallet" | "ring" | "receipt"
  | "chef" | "paw" | "sparkles" | "users" | "lock" | "mic" | "timer" | "shield" | "ruler" | "sofa";

export type HelpStep = { step: 1 | 2 | 3; title: string; desc: string; icon: HelpIconKey; badge: string };
export type HelpEntry = { title: string; label: string; steps: readonly [HelpStep, HelpStep, HelpStep] };

export const HELP_CONTENT = {
  space_planner: {
    title: "공간·가구 플래너",
    label: "사용 가이드",
    steps: [
      { step: 1, title: "1. 사진 찍고 실측 치수 표시", desc: "가구를 놓을 공간 사진을 올리고, ‘선 긋기’로 벽·창문 위에 두 점을 드래그해 실제 길이(cm)를 적어요.", icon: "ruler", badge: "실측" },
      { step: 2, title: "2. AI 가구 추천받기", desc: "공간 용도와 스타일을 고르면 AI가 공간 톤과 치수에 맞는 가구 3가지를 추천하고, 들어갈지 여유까지 알려줘요.", icon: "sparkles", badge: "AI 추천" },
      { step: 3, title: "3. 부부 위시 보드에 담기", desc: "마음에 드는 가구를 위시 보드에 담고 오늘의집·네이버·쿠팡·이케아에서 바로 찾아봐요. 후보 → 최종 픽 → 구매 완료로 함께 정리해요.", icon: "sofa", badge: "함께 고르기" },
    ],
  },
  appliance_dday: {
    title: "가전 자산 & 소모품 D-Day",
    label: "사용 가이드",
    steps: [
      { step: 1, title: "1. 가전·렌탈 추가", desc: "‘+ 가전 추가’를 눌러 정수기·공기청정기처럼 자주 쓰는 가전을 골라요. 렌탈은 약정 정보도 함께 넣어요.", icon: "plus", badge: "등록" },
      { step: 2, title: "2. D-Day와 교체 주기 설정", desc: "필터 교체 주기와 렌탈 만료일을 정해 두면 기한에 맞춰 미리 알려드려요. 기본 추천 주기가 자동으로 들어가요.", icon: "calendar", badge: "D-Day" },
      { step: 3, title: "3. 교체 완료로 자동 갱신", desc: "교체를 마치고 ‘교체 완료’를 누르면 다음 주기가 자동으로 만들어져요.", icon: "check", badge: "자동 갱신" },
    ],
  },
  smart_stock: {
    title: "스마트 식재료 보관함",
    label: "사용 가이드",
    steps: [
      { step: 1, title: "1. 찰칵 영수증 입고", desc: "‘찰칵 입고’로 영수증이나 재료를 찍으면 품목과 보관 위치가 냉장고에 한 번에 등록돼요.", icon: "camera", badge: "입고" },
      { step: 2, title: "2. 유통기한 D-Day 확인", desc: "냉장·냉동·실온 탭에서 확인해요. 소비기한 3일 이내 재료는 노란색·빨간색 뱃지로 눈에 띄어요.", icon: "fridge", badge: "D-Day" },
      { step: 3, title: "3. 다 쓰면 소진 체크", desc: "사용한 재료는 체크 한 번으로 소진 처리하고, 남은 재료만 깔끔하게 관리해요.", icon: "check", badge: "소진" },
    ],
  },
  daily_budget: {
    title: "오늘의 권장 식비란?",
    label: "사용 가이드",
    steps: [
      { step: 1, title: "1. 월 식비 예산 설정", desc: "이번 달 식비 예산을 정해 두면 계산의 기준이 돼요. 예산은 언제든 바꿀 수 있어요.", icon: "wallet", badge: "예산" },
      { step: 2, title: "2. 오늘 권장 식비 확인", desc: "남은 예산을 남은 일수로 나눈 ‘오늘 마음 편히 쓸 수 있는 금액’이 링과 알약에 표시돼요.", icon: "ring", badge: "오늘 예산" },
      { step: 3, title: "3. 지출 기록 시 실시간 방어", desc: "외식·배달비를 기록하면 바로 다시 계산돼요. 초과하면 빨간색 알림과 방어 가이드가 떠요.", icon: "shield", badge: "실시간" },
    ],
  },
  zero_typing: {
    title: "찰칵 입고 & 말로 정리",
    label: "등록 튜토리얼",
    steps: [
      { step: 1, title: "1. 영수증·재료 찰칵", desc: "마트 영수증 전체가 나오도록 수직으로 찍으면 인식률이 가장 높아요. 말로 입력해도 돼요.", icon: "camera", badge: "촬영" },
      { step: 2, title: "2. AI가 자동으로 분류", desc: "품목명·수량·금액·소비기한을 AI가 나눠 보여줘요. 틀린 부분만 고쳐 주세요.", icon: "sparkles", badge: "AI 분류" },
      { step: 3, title: "3. 냉장고와 장부에 자동 등록", desc: "확인을 누르면 재료는 냉장고에, 구매 금액은 식비 장부에 한 번에 기록돼요.", icon: "receipt", badge: "자동 기록" },
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
      { step: 2, title: "2. 같은 재고·가전을 함께", desc: "초대된 가족은 같은 냉장고 재고와 가전 상태를 실시간으로 보고 수정해요.", icon: "fridge", badge: "공유" },
      { step: 3, title: "3. 나만 보기로 비공개", desc: "비상금이나 개인 메모는 ‘PRIVATE(나만보기)’로 설정하면 가족에게 보이지 않아요.", icon: "lock", badge: "비공개" },
    ],
  },
} as const satisfies Record<string, HelpEntry>;

export type HelpTopicKey = keyof typeof HELP_CONTENT;
