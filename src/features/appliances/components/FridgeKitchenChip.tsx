import Link from "next/link";
import { ChefHat, TriangleAlert } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { fridgeChipLabel, type FridgeStock } from "../utils/fridge";

/** On a refrigerator's asset card: how much is stored and how much is about to expire — one tap to /kitchen. */
export function FridgeKitchenChip({ stock, className }: { stock: FridgeStock; className?: string }) {
  const urgent = stock.urgent > 0;
  return (
    <Link
      href="/kitchen"
      data-testid="fridge-chip"
      data-urgent={stock.urgent}
      aria-label={`키친으로 이동: ${fridgeChipLabel(stock)}`}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100",
        urgent
          ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-950/70"
          : "border-zinc-200 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900",
        className,
      )}
    >
      <ChefHat className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="truncate tabular-nums">{fridgeChipLabel(stock)}</span>
      {urgent && <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />}
    </Link>
  );
}
