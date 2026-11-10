"use client";

import { useEffect, useState } from "react";
import { ChevronRight, Pencil } from "lucide-react";
import { DDayBadge } from "@/shared/components/ui/dday-badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/components/ui/dialog";
import { getApplianceVisual } from "@/shared/lib/appliance-icons";
import { formatRecurrence } from "@/shared/lib/recurrence";
import { cn } from "@/shared/lib/utils";
import { CARE_LABEL, type Asset } from "../schemas/asset.schema";
import { contractProgress, formatDotDate, formatWon, isRentalAsset, obligationInfo } from "../utils/rental";
import { AssetEditModal } from "./AssetEditModal";
import { RentalBadge } from "./RentalBadge";
import { RentalCompare } from "./RentalCompare";

const LABEL = "text-xs font-normal text-slate-500 dark:text-zinc-400";
const VALUE = "text-sm font-medium text-slate-900 dark:text-zinc-50";

function RentalInfo({ asset, today }: { asset: Asset; today: string }) {
  const info = obligationInfo(asset.obligation_end_date, today);
  const progress = contractProgress(asset.contract_start_date, asset.obligation_end_date, today);

  return (
    <section
      aria-label="렌탈 정보"
      className="space-y-4 rounded-2xl border border-violet-200/70 bg-violet-50/40 p-4 dark:border-violet-900/50 dark:bg-violet-950/20"
    >
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className={LABEL}>월 렌탈료</p>
          <p data-testid="rental-fee" className="text-2xl font-extrabold tracking-tight tabular-nums text-slate-900 dark:text-zinc-50">
            {asset.monthly_fee != null ? formatWon(asset.monthly_fee) : "미입력"}
          </p>
        </div>
        {asset.billing_day != null && (
          <p className="rounded-full bg-white/70 px-2.5 py-1 text-xs font-medium text-slate-600 ring-1 ring-inset ring-violet-200/70 dark:bg-zinc-900/50 dark:text-zinc-300 dark:ring-violet-900/50">
            매월 {asset.billing_day}일 결제
          </p>
        )}
      </div>

      <div className="space-y-2 border-t border-violet-200/60 pt-3 dark:border-violet-900/40">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className={LABEL}>의무 약정</p>
            <p data-testid="rental-obligation" className="text-sm font-semibold text-slate-900 dark:text-zinc-50">
              {info.text}
            </p>
            {asset.obligation_end_date && (
              <p className="text-[11px] font-normal tabular-nums text-slate-500 dark:text-zinc-400">
                {formatDotDate(asset.obligation_end_date)} 만료 · 이후 위약금 없이 해지할 수 있어요
              </p>
            )}
          </div>
          {asset.obligation_end_date && <DDayBadge dueDate={asset.obligation_end_date} today={today} size="lg" className="shrink-0" />}
        </div>

        {progress !== null && (
          <div className="space-y-1">
            <div
              role="progressbar"
              aria-label="계약 진행률"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              className="h-1.5 w-full overflow-hidden rounded-full bg-violet-100 dark:bg-zinc-800"
            >
              <div className="h-full rounded-full bg-violet-500 transition-[width] duration-500" style={{ width: `${progress}%` }} />
            </div>
            <p className="text-right text-[11px] font-normal tabular-nums text-slate-500 dark:text-zinc-400">계약 진행률 {progress}%</p>
          </div>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-violet-200/60 pt-3 dark:border-violet-900/40">
        <div>
          <dt className={LABEL}>케어 방식</dt>
          <dd className={VALUE}>{CARE_LABEL[asset.care_type ?? "NONE"]}</dd>
        </div>
        {asset.contract_start_date && (
          <div>
            <dt className={LABEL}>계약 시작일</dt>
            <dd className={cn(VALUE, "tabular-nums")}>{formatDotDate(asset.contract_start_date)}</dd>
          </div>
        )}
        {asset.ownership_transfer_date && (
          <div>
            <dt className={LABEL}>소유권 이전 만료일</dt>
            <dd className={cn(VALUE, "tabular-nums")}>{formatDotDate(asset.ownership_transfer_date)}</dd>
          </div>
        )}
        {asset.payment_card_note && (
          <div className="col-span-2">
            <dt className={LABEL}>제휴카드 메모</dt>
            <dd className={VALUE}>{asset.payment_card_note}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}

/** Asset detail: basics, rental info card + 환승/비용 비교 tab for rentals, and the management rules. */
export function AssetDetailDialog({
  asset,
  today,
  canEdit = false,
  deepLinkTab,
}: {
  asset: Asset;
  today: string;
  canEdit?: boolean;
  /** Set while a notification deep link targets this asset: open now, on this tab (compare only exists for rentals). */
  deepLinkTab?: "info" | "compare";
}) {
  const { icon: Icon, tone } = getApplianceVisual(asset.preset_key);
  const rental = isRentalAsset(asset);
  const [open, setOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [tab, setTab] = useState<"info" | "compare">("info");

  useEffect(() => {
    if (!deepLinkTab) return;
    setOpen(true);
    setEditOpen(false);
    setTab(deepLinkTab === "compare" && rental ? "compare" : "info");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkTab]);

  // Closing the detail while editing avoids stacking two modals; saved values re-render this card from the server.
  const startEdit = () => {
    setOpen(false);
    setEditOpen(true);
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) setTab("info");
        }}
      >
        <DialogTrigger asChild>
          <button
            type="button"
            aria-label={`${asset.name} 상세 보기`}
            className="inline-flex shrink-0 items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
          >
            상세
            <ChevronRight className="h-3 w-3" />
          </button>
        </DialogTrigger>

        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto rounded-2xl border-slate-200/80 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <DialogHeader className="text-left">
            <div className="flex items-center gap-3">
              <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-xl", tone)}>
                <Icon className="h-6 w-6" />
              </div>
              <div className="min-w-0 space-y-1 text-left">
                {rental && <RentalBadge provider={asset.rental_provider} />}
                <DialogTitle className="truncate text-lg font-bold tracking-tight text-slate-900 dark:text-zinc-50">{asset.name}</DialogTitle>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 pt-1">
              <DialogDescription className="min-w-0 truncate text-xs font-normal text-slate-500 dark:text-zinc-400">
                {[asset.space, asset.category, rental ? "렌탈·구독" : "직접 구매"].filter(Boolean).join(" · ")}
              </DialogDescription>
              {canEdit && (
                <button
                  type="button"
                  onClick={startEdit}
                  className="inline-flex shrink-0 items-center gap-1 rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  <Pencil className="h-3 w-3" />
                  수정
                </button>
              )}
            </div>
            {asset.note && <p className="pt-1 text-xs font-normal text-slate-500 dark:text-zinc-400">{asset.note}</p>}
          </DialogHeader>

          {rental && (
            <div role="tablist" aria-label="상세 보기" className="flex gap-2">
              {(
                [
                  ["info", "정보"],
                  ["compare", "환승 & 비용 비교"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  id={`asset-tab-${key}`}
                  aria-selected={tab === key}
                  aria-controls={`asset-panel-${key}`}
                  onClick={() => setTab(key)}
                  className={cn(
                    "rounded-full px-4 py-1.5 text-xs font-medium transition-colors",
                    tab === key
                      ? "bg-slate-900 text-white shadow-sm dark:bg-zinc-100 dark:text-zinc-900"
                      : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {rental && tab === "compare" ? (
            <div role="tabpanel" id="asset-panel-compare" aria-labelledby="asset-tab-compare">
              <RentalCompare asset={asset} today={today} canEdit={canEdit} onEdit={startEdit} />
            </div>
          ) : (
            <div
              role={rental ? "tabpanel" : undefined}
              id={rental ? "asset-panel-info" : undefined}
              aria-labelledby={rental ? "asset-tab-info" : undefined}
              className="space-y-4"
            >
              {rental && <RentalInfo asset={asset} today={today} />}

              <section aria-label="관리 규칙" className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-800 dark:text-zinc-200">관리 규칙</h3>
                {asset.task_rules.length === 0 ? (
                  <p className={LABEL}>등록된 관리 규칙이 없어요.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {asset.task_rules.map((r) => (
                      <li key={r.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/80 px-3 py-2 dark:border-zinc-800">
                        <span className="truncate text-xs font-medium text-slate-800 dark:text-zinc-200">{r.title}</span>
                        <span className="shrink-0 text-[11px] font-normal text-slate-500 dark:text-zinc-400">
                          {formatRecurrence(r.recurring_type, r.interval_n)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {canEdit && <AssetEditModal asset={asset} open={editOpen} onOpenChange={setEditOpen} />}
    </>
  );
}
