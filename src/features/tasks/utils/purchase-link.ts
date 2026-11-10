/** Smart purchase links for consumables (pure, shared by server and client). */

export const MAX_QUERY_LENGTH = 100;

export type ConsumableInfo = {
  consumable_name?: string | null;
  consumable_model?: string | null;
  custom_purchase_url?: string | null;
};

export type PurchaseLinkInput = ConsumableInfo & {
  /** assets.model_name — the appliance's own model, used to make the search specific. */
  assetModelName?: string | null;
};

export type PurchaseLinks = {
  /** "custom" = user-provided URL, "search" = generated price-comparison search. */
  kind: "custom" | "search";
  /** The link the main [소모품 구매 ↗] button opens. */
  primary: string;
  /** Search query used (only for kind "search"). */
  query: string | null;
  /** Extra shopping sites for the auto-search case (empty for a custom URL). */
  alternatives: { label: string; url: string }[];
};

const clean = (v: string | null | undefined) => (v ?? "").replace(/\s+/g, " ").trim();

/** Returns the URL only for well-formed http(s) addresses (rejects javascript:, data:, relative paths, …). */
export function safeHttpUrl(raw: string | null | undefined): string | null {
  const v = clean(raw);
  if (!v || v.length > 2048 || /\s/.test(v)) return null;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export const hasConsumable = (c: ConsumableInfo) => !!(clean(c.consumable_name) || clean(c.consumable_model) || safeHttpUrl(c.custom_purchase_url));

/** "<asset model> <consumable name> <consumable model>", de-duplicated (case-insensitive) and capped. */
export function buildSearchQuery(input: PurchaseLinkInput): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const p of [input.assetModelName, input.consumable_name, input.consumable_model]) {
    const v = clean(p);
    if (!v || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase());
    parts.push(v);
  }
  return parts.join(" ").slice(0, MAX_QUERY_LENGTH).trim();
}

export const naverShoppingUrl = (query: string) => `https://search.shopping.naver.com/search/all?query=${encodeURIComponent(query)}`;
export const danawaUrl = (query: string) => `https://search.danawa.com/dsearch.php?query=${encodeURIComponent(query)}`;

/**
 * custom_purchase_url (valid http/https) wins; otherwise a Naver Shopping / Danawa search built from
 * asset model + consumable name/model. Returns null when there is nothing to search for
 * (no consumable name or model — the asset model alone is not a consumable).
 */
export function getPurchaseLinks(input: PurchaseLinkInput): PurchaseLinks | null {
  const custom = safeHttpUrl(input.custom_purchase_url);
  if (custom) return { kind: "custom", primary: custom, query: null, alternatives: [] };

  if (!clean(input.consumable_name) && !clean(input.consumable_model)) return null;
  const query = buildSearchQuery(input);
  if (!query) return null;
  return {
    kind: "search",
    primary: naverShoppingUrl(query),
    query,
    alternatives: [{ label: "다나와", url: danawaUrl(query) }],
  };
}

/** What the copy button puts on the clipboard: the model number if known, else the consumable name. */
export const copyableSpec = (c: ConsumableInfo): string | null => clean(c.consumable_model) || clean(c.consumable_name) || null;
