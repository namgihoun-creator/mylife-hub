import type { Metadata } from "next";

export const SITE_NAME = "MyLife Hub";
export const SITE_TITLE = "MyLife Hub - 가전·렌탈 능동형 라이프 매니저";
export const SITE_DESCRIPTION = "렌탈 약정 만료 추적, 3-Way 비용 비교, 소모품 최저가 검색, 가계 지출 리포트까지 한 번에 관리하는 스마트 가전 허브";
const CARD_ALT = "MyLife Hub — 스마트 가전·렌탈 통합 관리 플랫폼";
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
