import { ExternalLink } from "lucide-react";
import { buildShoppingLinks } from "@/shared/utils/space-planner";

/** One-tap searches for a keyword on the four malls (new tab). */
export function ShoppingButtons({ keyword }: { keyword: string }) {
  const links = buildShoppingLinks(keyword);
  if (links.length === 0) return null;
  return (
    <div data-testid="shop-links" className="flex flex-wrap gap-1.5">
      {links.map((l) => (
        <a
          key={l.mall}
          href={l.url}
          target="_blank"
          rel="noopener noreferrer"
          data-mall={l.mall}
          className="inline-flex min-h-9 items-center gap-1 whitespace-nowrap rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 transition-colors hover:bg-sky-50 hover:text-sky-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-sky-950/50 dark:hover:text-sky-300"
        >
          {l.label}
          <ExternalLink size={12} strokeWidth={2.5} aria-hidden />
        </a>
      ))}
    </div>
  );
}
