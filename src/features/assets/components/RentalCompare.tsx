"use client";

import { useMemo, useState } from "react";
import { ExternalLink, Info, RotateCcw, SlidersHorizontal, Wallet, RefreshCcw, ShoppingCart, type LucideIcon } from "lucide-react";
import { Collapse } from "@/shared/components/ui/collapse";
import { cn } from "@/shared/lib/utils";
import type { Asset } from "../schemas/asset.schema";
import { danawaSearchUrl, naverShoppingSearchUrl } from "../utils/compare-links";
import { HORIZON_MONTHS, computeComparison, defaultAssumptions, type CompareAssumptions, type OptionKey } from "../utils/rental-compare";
import { formatWon } from "../utils/rental";

const LABEL = "text-xs font-normal text-slate-500 dark:text-zinc-400";

const OPTION_META: Record<OptionKey, { title: string; icon: LucideIcon; tone: string }> = {
  keep: {
    title: "현재 유지",
    icon: Wallet,
    tone: "bg-violet-50 text-violet-500 ring-1 ring-inset ring-violet-100 dark:bg-violet-950/40 dark:text-violet-400 dark:ring-violet-900/50",
  },
  switch: {
    title: "신규 렌탈 환승",
    icon: RefreshCcw,
    tone: "bg-sky-50 text-sky-500 ring-1 ring-inset ring-sky-100 dark:bg-sky-950/40 dark:text-sky-400 dark:ring-sky-900/50",
  },
  buy: {
    title: "자가 구매",
    icon: ShoppingCart,
    tone: "bg-amber-50 text-amber-500 ring-1 ring-inset ring-amber-100 dark:bg-amber-950/40 dark:text-amber-400 dark:ring-amber-900/50",
  },
};

type Field = { key: keyof CompareAssumptions; label: string; hint?: string };
const FIELDS: Field[] = [
  { key: "newRentalFee", label: "신규 렌탈 월 요금 (원)" },
  { key: "transferIncentive", label: "환승 지원금 (원)", hint: "통상 20~30만 원" },
  { key: "penalty", label: "위약금 (원)", hint: "약정 중 해지할 때만" },
  { key: "purchasePrice", label: "구매가 (원)" },
  { key: "yearlyCare", label: "연 소모품비 (원)", hint: "필터 등 셀프 관리" },
];

const diffText = (delta: number | null) =>
  delta === null || delta === 0 ? null : delta > 0 ? `현재 유지보다 ${formatWon(delta)} 적게 들어요` : `현재 유지보다 ${formatWon(-delta)} 더 들어요`;

