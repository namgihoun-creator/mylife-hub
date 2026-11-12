import Link from "next/link";
import { Heart, Ruler, Sofa } from "lucide-react";
import { roomLabel } from "../schemas/space-constants";
import type { SpaceListItem } from "../schemas/space-board.schema";

/** One space on /spaces: thumbnail (signed URL), name, purpose/style pills, how many measurements and wish items it has. */
export function SpaceCard({ space }: { space: SpaceListItem }) {
  return (
    <li className="min-w-0">
      <Link
        href={`/spaces/${space.id}`}
        data-testid="space-card"
        data-space-id={space.id}
        className="group flex h-full flex-col overflow-hidden rounded-3xl bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 dark:bg-zinc-900"
      >
        <div className="relative aspect-[4/3] w-full overflow-hidden bg-gradient-to-br from-sky-100 to-teal-100 dark:from-sky-950/50 dark:to-teal-950/50">
          {space.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived URL of a private bucket
            <img src={space.photoUrl} alt="" loading="lazy" data-testid="space-thumb" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-sky-500 dark:text-sky-300">
              <Sofa size={40} strokeWidth={1.8} aria-hidden />
            </span>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2.5 p-4">
          <h2 className="truncate text-lg font-extrabold tracking-tight text-slate-900 dark:text-zinc-50">{space.name}</h2>
          <div className="flex flex-wrap gap-1.5">
            <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-bold text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">{roomLabel(space.room_type)}</span>
            {space.style_preference && (
              <span className="max-w-full truncate rounded-full bg-teal-50 px-2.5 py-1 text-xs font-bold text-teal-700 dark:bg-teal-950/40 dark:text-teal-300">{space.style_preference}</span>
            )}
          </div>
          <p className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-bold text-slate-500 dark:text-zinc-400">
            <span data-testid="card-annotations" className="inline-flex items-center gap-1">
              <Ruler size={13} aria-hidden /> 실측 {space.annotationCount}개
            </span>
            <span data-testid="card-wishes" className="inline-flex items-center gap-1">
              <Heart size={13} aria-hidden /> 위시 {space.candidateCount}개
            </span>
          </p>
        </div>
      </Link>
    </li>
  );
}
