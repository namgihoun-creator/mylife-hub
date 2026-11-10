import type { Metadata, Viewport } from "next";
import { Noto_Sans_KR } from "next/font/google";
import { Providers } from "@/shared/components/providers";
import "./globals.css";

const notoSansKr = Noto_Sans_KR({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: { default: "MyLife Hub", template: "%s · MyLife Hub" },
  description: "개인·가족 통합 생활 OS — 입력은 최소로, 기억하고 연결하고 관리합니다.",
  applicationName: "MyLife Hub",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={notoSansKr.variable}>
      <body className="min-h-screen font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
