import { Skeleton } from "@/shared/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-6" role="status" aria-label="타임라인을 불러오는 중">
      <div className="space-y-2">
        <Skeleton className="h-8 w-44 rounded-xl" />
        <Skeleton className="h-3.5 w-72 rounded-full" />
      </div>
      <Skeleton className="h-28" />
      <div className="flex gap-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-8 w-20 rounded-full" />
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
    </div>
  );
}