export function RentalCompare({ asset, today, canEdit, onEdit }: { asset: Asset; today: string; canEdit: boolean; onEdit: () => void }) {
  const defaults = useMemo(() => defaultAssumptions(asset.preset_key), [asset.preset_key]);
  const [values, setValues] = useState<Record<keyof CompareAssumptions, string>>(() =>
    Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, String(v)])) as Record<keyof CompareAssumptions, string>,
  );
  const [adjusting, setAdjusting] = useState(false);

  const assumptions: CompareAssumptions = useMemo(
    () => Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v === "" ? 0 : Number(v)])) as CompareAssumptions,
    [values],
  );

  const result = useMemo(
    () =>
      computeComparison({
        monthlyFee: asset.monthly_fee,
        obligationEndDate: asset.obligation_end_date,
        ownershipTransferDate: asset.ownership_transfer_date,
        today,
        assumptions,
      }),
    [asset.monthly_fee, asset.obligation_end_date, asset.ownership_transfer_date, today, assumptions],
  );

  const order: OptionKey[] = ["keep", "switch", "buy"];
  const max = Math.max(...order.map((k) => result.totals[k] ?? 0), 1);
  const cheapestTitle = OPTION_META[result.cheapest].title;
  const runnerUp = result.closeCall;
  const isDefault = (Object.keys(defaults) as (keyof CompareAssumptions)[]).every((k) => Number(values[k] || 0) === defaults[k]);

  const detail = (key: OptionKey): string => {
    if (key === "keep") {
      if (!result.keep.available) return "월 렌탈료를 입력하면 계산돼요";
      const parts = [`${formatWon(asset.monthly_fee!)} × ${result.keep.payingMonths}개월`];
      if (result.keep.transferMonths !== null && result.keep.transferMonths < HORIZON_MONTHS) parts.push("소유권 이전 후에는 렌탈료가 없어요");
      return parts.join(" · ");
    }
    if (key === "switch") {
      const s = result.switch;
      return `${formatWon(s.rentalTotal)} − 지원금 ${formatWon(s.incentive)}${s.penalty ? ` + 위약금 ${formatWon(s.penalty)}` : ""}`;
    }
    const b = result.buy;
    return `구매 ${formatWon(b.purchase)} + 소모품 ${formatWon(b.care)}${b.penalty ? ` + 위약금 ${formatWon(b.penalty)}` : ""}`;
  };

  return (
    <div className="space-y-4" data-testid="rental-compare">
      <p className="flex gap-2 rounded-lg bg-amber-50 p-3 text-[11px] font-normal leading-relaxed text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          아래는 <b>추정치</b>예요. 신규 렌탈 요금·지원금·구매가는 가정값이라 실제 조건과 다를 수 있어요. 가정값을 직접 고쳐 보고, 최신 조건은 아래 링크에서 확인하세요.
        </span>
      </p>

      <div
        data-testid="compare-summary"
        className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 dark:border-emerald-900 dark:bg-emerald-950/20"
      >
        <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
          {runnerUp ? "비용 차이가 크지 않아요" : `추천: ${cheapestTitle}`}
        </p>
        <p className="mt-0.5 text-[11px] font-normal text-emerald-700/80 dark:text-emerald-400/80">
          {runnerUp
            ? `3년 기준으로 ${cheapestTitle}이(가) 가장 낮지만 차이가 5% 이내예요. 케어 방식과 편의로 고르세요.`
            : `${HORIZON_MONTHS}개월(3년) 총 부담이 가장 적어요${asset.care_type === "VISIT" && result.cheapest === "buy" ? " · 단, 방문 케어는 사라져요" : ""}.`}
        </p>
      </div>

      <ul className="space-y-2.5">
        {order.map((key) => {
          const total = result.totals[key];
          const meta = OPTION_META[key];
          const Icon = meta.icon;
          const best = key === result.cheapest;
          return (
            <li
              key={key}
              data-testid={`compare-${key}`}
              className={cn(
                "rounded-xl border bg-white p-3.5 dark:bg-zinc-950",
                best ? "border-emerald-300 ring-1 ring-emerald-200 dark:border-emerald-800 dark:ring-emerald-900/50" : "border-zinc-200 dark:border-zinc-800",
              )}
            >
              <div className="flex items-center gap-3">
                <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", meta.tone)}>
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-zinc-50">
                    {meta.title}
                    {best && (
                      <span data-testid="compare-recommended" className="rounded-full bg-emerald-500 px-1.5 py-px text-[10px] font-bold text-white">
                        추천
                      </span>
                    )}
                  </p>
                  <p className="truncate text-[11px] font-normal text-slate-500 dark:text-zinc-400">{detail(key)}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p data-testid={`compare-${key}-total`} className="text-lg font-extrabold tracking-tight tabular-nums text-slate-900 dark:text-zinc-50">
                    {total === null ? "—" : formatWon(total)}
                  </p>
                  {total !== null && (
                    <p className="text-[11px] font-normal tabular-nums text-slate-500 dark:text-zinc-400">월 평균 {formatWon(Math.round(total / HORIZON_MONTHS))}</p>
                  )}
                </div>
              </div>

              {total !== null && (
                <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-zinc-800">
                  <div
                    className={cn("h-full rounded-full transition-[width] duration-500", best ? "bg-emerald-500" : "bg-slate-300 dark:bg-zinc-600")}
                    style={{ width: `${Math.max(3, Math.round((total / max) * 100))}%` }}
                  />
                </div>
              )}

              {key === "keep" && result.keep.available && (result.keep.obligationMonths !== null || result.keep.transferMonths !== null) && (
                <p className="mt-2 text-[11px] font-normal leading-relaxed tabular-nums text-slate-500 dark:text-zinc-400">
                  {result.keep.obligationMonths !== null && (
                    <span data-testid="compare-obligation-line" className="block">
                      잔여 의무 {result.keep.obligationMonths}개월 × {formatWon(asset.monthly_fee!)} = {formatWon(result.keep.obligationTotal ?? 0)}
                    </span>
                  )}
                  {result.keep.transferMonths !== null && (
                    <span className="block">
                      소유권 이전까지 {result.keep.transferMonths}개월 × {formatWon(asset.monthly_fee!)} = {formatWon(result.keep.transferTotal ?? 0)}
                    </span>
                  )}
                </p>
              )}
              {key === "keep" && !result.keep.available && canEdit && (
                <button type="button" onClick={onEdit} className="mt-2 text-[11px] font-medium text-violet-600 underline underline-offset-2 dark:text-violet-400">
                  월 렌탈료 입력하러 가기
                </button>
              )}
              {key !== "keep" && diffText(result.savingsVsKeep[key]) && (
                <p className="mt-2 text-[11px] font-medium text-slate-600 dark:text-zinc-300">{diffText(result.savingsVsKeep[key])}</p>
              )}
            </li>
          );
        })}
      </ul>

      <div className="space-y-2">
        <button
          type="button"
          aria-expanded={adjusting}
          onClick={() => setAdjusting((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-200 dark:text-zinc-300 dark:hover:bg-zinc-800 bg-slate-100 dark:bg-zinc-800"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          가정값 조정
        </button>
        <Collapse open={adjusting}>
          <div className="mt-1 grid grid-cols-1 gap-3 rounded-2xl bg-slate-50/60 p-3.5 sm:grid-cols-2 dark:bg-zinc-800/60">
            {FIELDS.map((f) => (
              <div key={f.key} className="space-y-1">
                <label htmlFor={`assume-${f.key}`} className="text-xs font-medium text-slate-700 dark:text-zinc-300">
                  {f.label}
                </label>
                <input
                  id={`assume-${f.key}`}
                  inputMode="numeric"
                  value={values[f.key]}
                  onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value.replace(/\D/g, "").slice(0, 9) }))}
                  className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                {f.hint && <p className={LABEL}>{f.hint}</p>}
              </div>
            ))}
            <button
              type="button"
              disabled={isDefault}
              onClick={() => setValues(Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, String(v)])) as Record<keyof CompareAssumptions, string>)}
              className="inline-flex items-center gap-1 self-end justify-self-start text-xs font-medium text-slate-500 hover:text-slate-900 disabled:opacity-40 dark:text-zinc-400 dark:hover:text-zinc-50 sm:col-span-2"
            >
              <RotateCcw className="h-3 w-3" />
              기본값으로
            </button>
          </div>
        </Collapse>
      </div>

      <div className="space-y-2 border-t border-slate-100 pt-3 dark:border-zinc-800">
        <a
          href={danawaSearchUrl(asset.name)}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="compare-link-danawa"
          className="flex h-11 w-full items-center justify-center gap-1.5 rounded-lg bg-sky-600 text-sm font-semibold text-white transition-colors hover:bg-sky-700 dark:bg-sky-500 dark:text-white dark:hover:bg-sky-400"
        >
          최신 모델 렌탈 조건 비교하기
          <ExternalLink className="h-4 w-4" />
        </a>
        <a
          href={naverShoppingSearchUrl(asset.name)}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="compare-link-naver"
          className="flex h-9 w-full items-center justify-center gap-1.5 rounded-xl text-xs font-medium text-slate-600 transition-colors hover:bg-slate-200 dark:text-zinc-300 dark:hover:bg-zinc-800 bg-slate-100 dark:bg-zinc-800"
        >
          네이버 쇼핑에서도 찾아보기
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
        <p className="text-center text-[11px] font-normal text-slate-400 dark:text-zinc-500">다나와 · 네이버 쇼핑 검색 결과로 이동해요 (새 탭)</p>
      </div>
    </div>
  );
}
