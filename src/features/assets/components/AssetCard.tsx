import { Lock } from "lucide-react";
import { DDayBadge } from "@/shared/components/ui/dday-badge";
import { getApplianceVisual } from "@/shared/lib/appliance-icons";
import { URGENCY_BAR_CLASS } from "@/shared/lib/dday";
import { formatRecurrence } from "@/shared/lib/recurrence";
import { cn } from "@/shared/lib/utils";
import type { Asset } from "../schemas/asset.schema";
import { getGauge } from "../utils/gauge";
import { isRentalAsset } from "../utils/rental";
import { AssetDetailDialog } from "./AssetDetailDialog";
import { RentalBadge } from "./RentalBadge";
import { nextTaskOf } from "../utils/asset-summary";

const TAG =
  "rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-zinc-800 dark:text-zinc-300";

/** Item card: icon box · name/tags/cycle · D-Day badge, plus a remaining-time gauge (docs/DESIGN_SYSTEM.md §4.C, C-4). */
export function AssetCard({ asset, today, canEdit = false }: { asset: Asset; today: string; canEdit?: boolean }) {
  const { icon: Icon, tone } = getApplianceVisual(asset.preset_key);
  const next = nextTaskOf(asset);
  const firstRule = asset.task_rules[0];
  const nextRule = next ? (asset.task_rules.find((r) => r.id === next.rule_id) ?? firstRule) : firstRule;
  const gauge = next ? getGauge(next.due_date, today, nextRule) : null;

  const cycle = firstRule
    ? `${firstRule.title}${asset.task_rules.length > 1 ? ` 외 ${asset.task_rules.length - 1}건` : ""} · ${formatRecurrence(firstRule.recurring_type, firstRule.interval_n)}`
    : "관리 규칙 없음";

  return (
    <li className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md motion-reduce:transform-none motion-reduce:transition-none dark:border-zinc-800 dark:bg-zinc-900/90">
      {isRentalAsset(asset) && <RentalBadge provider={asset.rental_provider} className="mb-2.5" />}
      <div className="flex items-center gap-3">
        <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", tone)}>
          <Icon className="h-5 w-5" />
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-zinc-50">{asset.name}</h3>
            {asset.visibility === "PRIVATE" && (
              <Lock className="h-3 w-3 shrink-0 text-slate-400 dark:text-zinc-500" aria-label="개인 전용" />
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {asset.space && <span className={TAG}>{asset.space}</span>}
            {asset.category && <span className={TAG}>{asset.category}</span>}
          </div>
        </div>

        <DDayBadge dueDate={next?.due_date} today={today} className="shrink-0" />
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-xs font-normal text-slate-500 dark:text-zinc-400">{cycle}</p>
        <AssetDetailDialog asset={asset} today={today} canEdit={canEdit} />
      </div>

      {gauge && next && (
        <div className="mt-2.5 space-y-1">
          <div
            role="progressbar"
            aria-label={`${next.title} 남은 기간`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={gauge.pct}
            className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-zinc-800"
          >
            <div
              className={cn("h-full rounded-full transition-[width] duration-500", URGENCY_BAR_CLASS[gauge.urgency])}
              style={{ width: `${gauge.pct}%` }}
            />
          </div>
          <div className="flex items-center justify-between gap-2 text-[11px] font-normal text-slate-500 dark:text-zinc-400">
            <span className="truncate">{next.title}</span>
            <span className="shrink-0 tabular-nums">{gauge.caption}</span>
          </div>
        </div>
      )}
    </li>
  );
}
