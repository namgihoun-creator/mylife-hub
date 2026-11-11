import { AlarmClock, Package, PiggyBank, Snowflake } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { formatWon } from "@/features/assets/utils/rental";
import type { KitchenProfile, KitchenStats } from "../schemas/kitchen.schema";

const BUBBLE = {
  sky: "bg-sky-100 text-sky-600 dark:bg-sky-950/60 dark:text-sky-300",
  amber: "bg-amber-100 text-amber-600 dark:bg-amber-950/60 dark:text-amber-300",
  rose: "bg-rose-100 text-rose-500 dark:bg-rose-950/60 dark:text-rose-300",
  cyan: "bg-cyan-100 text-cyan-600 dark:bg-cyan-950/60 dark:text-cyan-300",
  emerald: "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-300",
} as const;

function Tile({
  id,
  icon: Icon,
  label,
  value,
  sub,
  tone,
  bubble,
}: {
  id: string;
  icon: LucideIcon;
  label: string;
  value: string;
  sub: string;
  tone?: "amber" | "rose" | "cyan" | "emerald";
  bubble: keyof typeof BUBBLE;
}) {
  return (
    <div data-testid="pulse-card" data-pulse={id} className="flex min-w-0 flex-col gap-3 rounded-3xl bg-white p-4 shadow-sm dark:bg-zinc-900 sm:p-5">
      <div className="flex items-center gap-2.5">
        <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl", BUBBLE[bubble])}>
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <span className="truncate text-xs font-bold text-slate-500 dark:text-zinc-400">{label}</span>
      </div>
      <p
        data-testid="pulse-value"
        className={cn(
          "truncate text-3xl font-extrabold tracking-tight tabular-nums",
          tone === "amber" && "text-amber-500 dark:text-amber-400",
          tone === "rose" && "text-rose-500 dark:text-rose-400",
          tone === "cyan" && "text-cyan-600 dark:text-cyan-400",
          tone === "emerald" && "text-emerald-600 dark:text-emerald-400",
          !tone && "text-slate-900 dark:text-zinc-50",
        )}
      >
        {value}
      </p>
      <p className={cn("truncate text-xs", tone === "rose" ? "font-bold text-rose-500 dark:text-rose-400" : "font-medium text-slate-500 dark:text-zinc-400")}>{sub}</p>
    </div>
  );
}

/** Four friendly headline tiles: items kept · expiring soon · freezer fossils · money saved so far. */
export function KitchenPulse({ stats, profile }: { stats: KitchenStats; profile: KitchenProfile }) {
  return (
    <section aria-label="키친 요약" data-testid="kitchen-pulse" className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
      <Tile id="total" icon={Package} bubble="sky" label="보관 중" value={`${stats.total}개`} sub={stats.total === 0 ? "재료를 추가해 보세요" : "냉장 · 냉동 · 실온 합계"} />
      <Tile
        id="urgent"
        icon={AlarmClock}
        bubble={stats.expired > 0 ? "rose" : "amber"}
        label="소비 임박"
        value={`${stats.urgent}개`}
        sub={stats.expired > 0 ? `기한 지남 ${stats.expired}건` : "D-3 이내"}
        tone={stats.expired > 0 ? "rose" : stats.urgent > 0 ? "amber" : undefined}
      />
      <Tile id="fossil" icon={Snowflake} bubble="cyan" label="냉동 화석" value={`${stats.fossil}개`} sub="30일 이상 냉동" tone={stats.fossil > 0 ? "cyan" : undefined} />
      <Tile
        id="saved"
        icon={PiggyBank}
        bubble="emerald"
        label="누적 절약액"
        value={formatWon(profile.saved_money)}
        sub={profile.rescued_count > 0 ? `구출 ${profile.rescued_count}번` : "다 먹으면 쌓여요"}
        tone={profile.saved_money > 0 ? "emerald" : undefined}
      />
    </section>
  );
}
