import { AlarmClock, Package, PiggyBank, Snowflake } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { formatWon } from "@/features/assets/utils/rental";
import type { KitchenProfile, KitchenStats } from "../schemas/kitchen.schema";

function Tile({
  id,
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  id: string;
  icon: LucideIcon;
  label: string;
  value: string;
  sub: string;
  tone?: "amber" | "rose" | "cyan" | "emerald";
}) {
  return (
    <div
      data-testid="pulse-card"
      data-pulse={id}
      className="flex min-w-0 flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
    >
      <div className="flex items-center gap-1.5 text-xs font-normal text-zinc-500 dark:text-zinc-400">
        <Icon className="h-4 w-4 shrink-0" aria-hidden />
        <span className="truncate">{label}</span>
      </div>
      <p
        data-testid="pulse-value"
        className={cn(
          "truncate text-2xl font-semibold tracking-tight tabular-nums",
          tone === "amber" && "text-amber-600 dark:text-amber-400",
          tone === "rose" && "text-rose-600 dark:text-rose-400",
          tone === "cyan" && "text-cyan-600 dark:text-cyan-400",
          tone === "emerald" && "text-emerald-600 dark:text-emerald-400",
          !tone && "text-zinc-900 dark:text-zinc-50",
        )}
      >
        {value}
      </p>
      <p className={cn("truncate text-[11px] font-normal", tone === "rose" ? "font-medium text-rose-600 dark:text-rose-400" : "text-zinc-500 dark:text-zinc-400")}>{sub}</p>
    </div>
  );
}

/** Four headline tiles: items kept · expiring soon · freezer fossils · money saved so far. */
export function KitchenPulse({ stats, profile }: { stats: KitchenStats; profile: KitchenProfile }) {
  return (
    <section aria-label="키친 요약" data-testid="kitchen-pulse" className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
      <Tile id="total" icon={Package} label="보관 중" value={`${stats.total}개`} sub={stats.total === 0 ? "재료를 추가해 보세요" : "냉장 · 냉동 · 실온 합계"} />
      <Tile
        id="urgent"
        icon={AlarmClock}
        label="소비 임박"
        value={`${stats.urgent}개`}
        sub={stats.expired > 0 ? `기한 지남 ${stats.expired}건` : "D-3 이내"}
        tone={stats.expired > 0 ? "rose" : stats.urgent > 0 ? "amber" : undefined}
      />
      <Tile id="fossil" icon={Snowflake} label="냉동 화석" value={`${stats.fossil}개`} sub="30일 이상 냉동" tone={stats.fossil > 0 ? "cyan" : undefined} />
      <Tile
        id="saved"
        icon={PiggyBank}
        label="누적 절약액"
        value={formatWon(profile.saved_money)}
        sub={profile.rescued_count > 0 ? `구출 ${profile.rescued_count}번` : "다 먹으면 쌓여요"}
        tone={profile.saved_money > 0 ? "emerald" : undefined}
      />
    </section>
  );
}
