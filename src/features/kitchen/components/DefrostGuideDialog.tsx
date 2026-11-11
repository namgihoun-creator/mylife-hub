"use client";

import { Microwave, Snowflake } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { frozenDays } from "../rules/expiry";
import { defrostInfo } from "../rules/defrost-guide";
import type { KitchenItem } from "../schemas/kitchen.schema";

/** Opened from the cyan "30일+ 냉동" badge: how to thaw / cook a long-frozen item. */
export function DefrostGuideDialog({ item, today, onClose }: { item: KitchenItem | null; today: string; onClose: () => void }) {
  const info = item ? defrostInfo(item.name) : null;
  const days = item ? frozenDays(item.added_at, today) : null;
  return (
    <Dialog open={item !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent data-testid="defrost-dialog" className="max-w-md rounded-xl">
        <DialogHeader className="text-left">
          <DialogTitle className="flex items-center gap-2">
            <Snowflake className="h-4 w-4 text-cyan-600 dark:text-cyan-400" aria-hidden /> 해동 가이드
          </DialogTitle>
          <DialogDescription>
            {item?.name}
            {days !== null && days >= 0 ? ` · 냉동 ${days}일째` : ""}
          </DialogDescription>
        </DialogHeader>
        {info && (
          <div className="space-y-3">
            <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
              분류 <span data-testid="defrost-group" className="text-zinc-900 dark:text-zinc-100">{info.group}</span>
            </p>
            <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3 dark:border-cyan-900/60 dark:bg-cyan-950/30">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-cyan-800 dark:text-cyan-200">
                <Microwave className="h-4 w-4" aria-hidden /> 해동·가열 방법
              </p>
              <p data-testid="defrost-method" className="mt-1 text-sm text-cyan-900 dark:text-cyan-100">{info.defrost}</p>
            </div>
            {info.odor && (
              <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-50">잡내 제거 팁</p>
                <p data-testid="defrost-odor" className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">{info.odor}</p>
              </div>
            )}
            <p className="text-[11px] font-normal text-zinc-500 dark:text-zinc-400">오래 얼린 재료는 맛과 식감이 떨어져요. 먼저 드시고, 해동한 것은 다시 얼리지 마세요.</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
