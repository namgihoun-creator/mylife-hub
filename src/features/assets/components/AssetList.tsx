"use client";

import { useMemo, useState } from "react";
import { PackageOpen } from "lucide-react";
import { EmptyState } from "@/shared/components/ui/empty-state";
import { cn } from "@/shared/lib/utils";
import { SPACES, type Asset } from "../schemas/asset.schema";
import { nextTaskOf } from "../utils/asset-summary";
import { AssetCard } from "./AssetCard";

type Dimension = "space" | "category";

const PILL_BASE = "shrink-0 rounded-full px-4 py-1.5 text-xs font-medium transition-colors";
const PILL_ACTIVE = "bg-slate-900 text-white shadow-sm dark:bg-zinc-100 dark:text-zinc-900";
const PILL_INACTIVE =
  "border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800";

const groupKey = (a: Asset, dim: Dimension) => (dim === "space" ? a.space : a.category) || "미분류";

function sortKeys(keys: string[], dim: Dimension) {
  const rank = (k: string) => {
    const i = (SPACES as readonly string[]).indexOf(k);
    return i === -1 ? SPACES.length : i;
  };
  return [...keys].sort((a, b) =>
    dim === "space" ? rank(a) - rank(b) || a.localeCompare(b, "ko") : a.localeCompare(b, "ko"),
  );
}

/** Most urgent first; assets without an open task last. */
function byUrgency(a: Asset, b: Asset) {
  const da = nextTaskOf(a)?.due_date ?? "9999-12-31";
  const db = nextTaskOf(b)?.due_date ?? "9999-12-31";
  return da.localeCompare(db) || a.name.localeCompare(b.name, "ko");
}

export function AssetList({
  assets,
  today,
  emptyAction,
}: {
  assets: Asset[];
  today: string;
  emptyAction?: React.ReactNode;
}) {
  const [dim, setDim] = useState<Dimension>("space");
  const [selected, setSelected] = useState<string>("전체");

  const sections = useMemo(() => {
    const groups = new Map<string, Asset[]>();
    for (const a of assets) groups.set(groupKey(a, dim), [...(groups.get(groupKey(a, dim)) ?? []), a]);
    return sortKeys([...groups.keys()], dim).map((k) => [k, groups.get(k)!.sort(byUrgency)] as const);
  }, [assets, dim]);

  if (assets.length === 0) {
    return (
      <EmptyState
        icon={PackageOpen}
        title="아직 등록된 가전이 없어요"
        description="프리셋에서 가전을 고르면 소모품 교체 주기까지 한 번에 등록돼요."
        action={emptyAction}
      />
    );
  }

  const activeSelected = selected === "전체" || sections.some(([k]) => k === selected) ? selected : "전체";
  const visible = sections.filter(([k]) => activeSelected === "전체" || k === activeSelected);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label="필터">
          <button
            type="button"
            onClick={() => setSelected("전체")}
            className={cn(PILL_BASE, activeSelected === "전체" ? PILL_ACTIVE : PILL_INACTIVE)}
          >
            전체 {assets.length}
          </button>
          {sections.map(([k, items]) => (
            <button
              key={k}
              type="button"
              onClick={() => setSelected(k)}
              className={cn(PILL_BASE, activeSelected === k ? PILL_ACTIVE : PILL_INACTIVE)}
            >
              {k} {items.length}
            </button>
          ))}
        </div>

        <div
          className="flex shrink-0 rounded-full border border-slate-200 bg-white p-0.5 dark:border-zinc-800 dark:bg-zinc-900"
          role="group"
          aria-label="묶는 기준"
        >
          {(["space", "category"] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => {
                setDim(d);
                setSelected("전체");
              }}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                dim === d ? PILL_ACTIVE : "text-slate-600 hover:bg-slate-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
              )}
            >
              {d === "space" ? "공간" : "카테고리"}
            </button>
          ))}
        </div>
      </div>

      {visible.map(([key, items]) => (
        <section key={key} className="space-y-3">
          <h2 className="text-base font-semibold text-slate-800 dark:text-zinc-200">
            {key} <span className="text-xs font-normal text-slate-500 dark:text-zinc-400">{items.length}</span>
          </h2>
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {items.map((a) => (
              <AssetCard key={a.id} asset={a} today={today} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
