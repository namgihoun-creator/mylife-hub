import type { Metadata } from "next";

export const SITE_NAME = "MyLife Hub";
export const SITE_TITLE = "MyLife Hub × CookSaver · 우리 집 스마트 키친 & 가전 케어 OS";
export const SITE_DESCRIPTION = "냉장고 식재료 유통기한 관리, AI 셰프 맞춤 레시피, 식비 머니로그부터 가전 케어까지 한눈에.";
const CARD_ALT = "MyLife Hub × CookSaver — 우리 집 스마트 키친 & 가전 케어 OS";
export const DEFAULT_SITE_URL = "https://mylife-hub-vert.vercel.app";

/** Canonical origin for absolute OpenGraph/Twitter URLs (NEXT_PUBLIC_APP_URL, then APP_BASE_URL, then production). */
export function siteUrl(): URL {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.APP_BASE_URL?.trim() || DEFAULT_SITE_URL;
  try {
    return new URL(raw);
  } catch {
    return new URL(DEFAULT_SITE_URL);
  }
}

/**
 * openGraph + twitter blocks for a page. Next replaces nested metadata objects instead of merging them, so every page
 * that customises its share card repeats siteName/locale/type here; the card image comes from the root
 * `opengraph-image.png` / `twitter-image.png` file conventions.
 */
export function shareMetadata(title: string, description: string, opts: { withImage?: boolean } = {}): Pick<Metadata, "openGraph" | "twitter"> {
  // Pages that replace the root's openGraph block also lose its file-based image, so they name the same card explicitly.
  // (The root layout passes withImage:false and lets the opengraph-image / twitter-image files supply it.)
  const withImage = opts.withImage ?? true;
  return {
    openGraph: {
      title,
      description,
      type: "website",
      siteName: SITE_NAME,
      locale: "ko_KR",
      ...(withImage && { images: [{ url: "/opengraph-image.png", width: 1200, height: 630, alt: CARD_ALT }] }),
    },
    twitter: { card: "summary_large_image", title, description, ...(withImage && { images: [{ url: "/twitter-image.png", width: 1200, height: 630, alt: CARD_ALT }] }) },
  };
}
