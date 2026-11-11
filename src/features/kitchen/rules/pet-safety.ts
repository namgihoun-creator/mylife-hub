// Pet food safety (CookSaver `bulk.PET_TOXIC` / `PET_SAFE`): substring match on the ingredient name with whitespace
// ignored. TOXIC always wins over SAFE. This is a quick household hint, NOT veterinary advice.

/** Foods that are dangerous for dogs and/or cats (allium family, grapes, chocolate/cocoa, avocado, xylitol, macadamia, caffeine, alcohol). */
export const PET_TOXIC = [
  "양파", "대파", "쪽파", "파뿌리", "마늘", "부추", "포도", "건포도", "초콜릿", "초콜렛", "코코아", "아보카도", "자일리톨", "마카다미아", "커피", "술", "맥주", "와인",
] as const;
/** Plain ingredients that can be cooked for a pet without salt or oil. */
export const PET_SAFE = ["닭가슴살", "소고기", "당근", "단호박", "브로콜리", "양배추", "두부", "계란", "달걀", "고구마", "오이"] as const;
/** An opened pet treat / can should be finished within 48 hours (D-2). */
export const PET_TREAT_DAYS = 2;

export type PetSafety = "toxic" | "safe" | "unknown";

const squash = (name: unknown) => String(name ?? "").replace(/\s+/g, "");

export function isPetToxic(name: unknown): boolean {
  const text = squash(name);
  return PET_TOXIC.some((w) => text.includes(w));
}

/** Safe only if not toxic AND a safe word is present ('양파 닭가슴살 볶음' is NOT safe). */
export function isPetSafe(name: unknown): boolean {
  const text = squash(name);
  return text.length > 0 && !isPetToxic(text) && PET_SAFE.some((w) => text.includes(w));
}

export function petSafety(name: unknown): PetSafety {
  return isPetToxic(name) ? "toxic" : isPetSafe(name) ? "safe" : "unknown";
}

/** The first toxic word found (for the warning text: "양파는 반려동물에게 위험해요"); null when none. */
export function toxicMatch(name: unknown): string | null {
  const text = squash(name);
  return PET_TOXIC.find((w) => text.includes(w)) ?? null;
}
