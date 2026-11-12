// Pure constants shared by the server (Gemini prompt, actions) and the UI. No imports: safe in client bundles and Node tests.
export const ROOM_TYPES = ["living", "bedroom", "kitchen", "study", "kids", "etc"] as const;
export type RoomType = (typeof ROOM_TYPES)[number];

export const ROOM_OPTIONS: readonly { value: RoomType; label: string }[] = [
  { value: "living", label: "거실" },
  { value: "bedroom", label: "안방/침실" },
  { value: "kitchen", label: "주방" },
  { value: "study", label: "서재" },
  { value: "kids", label: "아이방" },
  { value: "etc", label: "기타" },
];
export const roomLabel = (t: string) => ROOM_OPTIONS.find((o) => o.value === t)?.label ?? "기타";

export const STYLE_OPTIONS = ["화이트 우드", "모던 미니멀", "내추럴 패브릭", "아기 안전", "호텔식"] as const;

export const CANDIDATE_STATUSES = ["CANDIDATE", "SELECTED", "PURCHASED"] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];
export const STATUS_LABEL: Record<CandidateStatus, string> = { CANDIDATE: "후보", SELECTED: "최종 픽", PURCHASED: "구매 완료" };

export const MAX_ANNOTATIONS = 30;
