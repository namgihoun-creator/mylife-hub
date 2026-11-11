// Which appliance assets are refrigerators / freezers (they get a "what's inside" chip linking to /kitchen). Pure; no alias imports.

/** category exactly '냉장고', or a name containing 냉장고 / 냉동고 (김치냉장고 contains 냉장고). Spaces are ignored. */
export function isFridgeAsset(asset: { name?: string | null; category?: string | null }): boolean {
  const category = (asset.category ?? "").replace(/\s+/g, "");
  const name = (asset.name ?? "").replace(/\s+/g, "");
  return category === "냉장고" || /냉장고|냉동고/.test(name) || /냉장고|냉동고/.test(category);
}

export type FridgeStock = { total: number; urgent: number };

/** '보관 12개' / '보관 12개 (임박 3개)'. */
export function fridgeChipLabel(stock: FridgeStock): string {
  return stock.urgent > 0 ? `보관 ${stock.total}개 (임박 ${stock.urgent}개)` : `보관 ${stock.total}개`;
}
