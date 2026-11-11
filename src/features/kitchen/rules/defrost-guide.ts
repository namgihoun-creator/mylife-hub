// Microwave / thawing guide for "freezer fossil" ingredients (CookSaver `bulk.DEFROST_SOLUTIONS`).
// The ORDER is the priority: processed foods (dumplings, rice) are checked before raw meat / vegetables.

export type DefrostGroup = "밥/떡/빵" | "채소/만두" | "생선/해물" | "육류/가금류" | "기타";
export type DefrostInfo = { group: DefrostGroup; defrost: string; odor: string };

type Rule = { group: Exclude<DefrostGroup, "기타">; words: readonly string[]; defrost: string; odor: string };

export const DEFROST_RULES: readonly Rule[] = [
  { group: "밥/떡/빵", words: ["밥", "떡", "빵", "식빵", "베이글", "또띠아", "머핀", "케이크", "토스트"], defrost: "물 한 컵과 함께 전자레인지 2분", odor: "랩 씌워 수분 보존" },
  {
    group: "채소/만두",
    words: ["만두", "채소", "대파", "양파", "시금치", "브로콜리", "옥수수", "감자", "고구마", "애호박", "부추", "당근", "버섯", "마늘", "고추", "야채", "딤섬"],
    defrost: "해동 없이 냉동 상태로 즉시 가열 조리 권장",
    odor: "",
  },
  {
    group: "생선/해물",
    words: ["생선", "고등어", "연어", "갈치", "새우", "오징어", "조개", "해물", "낙지", "굴", "꽃게", "전복", "명태", "동태", "조기", "참치", "문어", "쭈꾸미", "어묵"],
    defrost: "소금물 15분 침지 해동",
    odor: "레몬즙·식초로 비린내 제거",
  },
  {
    group: "육류/가금류",
    words: ["고기", "삼겹", "목살", "항정", "갈비", "등심", "안심", "불고기", "소고기", "돼지", "닭", "오리", "다짐육", "차돌", "사태", "베이컨", "햄", "소시지", "스테이크", "한우"],
    defrost: "전자레인지 200W(해동모드) 3~4분",
    odor: "청주·생강즙으로 잡내 제거",
  },
];

export const DEFROST_DEFAULT: DefrostInfo = {
  group: "기타",
  defrost: "냉장실에서 천천히 해동",
  odor: "해동한 뒤에는 다시 얼리지 말고 오늘 안에 조리하세요",
};

/** Thawing advice for an ingredient name; unknown / blank names get the safe default (slow thaw in the fridge). */
export function defrostInfo(name: unknown): DefrostInfo {
  const text = typeof name === "string" ? name : "";
  for (const r of DEFROST_RULES) {
    if (r.words.some((w) => text.includes(w))) return { group: r.group, defrost: r.defrost, odor: r.odor };
  }
  return { ...DEFROST_DEFAULT };
}
