// Offline recipes for the AI chef (ported from CookSaver `recipes.py` + a small catalogue of named dishes). Used whenever the
// AI is unavailable (no key / failure): templates are ranked by how many of the fridge's ingredients they use, and the generic
// "fit the ingredients in" recipes fill the rest. The pet recipes follow the CookSaver pet rule: 0% salt, no oil, no
// seasoning, boiled or steamed only, served cooled. Pure; no I/O.
import { PET_TOXIC, isPetSafe, isPetToxic } from "./pet-safety.ts";

export const DIFFICULTIES = ["초급", "중급", "고급"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export type Recipe = {
  title: string;
  subtitle: string;
  cookTime: string;
  difficulty: Difficulty;
  mainIngredients: string[];
  condiments: string[];
  steps: string[]; // 1..4
  chefTip: string;
  substituteTip: string;
  calories: number | null;
  kind: "human" | "pet";
};

export type RankedRecipe = Recipe & {
  /** the fridge ingredients this recipe uses */
  matched: string[];
  /** ingredients of the recipe that are NOT in the fridge */
  missing: string[];
  origin: "template" | "generic" | "allkill" | "pet-generic";
};

type Template = Omit<Recipe, "kind" | "mainIngredients"> & { needs: string[]; staples?: string[] };

const squash = (s: string) => s.replace(/\s+/g, "");
/** An ingredient 'need' is present when a fridge name contains it (or the other way round for names of 2+ characters). */
export const hasIngredient = (names: readonly string[], need: string): boolean => names.some((n) => { const a = squash(n), b = squash(need); return a.length >= 2 && (a.includes(b) || b.includes(a)); });
const MAX_NAMES = 30;

/** Korean object particle for generated sentences: 두부 -> '두부를', 김치 -> '김치를', 삼겹살 -> '삼겹살을'. */
const eulReul = (s: string) => { const last = s.trim().slice(-1); return /[가-힣]/.test(last) && (last.charCodeAt(0) - 0xac00) % 28 !== 0 ? `${s}을` : `${s}를`; };
/** '신라면' -> '신라면으로', '두부' -> '두부로' (ported `with_ro`). */
export const withRo = (text: string): string => {
  const last = text.trim().slice(-1);
  if (/[가-힣]/.test(last)) {
    const batchim = (last.charCodeAt(0) - 0xac00) % 28;
    return text + (batchim === 0 || batchim === 8 ? "로" : "으로");
  }
  return `${text}로`;
};

// ---------------------------------------------------------------------------------------------- named human dishes
export const HUMAN_TEMPLATES: readonly Template[] = [
  {
    title: "계란볶음밥 12분", subtitle: "냉장고 계란과 대파로 뚝딱 만드는 기본 볶음밥", cookTime: "12분", difficulty: "초급", calories: 520,
    needs: ["계란", "대파"], staples: ["밥"], condiments: ["진간장 1숟가락", "식용유 1숟가락", "소금 한 꼬집"],
    steps: ["대파를 송송 썰고 계란은 소금 한 꼬집을 넣어 풀어요.", "달군 팬에 식용유와 대파를 넣고 중불에서 1분 볶아 파기름을 내요.", "계란물을 넣어 스크램블로 휘저은 뒤 밥 한 공기를 넣고 3분 볶아요.", "팬 가장자리에 진간장을 둘러 향을 내고 한 번 더 볶아 마무리해요."],
    chefTip: "찬밥을 쓰면 알알이 흩어져서 더 고슬고슬해요. 밥을 넣기 전에 계란을 반쯤만 익히세요.", substituteTip: "대파가 없으면 양파 1/4개를 잘게 다져 써도 좋아요.",
  },
  {
    title: "된장찌개 20분", subtitle: "두부와 채소가 듬뿍 들어간 구수한 찌개", cookTime: "20분", difficulty: "초급", calories: 180,
    needs: ["두부", "양파", "애호박", "대파"], condiments: ["된장 1.5숟가락", "다진마늘 0.5숟가락", "고춧가루 약간"],
    steps: ["양파·애호박은 한 입 크기로, 두부는 깍둑썰기, 대파는 송송 썰어요.", "냄비에 물 두 컵과 된장을 풀어 끓이고, 양파와 애호박을 먼저 넣어 5분 끓여요.", "두부와 다진마늘을 넣고 5분 더 끓여요.", "대파를 넣고 한소끔 끓여 간을 보고 마무리해요."],
    chefTip: "된장은 체에 풀면 찌꺼기 없이 깔끔해요. 멸치 육수를 쓰면 더 깊은 맛이 나요.", substituteTip: "애호박 대신 감자나 버섯을 넣어도 좋아요.",
  },
  {
    title: "두부조림 15분", subtitle: "밥도둑 매콤 간장 두부조림", cookTime: "15분", difficulty: "초급", calories: 210,
    needs: ["두부", "대파", "양파"], condiments: ["진간장 2숟가락", "고춧가루 1숟가락", "설탕 0.5숟가락", "다진마늘 0.5숟가락"],
    steps: ["두부를 도톰하게 썰어 키친타월로 물기를 닦아요.", "달군 팬에 기름을 두르고 두부 앞뒤를 노릇하게 부쳐요.", "물 반 컵에 간장·고춧가루·설탕·다진마늘을 섞어 양념장을 만들어요.", "두부 위에 양념장과 양파·대파를 올려 중약불에서 5분 졸여요."],
    chefTip: "두부를 먼저 부쳐 두면 졸여도 부서지지 않아요. 양념을 숟가락으로 끼얹어 주세요.", substituteTip: "고춧가루가 없으면 간장 양념만으로도 담백하게 즐길 수 있어요.",
  },
  {
    title: "김치볶음밥 12분", subtitle: "익은 김치로 만드는 칼칼한 한 그릇", cookTime: "12분", difficulty: "초급", calories: 560,
    needs: ["김치", "계란", "대파"], staples: ["밥"], condiments: ["식용유 1숟가락", "진간장 0.5숟가락", "참기름 0.5숟가락"],
    steps: ["김치는 잘게 썰고 대파는 송송 썰어요.", "달군 팬에 식용유와 대파를 볶다가 김치를 넣고 3분 볶아요.", "밥을 넣고 진간장을 둘러 골고루 섞으며 3분 볶아요.", "계란프라이를 올리고 참기름을 둘러 마무리해요."],
    chefTip: "김치를 충분히 볶아야 신맛이 날아가고 단맛이 살아요.", substituteTip: "계란 대신 참치캔을 넣어도 맛있어요.",
  },
  {
    title: "계란말이 10분", subtitle: "대파·당근을 넣은 도톰한 계란말이", cookTime: "10분", difficulty: "중급", calories: 230,
    needs: ["계란", "대파", "당근"], condiments: ["소금 한 꼬집", "식용유 약간"],
    steps: ["계란을 풀고 소금 한 꼬집을 넣어 섞어요.", "대파와 당근을 아주 잘게 다져 계란물에 넣어요.", "약불에 기름을 살짝 두른 팬에 계란물을 한 번에 1/3씩 부어 돌돌 말아요.", "다 말면 한 김 식혀 먹기 좋게 썰어요."],
    chefTip: "불을 약하게 하고 가장자리가 익기 시작할 때 말아야 터지지 않아요.", substituteTip: "당근이 없으면 양파나 피망을 다져 넣어도 좋아요.",
  },
  {
    title: "대파계란국 10분", subtitle: "속 편한 맑은 계란국", cookTime: "10분", difficulty: "초급", calories: 90,
    needs: ["계란", "대파"], condiments: ["국간장 1숟가락", "참기름 0.5숟가락", "소금 약간"],
    steps: ["대파를 송송 썰고 계란은 곱게 풀어요.", "냄비에 물 두 컵과 국간장을 넣고 끓여요.", "끓으면 계란물을 가늘게 둘러 부어 몽글하게 익혀요.", "대파와 참기름을 넣고 소금으로 간을 맞춰요."],
    chefTip: "계란물을 넣고 바로 젓지 말고 30초 기다리면 몽글몽글해요.", substituteTip: "대파 대신 양파나 애호박을 넣어도 시원해요.",
  },
  {
    title: "삼겹살 야채볶음 15분", subtitle: "삼겹살과 양파·양배추를 한 팬에", cookTime: "15분", difficulty: "초급", calories: 480,
    needs: ["삼겹살", "양파", "양배추", "대파"], condiments: ["진간장 1.5숟가락", "다진마늘 0.5숟가락", "후추 약간"],
    steps: ["삼겹살은 한 입 크기로, 양파·양배추·대파는 큼직하게 썰어요.", "기름 없이 달군 팬에 삼겹살을 넣고 중불에서 5분 노릇하게 구워요.", "양파와 양배추를 넣고 3분 볶아 숨이 죽게 해요.", "진간장과 다진마늘, 대파를 넣어 1분 더 볶아 마무리해요."],
    chefTip: "삼겹살에서 나오는 기름으로 채소를 볶으면 따로 기름이 필요 없어요.", substituteTip: "삼겹살 대신 목살이나 소시지를 써도 좋아요.",
  },
  {
    title: "두부계란부침 12분", subtitle: "단백질 가득 담백한 두부 부침", cookTime: "12분", difficulty: "초급", calories: 260,
    needs: ["두부", "계란"], condiments: ["소금 한 꼬집", "식용유 1숟가락"],
    steps: ["두부를 으깨 물기를 꼭 짜고 계란과 소금을 넣어 섞어요.", "원하면 다진 대파를 더해 반죽을 만들어요.", "달군 팬에 기름을 두르고 한 숟가락씩 떠서 동그랗게 펴요.", "중약불에서 앞뒤로 3분씩 노릇하게 부쳐요."],
    chefTip: "두부 물기를 최대한 짜야 부칠 때 부서지지 않아요.", substituteTip: "밀가루를 한 숟가락 넣으면 모양이 더 잘 잡혀요.",
  },
  {
    title: "소고기 미역국 25분", subtitle: "든든한 소고기 미역국", cookTime: "25분", difficulty: "중급", calories: 220,
    needs: ["소고기", "미역"], condiments: ["국간장 1.5숟가락", "참기름 1숟가락", "다진마늘 0.5숟가락"],
    steps: ["미역을 물에 불려 먹기 좋게 자르고 소고기는 잘게 썰어요.", "냄비에 참기름을 두르고 소고기와 미역을 3분 볶아요.", "물 세 컵과 국간장을 넣고 끓여요.", "중약불에서 15분 푹 끓이고 다진마늘로 간을 맞춰요."],
    chefTip: "미역을 참기름에 먼저 볶으면 국물이 훨씬 구수해요.", substituteTip: "소고기가 없으면 참치캔이나 조갯살을 써도 좋아요.",
  },
  {
    title: "계란 대파 라면 8분", subtitle: "라면에 계란과 대파로 한 끗 업그레이드", cookTime: "8분", difficulty: "초급", calories: 520,
    needs: ["라면", "계란", "대파"], condiments: ["후추 약간"],
    steps: ["대파를 송송 썰어요.", "냄비에 물을 끓여 면과 스프를 넣어요.", "면이 반쯤 익으면 대파를 넣고 계란을 풀어요.", "후추를 약간 뿌려 1분 더 끓여 마무리해요."],
    chefTip: "계란을 넣고 젓지 않으면 국물이 맑게 유지돼요.", substituteTip: "대파가 없으면 양파나 김치를 넣어도 좋아요.",
  },
  {
    title: "감자조림 20분", subtitle: "달짝지근한 간장 감자조림", cookTime: "20분", difficulty: "초급", calories: 190,
    needs: ["감자", "양파", "당근"], condiments: ["진간장 2숟가락", "설탕 1숟가락", "식용유 1숟가락"],
    steps: ["감자·당근·양파를 한 입 크기로 썰어요.", "달군 팬에 기름을 두르고 감자와 당근을 3분 볶아요.", "물 한 컵과 간장·설탕을 넣고 끓여요.", "양파를 넣고 뚜껑을 덮어 10분 졸여 국물이 자작하게 남으면 마무리해요."],
    chefTip: "감자를 찔러 젓가락이 쑥 들어가면 다 익은 거예요.", substituteTip: "당근 대신 베이컨을 넣으면 짭짤한 맛이 살아요.",
  },
  {
    title: "콩나물국 12분", subtitle: "시원한 아침 해장 콩나물국", cookTime: "12분", difficulty: "초급", calories: 60,
    needs: ["콩나물", "대파"], condiments: ["국간장 1숟가락", "다진마늘 0.5숟가락", "소금 약간"],
    steps: ["콩나물을 씻고 대파는 송송 썰어요.", "냄비에 물 세 컵과 콩나물을 넣고 뚜껑을 덮어 끓여요.", "끓으면 국간장과 다진마늘을 넣어요.", "대파를 넣고 소금으로 간을 맞춰 2분 더 끓여요."],
    chefTip: "끓는 동안 뚜껑을 자주 열면 비린내가 나니 한 번에 익히세요.", substituteTip: "청양고추를 넣으면 칼칼한 맛이 나요.",
  },
];

// ---------------------------------------------------------------------------------------------- pet specials
// Rules (CookSaver PET_RULE): salt 0%, no oil, no seasoning of any kind (water only), boil or steam, mash/chop, cool before
// serving, small amounts first. Every ingredient below is in PET_SAFE; no toxic ingredient may ever appear (unit-tested).
export const PET_TEMPLATES: readonly Template[] = [
  {
    title: "무염 닭가슴살 단호박 찜", subtitle: "소금·기름 없이 쪄서 으깬 댕냥이 보양식", cookTime: "25분", difficulty: "초급", calories: 140,
    needs: ["닭가슴살", "단호박"], condiments: [],
    steps: ["닭가슴살은 힘줄과 지방을 떼고, 단호박은 씨와 껍질을 제거해 한 입 크기로 썰어요.", "김이 오른 찜기에 닭가슴살과 단호박을 넣고 소금 없이 15분 쪄요.", "닭가슴살은 결대로 찢거나 잘게 다지고 단호박은 포크로 으깨 섞어요. (고양이는 더 곱게)", "충분히 식혀서 미지근할 때 급여해요. 처음에는 소량만 주세요."],
    chefTip: "사람 음식처럼 간을 하지 마세요. 염분 0%가 기본이고, 처음에는 소량으로 반응을 살펴보세요.", substituteTip: "단호박 대신 고구마를 써도 좋아요.",
  },
  {
    title: "소고기 당근 삶음", subtitle: "소금 없이 푹 삶은 소고기 당근 화식", cookTime: "25분", difficulty: "초급", calories: 160,
    needs: ["소고기", "당근"], condiments: [],
    steps: ["소고기 살코기는 지방을 떼고, 당근은 껍질을 벗겨 작게 썰어요.", "냄비에 재료가 잠길 만큼 물을 붓고 소금·기름 없이 20분 푹 삶아요.", "건져서 잘게 다지거나 으깨 알맞은 크기로 만들어요.", "충분히 식혀서 미지근하게 급여하고, 삶은 물은 식혀 국물로 섞어 줘도 좋아요. 처음에는 소량부터 주세요."],
    chefTip: "삶는 동안 뜨는 거품과 지방은 걷어 내면 속이 편해요. 간은 절대 하지 마세요.", substituteTip: "당근 대신 브로콜리를 넣어도 좋아요.",
  },
  {
    title: "고구마 브로콜리 찜", subtitle: "식이섬유 가득 쪄서 으깬 간식 겸 한 끼", cookTime: "20분", difficulty: "초급", calories: 110,
    needs: ["고구마", "브로콜리"], condiments: [],
    steps: ["고구마는 껍질을 벗겨 작게 썰고 브로콜리는 송이를 작게 잘라요.", "김이 오른 찜기에 소금 없이 15분 쪄요.", "포크로 으깨거나 잘게 다져 섞어요.", "충분히 식혀서 미지근할 때 급여해요. 고구마는 많이 주지 말고 소량만 주세요."],
    chefTip: "고구마는 당이 높아 간식 수준으로 소량만 주세요.", substituteTip: "브로콜리 대신 양배추를 써도 좋아요.",
  },
  {
    title: "두부 달걀 삶음", subtitle: "부드러운 단백질 한 그릇", cookTime: "15분", difficulty: "초급", calories: 130,
    needs: ["두부", "계란"], condiments: [],
    steps: ["계란은 완숙으로 삶아 껍질을 벗기고, 두부는 끓는 물에 3분 데쳐 물기를 빼요.", "계란과 두부를 포크로 잘게 으깨 섞어요.", "소금·기름·양념은 넣지 않고 그대로 준비해요.", "충분히 식혀서 미지근할 때 급여해요. 처음에는 소량부터 주세요."],
    chefTip: "달걀은 반드시 완전히 익혀서 주세요. 간은 하지 않아요.", substituteTip: "두부 대신 삶은 닭가슴살을 섞어도 좋아요.",
  },
  {
    title: "닭가슴살 양배추 삶음", subtitle: "담백한 삶은 닭가슴살과 양배추", cookTime: "20분", difficulty: "초급", calories: 120,
    needs: ["닭가슴살", "양배추"], condiments: [],
    steps: ["닭가슴살은 지방을 떼고, 양배추는 심을 빼고 작게 썰어요.", "냄비에 물을 붓고 소금 없이 닭가슴살을 12분 삶다가 양배추를 넣고 5분 더 삶아요.", "건져서 닭가슴살은 찢고 양배추와 함께 잘게 다져요.", "충분히 식혀서 미지근하게 급여해요. 처음에는 소량부터 주세요."],
    chefTip: "삶은 물은 식혀 소량 섞어 주면 수분 보충이 돼요. 간은 하지 않아요.", substituteTip: "양배추 대신 오이를 잘게 썰어 곁들여도 좋아요.",
  },
];

// ---------------------------------------------------------------------------------------------- generic (ported) builders
const clean = (names: readonly string[]): string[] => names.map((n) => n.trim()).filter(Boolean).slice(0, MAX_NAMES);
const shown = (picked: string[]) => picked.slice(0, 4).join("·") + (picked.length > 4 ? ` 외 ${picked.length - 4}가지` : "");

/** CookSaver `make_recipe`: the chosen ingredients fitted into a simple one-bowl dish. */
export function genericRecipe(names: readonly string[]): RankedRecipe | null {
  const picked = clean(names);
  if (picked.length === 0) return null;
  const main = picked.slice(0, 3);
  const minutes = Math.min(8 + 2 * picked.length, 25);
  const CONDIMENTS: [string, string][] = [["김치", "고춧가루 1숟가락"], ["두부", "진간장 1숟가락"], ["라면", "후추 약간"], ["삼겹", "소금 한 꼬집"], ["베이컨", "후추 약간"], ["대파", "참기름 0.5숟가락"], ["계란", "맛술 1숟가락"], ["참치", "마요네즈 1숟가락"]];
  const condiments = CONDIMENTS.filter(([k]) => picked.some((n) => n.includes(k))).map(([, c]) => c).slice(0, 3);
  for (const c of ["진간장 1.5숟가락", "다진마늘 0.5숟가락"]) if (condiments.length < 2 && !condiments.includes(c)) condiments.push(c);
  return {
    kind: "human", origin: "generic", matched: picked, missing: [], calories: null,
    title: `${main[0]} 한 그릇 ${minutes}분 요리`,
    subtitle: `${withRo(main.join("·"))} 만드는 마법의 한 그릇`,
    cookTime: `${minutes}분`, difficulty: picked.length <= 3 ? "초급" : "중급",
    mainIngredients: picked.slice(0, 8), condiments,
    steps: [
      `${main.join("·")}${/[가-힣]$/.test(main.join("·")) ? "을(를)" : ""} 먹기 좋은 크기로 썰어 준비해요.`,
      "달군 팬에 기름을 두르고 단단한 재료부터 중불에서 3분간 볶아요.",
      `물 또는 육수 한 컵과 ${condiments[0]}을(를) 넣고 5분간 끓여요.`,
      "간을 보고 부족하면 조미료를 조금씩 더해 마무리해요.",
    ],
    chefTip: `${main[0]}은(는) 마지막에 넣어야 식감이 살아요. 남은 국물에 밥을 비벼 드세요.`,
    substituteTip: "없는 재료는 집에 있는 비슷한 채소로 바꿔도 괜찮아요.",
  };
}

/** CookSaver `make_allkill_recipe`: use EVERYTHING chosen in one fried-rice pan. */
export function allKillRecipe(names: readonly string[]): RankedRecipe | null {
  const picked = clean(names);
  if (picked.length < 2) return null;
  return {
    kind: "human", origin: "allkill", matched: picked, missing: [], calories: null,
    title: `${picked[0]} 외 ${picked.length - 1}가지 몽땅 털이 볶음밥`.slice(0, 80),
    subtitle: `${withRo(shown(picked))} 하나도 남기지 않고 한 팬에 털어 넣는 원팬 요리`,
    cookTime: "15분", difficulty: "초급",
    mainIngredients: picked.slice(0, 12), condiments: ["진간장 1.5숟가락", "식용유 1숟가락", "다진마늘 0.5숟가락"],
    steps: [
      `${shown(picked)}${/[가-힣]$/.test(shown(picked)) ? "을(를)" : ""} 모두 한 입 크기로 잘게 썰어요. 단단한 재료는 더 작게 썰어요.`,
      "달군 팬에 식용유와 다진마늘을 넣고 단단한 재료부터 중불에서 3분 볶아요.",
      "남은 재료를 모두 넣고 5분 더 볶다가 밥 한 공기와 진간장을 넣어 섞어요.",
      "팬 바닥의 남은 재료까지 싹싹 긁어 담아 한 접시로 마무리해요.",
    ],
    chefTip: "수분이 많은 재료는 마지막에 넣고, 간장은 팬 가장자리에 둘러 넣으면 향이 살아요.",
    substituteTip: "밥이 없으면 삶은 면이나 식빵에 올려도 좋아요.",
  };
}

/** CookSaver `make_pet_recipe`: whatever is pet-safe, boiled without salt or oil and served cooled. */
export function genericPetRecipe(names: readonly string[]): RankedRecipe | null {
  const picked = clean(names).filter((n) => isPetSafe(n)).slice(0, 6);
  if (picked.length === 0) return null;
  const s = shown(picked);
  return {
    kind: "pet", origin: "pet-generic", matched: picked, missing: [], calories: null,
    title: `${picked[0]} 수제 화식 삶음 20분`.slice(0, 80),
    subtitle: `${s}${/[가-힣]$/.test(s) ? "으로" : "로"} 소금·기름 없이 삶아 만든 댕냥이 자연식`.slice(0, 120),
    cookTime: "20분", difficulty: "초급", mainIngredients: picked, condiments: [],
    steps: [
      `${eulReul(s)} 깨끗이 씻고 껍질·씨·뼈를 제거해요.`,
      "냄비에 재료가 잠길 만큼 물을 붓고 소금·기름 없이 15분간 푹 삶거나 쪄요.",
      "건져서 알맞은 크기로 으깨거나 잘게 다져요. (고양이는 더 곱게, 강아지는 한 입 크기)",
      "충분히 식혀서 미지근할 때 급여해요. 처음에는 소량부터 주고 남은 것은 냉장 2일 안에 먹이세요.",
    ],
    chefTip: "사람 음식처럼 간을 하지 마세요. 염분 0%가 기본이고, 삶은 물은 식혀서 국물로 섞어 줘도 좋아요.",
    substituteTip: "닭가슴살 대신 소고기 살코기나 두부로 바꿔도 좋아요.",
  };
}

// ---------------------------------------------------------------------------------------------- ranking
const asRanked = (t: Template, kind: "human" | "pet", names: readonly string[]): RankedRecipe & { score: number } => {
  const matched = t.needs.filter((n) => hasIngredient(names, n));
  return {
    ...t, kind, mainIngredients: [...t.needs, ...(t.staples ?? [])], origin: "template",
    matched: names.filter((n) => t.needs.some((need) => hasIngredient([n], need))),
    missing: t.needs.filter((n) => !matched.includes(n)),
    score: matched.length,
    steps: [...t.steps],
  };
};

/**
 * Offline recipes for the fridge: named dishes ranked by how many of their key ingredients are in the fridge (more first,
 * then the higher share, then catalogue order), topped up with the generic "fit everything in" recipes. Never empty for a
 * non-empty ingredient list.
 */
export function fallbackRecipes(names: readonly string[], limit = 3): RankedRecipe[] {
  const list = clean(names);
  if (list.length === 0 || limit <= 0) return [];
  const ranked = HUMAN_TEMPLATES.map((t, i) => ({ r: asRanked(t, "human", list), i }))
    .filter(({ r }) => r.score > 0)
    .sort((a, b) => b.r.score - a.r.score || b.r.score / b.r.mainIngredients.length - a.r.score / a.r.mainIngredients.length || a.i - b.i)
    .map(({ r }) => r);
  const out: RankedRecipe[] = ranked.slice(0, limit).map(({ score: _s, ...r }) => r);
  for (const extra of [genericRecipe(list), allKillRecipe(list)]) if (extra && out.length < limit) out.push(extra);
  return out;
}

/**
 * Pet specials: only PET_SAFE ingredients are considered. Templates ranked like the human ones; with nothing usable the
 * catalogue is shown as a shopping idea (all of its ingredients "missing"). Never contains a toxic ingredient.
 */
export function petFallbackRecipes(names: readonly string[], limit = 3): RankedRecipe[] {
  const safe = clean(names).filter((n) => isPetSafe(n));
  if (limit <= 0) return [];
  const ranked = PET_TEMPLATES.map((t, i) => ({ r: asRanked(t, "pet", safe), i }))
    .filter(({ r }) => r.score > 0)
    .sort((a, b) => b.r.score - a.r.score || b.r.score / b.r.mainIngredients.length - a.r.score / a.r.mainIngredients.length || a.i - b.i)
    .map(({ r }) => r);
  const out: RankedRecipe[] = ranked.slice(0, limit).map(({ score: _s, ...r }) => r);
  const generic = genericPetRecipe(safe);
  if (generic && out.length < limit) out.push(generic);
  if (out.length === 0) return PET_TEMPLATES.slice(0, Math.min(limit, 2)).map((t) => { const { score: _s, ...r } = asRanked(t, "pet", []); return r; });
  return out;
}

// ---------------------------------------------------------------------------------------------- recipe <-> kitchen items
/** The kitchen items a recipe uses (its main ingredients found by name) — what "소진 처리" will use up. */
export function itemsUsedBy<T extends { name: string }>(recipe: Pick<Recipe, "mainIngredients">, items: readonly T[]): T[] {
  return items.filter((it) => recipe.mainIngredients.some((ing) => hasIngredient([it.name], ing)));
}

// ---------------------------------------------------------------------------------------------- pet safety gate (also used on AI output)
const SEASONING_WORDS = ["소금", "간장", "된장", "고추장", "고춧가루", "설탕", "기름", "식용유", "참기름", "들기름", "소스", "케첩", "마요", "후추", "양념", "맛술", "국간장", "굴소스"];

/** A pet recipe is acceptable only if nothing toxic appears anywhere and no seasoning/oil is called for. */
export function petRecipeProblems(r: Pick<Recipe, "title" | "subtitle" | "mainIngredients" | "condiments" | "steps" | "chefTip" | "substituteTip">): string[] {
  const problems: string[] = [];
  const all = [r.title, r.subtitle, ...r.mainIngredients, ...r.steps, r.chefTip, r.substituteTip];
  for (const t of all) if (isPetToxic(t)) problems.push(`독성 재료: ${PET_TOXIC.find((w) => squash(t).includes(w))}`);
  if (r.condiments.length > 0) problems.push("양념이 포함돼 있어요");
  // "소금 없이", "기름 없이" are fine; a seasoning word is a problem only when not negated within the same sentence
  for (const s of [...r.steps, r.chefTip]) {
    for (const w of SEASONING_WORDS) if (s.includes(w) && !/(없이|넣지|하지 마|금지|빼고|안 넣|않)/.test(s)) problems.push(`양념/기름: ${w}`);
  }
  if (!r.steps.some((s) => /삶|찌|쪄/.test(s))) problems.push("삶기/찌기 조리법이 아니에요");
  if (!/식혀|식힌|미지근/.test(r.steps[r.steps.length - 1] ?? "")) problems.push("식혀서 급여하라는 안내가 없어요");
  return problems;
}
