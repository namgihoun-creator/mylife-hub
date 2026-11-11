"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, Copy, Package } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { copyableSpec, getPurchaseLinks, hasConsumable, type PurchaseLinkInput } from "../utils/purchase-link";

const OUTLINE =
  "inline-flex h-8 items-center gap-1 rounded-xl bg-transparent px-2.5 text-xs font-medium text-zinc-900 transition-colors hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-700 dark:focus-visible:ring-zinc-100";

/** name · model line with a one-click copy of the spec (model number, else name). */
export function ConsumableStrip({ info, className }: { info: PurchaseLinkInput; className?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const name = info.consumable_name?.trim();
  const model = info.consumable_model?.trim();
  const spec = copyableSpec(info);
  if (!name && !model) return null;

  const copy = async () => {
    if (!spec) return;
    try {
      await navigator.clipboard.writeText(spec);
    } catch {
      const ta = document.createElement("textarea"); // legacy fallback (insecure context / denied permission)
      ta.value = spec;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } finally {
        ta.remove();
      }
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div
      data-testid="consumable-strip"
      className={cn(
        "flex items-center gap-2 rounded-2xl bg-slate-50 px-2.5 py-1.5 dark:bg-zinc-800/60",
        className,
      )}
    >
      <Package className="h-3.5 w-3.5 shrink-0 text-zinc-500 dark:text-zinc-400" aria-hidden />
      <p className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-800 dark:text-zinc-200">
        {name}
        {name && model && <span className="text-zinc-400 dark:text-zinc-600"> · </span>}
        {model && <span data-testid="consumable-model" className="font-mono text-[11px] font-normal text-zinc-600 dark:text-zinc-400">{model}</span>}
      </p>
      <button
        type="button"
        onClick={copy}
        aria-label={model ? `모델명 ${model} 복사` : `${name} 복사`}
        title={model ? "모델명 복사" : "복사"}
        data-copied={copied}
        className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-zinc-600 transition-colors hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
      >
        {copied ? <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" /> : <Copy className="h-3 w-3" />}
        <span role="status" aria-live="polite">{copied ? "복사됨" : "복사"}</span>
      </button>
    </div>
  );
}

/** [소모품 구매 ↗] — the custom URL, or a Naver Shopping search (+ 다나와 as a second option). */
export function PurchaseButtons({ info, className }: { info: PurchaseLinkInput; className?: string }) {
  if (!hasConsumable(info)) return null;
  const links = getPurchaseLinks(info);
  if (!links) return null;
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <a
        href={links.primary}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="purchase-link"
        data-kind={links.kind}
        className={OUTLINE}
      >
        소모품 구매
        <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
      </a>
      {links.alternatives.map((a) => (
        <a
          key={a.label}
          href={a.url}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="purchase-link-alt"
          aria-label={`${a.label}에서 최저가 검색`}
          className={cn(OUTLINE, "text-zinc-600 dark:text-zinc-400")}
        >
          {a.label}
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
        </a>
      ))}
    </div>
  );
}
