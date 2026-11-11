// 항목별 맥락 도움말(? 버튼) 콘텐츠. 문구는 여기서만 관리한다.
export type HelpEntry = { title: string; content: string; tips: readonly string[] };

export const HELP_CONTENT = {
  appliance_dday: {
    title: "가전 자산 & 소모품 D-Day",
    content: "정수기 필터, 공기청정기 필터, 비데 노즐 등 교체 주기와 렌탈 약정 만료일을 등록해 두면 기한에 맞춰 미리 알려드려요.",
    tips: ["가전 추가 시 기본 추천 주기가 자동 입력됩니다.", "완료 후 '교체 완료'를 누르면 다음 주기가 자동 갱신됩니다."],
  },
  daily_budget: {
    title: "오늘의 권장 식비란?",
    content: "이번 달 남은 식비 예산을 남은 일수로 나눈 '오늘 마음 편히 쓸 수 있는 하루 예산'입니다.",
    tips: ["외식/배달비가 기록되면 자동으로 실시간 재계산됩니다.", "초과 시 빨간색 알림과 함께 예산 방어 가이드가 표시됩니다."],
  },
  smart_stock: {
    title: "스마트 식재료 보관함",
    content: "냉장고 속 재료의 보관 위치(냉장/냉동/실온)와 소비기한을 관리합니다.",
    tips: ["소비기한 3일 이내 재료는 노란색/빨간색 뱃지로 강조됩니다.", "사용한 재료는 체크 한 번으로 소진 처리할 수 있습니다."],
  },
  zero_typing: {
    title: "찰칵 입고 & 말로 정리",
    content: "영수증이나 식재료 사진을 찍으면 AI가 품목명, 수량, 금액, 소비기한을 자동으로 분류해 냉장고에 등록합니다.",
    tips: ["마트 영수증 전체가 나오도록 수직으로 찍으면 인식률이 가장 높습니다.", "식비 장부에도 구매 금액이 한 번에 자동 기록됩니다."],
  },
  ai_chef: {
    title: "냉장고 파먹기 AI 셰프",
    content: "현재 유통기한이 임박한 식재료들을 최우선으로 조합하여 오늘 해먹기 좋은 맞춤 요리를 제안합니다.",
    tips: ["반려동물에게 위험한 양파/초콜릿 등 독성 식재료는 안전 주의 문구가 함께 뜹니다."],
  },
  household_sync: {
    title: "부부·가족 실시간 공유",
    content: "초대된 가족 구성원은 같은 냉장고 재고와 가전 상태를 실시간으로 함께 확인하고 수정할 수 있습니다.",
    tips: ["나만의 비상금이나 개인 메모는 'PRIVATE(나만보기)'으로 설정할 수 있습니다."],
  },
} as const satisfies Record<string, HelpEntry>;

export type HelpTopicKey = keyof typeof HELP_CONTENT;
