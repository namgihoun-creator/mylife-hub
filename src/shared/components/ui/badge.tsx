import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/shared/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-3 py-1 text-xs font-bold transition-colors focus:outline-none",
  {
    variants: {
      variant: {
        default: "border-transparent bg-sky-600 text-white dark:bg-sky-500 dark:text-white",
        secondary: "bg-slate-100 text-slate-700 dark:bg-zinc-800 dark:text-zinc-300",
        destructive: "bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300",
        outline: "bg-white text-slate-800 shadow-sm dark:bg-zinc-800 dark:text-zinc-100",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
