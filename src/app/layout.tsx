import type { Metadata, Viewport } from "next";
import { Noto_Sans_KR } from "next/font/google";
import { Providers } from "@/shared/components/providers";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, shareMetadata, siteUrl } from "@/shared/lib/seo";
import "./globals.css";

const notoSansKr = Noto_Sans_KR({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
  variable: "--font-sans",
});

export const metadata: Metadata = {
  metadataBase: siteUrl(), // NEXT_PUBLIC_APP_URL || APP_BASE_URL || production URL
  title: { default: SITE_TITLE, template: "%s · MyLife Hub" },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  manifest: "/manifest.json",
  // Icons come from the app/ file conventions: favicon.ico, icon.png, apple-icon.png.
  ...shareMetadata(SITE_TITLE, SITE_DESCRIPTION, { withImage: false }),
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={notoSansKr.variable} suppressHydrationWarning>
      <body className="min-h-screen font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
