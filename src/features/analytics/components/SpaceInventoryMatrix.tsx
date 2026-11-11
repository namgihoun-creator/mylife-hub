"use client";

import { useState } from "react";
import { cn } from "@/shared/lib/utils";
import type { Distribution, DistributionRow } from "../utils/analytics-calculator";
import { ReportEmpty, ReportSection } from "./ReportSection";

type Mode = "space" | "category";

function StackBar({ owned, rental, label }: { owned: number; rental: number; label: string }) {
  const total = owned + rental;
  return (
    <div role="img" aria-label={label} className="flex h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-900">
      {owned > 0 && <div data-seg="owned" className="bg-zinc-900 dark:bg-zinc-100" style={{ width: `${(owned / total) * 100}%` }} />}
      {rental > 0 && <div data-seg="rental" className="bg-violet-500 dark:bg-violet-400" style={{ width: `${(rental / total) * 100}%` }} />}
    </div>
  );
}

function Row({ row }: { row: DistributionRow }) {
  return (
    <li data-testid="matrix-row" data-key={row.key} className="space-y-1.5 py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">{row.key}</p>
        <p className="shrink-0 text-xs font-normal tabular-nums text-zinc-500 dark:text-zinc-400">
          <span className="font-semibold text-zinc-900 dark:text-zinc-50">{row.total}개</span> · 자가 {row.owned} · 렌탈 {row.rental}
        </p>
      </div>
      <StackBar owned={row.owned} rental={row.rental} label={`${row.key}: 자가 ${row.owned}개, 렌탈 ${row.rental}개`} />
    </li>
  );
}

const TAB = "h-8 rounded-lg border px-3 text-xs font-medium transition-colors";

/** Where the appliances are (by space / category) and how much of each is rented. */
export function SpaceInventoryMatrix({ distribution }: { distribution: Distribution }) {
  const [mode, setMode] = useState<Mode>("space");
  const rows = mode === "space" ? distribution.bySpace : distribution.byCategory;

  return (
    <ReportSection
      testId="space-matrix"
      title="가전 현황"
      description="자가 / 렌탈 비율을 한눈에 확인해요."
      action={
        <div role="radiogroup" aria-label="분류 기준" className="flex shrink-0 gap-1.5">
          {(["space", "category"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={cn(
                TAB,
                mode === m
                  ? "border-zinc-900 text-zinc-900 ring-1 ring-zinc-900 dark:border-zinc-100 dark:text-zinc-50 dark:ring-zinc-100"
                  : "border-zinc-200 text-zinc-500 hover:border-zinc-300 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-700",
              )}
            >
              {m === "space" ? "공간별" : "카테고리별"}
            </button>
          ))}
        </div>
      }
    >
      {distribution.total === 0 ? (
        <ReportEmpty testId="matrix-empty">등록된 가전이 없어요.</ReportEmpty>
      ) : (
        <div className="space-y-4">
          <div data-testid="ownership-share" className="space-y-1.5 rounded-xl p-3 bg-slate-100 dark:bg-zinc-800">
            <div className="flex items-baseline justify-between text-xs font-normal text-zinc-500 dark:text-zinc-400">
              <span>전체 {distribution.total}개 · 소유 형태</span>
              <span className="tabular-nums">
                자가 {distribution.owned} · 렌탈 {distribution.rental} ({distribution.rentalPct}%)
              </span>
            </div>
            <StackBar owned={distribution.owned} rental={distribution.rental} label={`전체: 자가 ${distribution.owned}개, 렌탈 ${distribution.rental}개`} />
          </div>
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {rows.map((r) => (
              <Row key={r.key} row={r} />
            ))}
          </ul>
          <div className="flex gap-4 text-[11px] font-normal text-zinc-500 dark:text-zinc-400">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-zinc-900 dark:bg-zinc-100" aria-hidden />
              자가
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-violet-500 dark:bg-violet-400" aria-hidden />
              렌탈·구독
            </span>
          </div>
        </div>
      )}
    </ReportSection>
  );
}
