/**
 * Outbound price-comparison searches. Base URLs are fixed; the only variable part is the search keyword and it is
 * always passed through encodeURIComponent, so asset names can never alter the host, path or extra parameters.
 */
export function comparisonKeyword(assetName: string): string {
  // "정수기 (거실)" -> "정수기", capped so an overlong name cannot produce a huge URL.
  const base = assetName.replace(/\(.*?\)|\[.*?\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 30);
  return `${base || assetName.slice(0, 30)} 렌탈`;
}

export function danawaSearchUrl(assetName: string): string {
  return `https://search.danawa.com/dsearch.php?query=${encodeURIComponent(comparisonKeyword(assetName))}`;
}

export function naverShoppingSearchUrl(assetName: string): string {
  return `https://search.shopping.naver.com/search/all?query=${encodeURIComponent(comparisonKeyword(assetName))}`;
}
