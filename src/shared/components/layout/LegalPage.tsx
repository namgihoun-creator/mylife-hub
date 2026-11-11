import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/** Plain reading layout for the privacy policy / terms (public pages, no app shell). */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 dark:bg-zinc-950">
      <article className="mx-auto w-full max-w-2xl space-y-6 rounded-3xl bg-white p-6 shadow-sm dark:bg-zinc-900 sm:p-8">
        <Link href="/assets" className="inline-flex min-h-10 items-center gap-1.5 text-sm font-bold text-sky-600 hover:text-sky-700 dark:text-sky-400">
          <ArrowLeft className="h-4 w-4" aria-hidden /> 앱으로 돌아가기
        </Link>
        <header className="space-y-1">
          <h1 data-testid="legal-title" className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-zinc-50">{title}</h1>
          <p className="text-xs font-medium text-slate-400 dark:text-zinc-500">시행일 {updated} · 서비스 개선에 따라 바뀔 수 있어요.</p>
        </header>
        <div className="space-y-5 text-sm leading-relaxed text-slate-600 dark:text-zinc-300 [&_h2]:text-base [&_h2]:font-extrabold [&_h2]:text-slate-900 dark:[&_h2]:text-zinc-50 [&_li]:ml-4 [&_li]:list-disc [&_ul]:space-y-1">{children}</div>
      </article>
    </main>
  );
}
