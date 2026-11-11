import { cn } from "@/shared/lib/utils";

const STROKE = {
  ok: "stroke-emerald-400 dark:stroke-emerald-300",
  warn: "stroke-amber-400 dark:stroke-amber-300",
  danger: "stroke-rose-400 dark:stroke-rose-300",
  sky: "stroke-sky-500 dark:stroke-sky-400",
} as const;

/**
 * Gamified progress ring (learning-app style): a thick rounded arc with the percentage in the middle.
 * `percent` is clamped to 0..100 for the arc; the label shows the real value (e.g. 104%).
 */
export function ProgressRing({
  percent,
  label,
  tone = "sky",
  size = 72,
  className,
  testId,
}: {
  percent: number;
  label: string;
  tone?: keyof typeof STROKE;
  size?: number;
  className?: string;
  testId?: string;
}) {
  const stroke = Math.max(6, Math.round(size / 8));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const shown = Math.max(0, Math.min(100, percent));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(shown)}
      aria-valuetext={`${Math.round(percent)}%`}
      data-testid={testId}
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-slate-100 dark:stroke-zinc-800" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - shown / 100)}
          className={cn("transition-[stroke-dashoffset] duration-700 motion-reduce:transition-none", STROKE[tone])}
        />
      </svg>
      <span className="absolute text-sm font-extrabold tabular-nums text-slate-900 dark:text-zinc-50">{Math.round(percent)}%</span>
    </div>
  );
}
