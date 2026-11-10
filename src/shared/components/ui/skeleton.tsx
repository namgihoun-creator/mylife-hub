import { cn } from "@/shared/lib/utils";

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-2xl bg-slate-200/70 motion-reduce:animate-none dark:bg-zinc-800", className)}
      {...props}
    />
  );
}
