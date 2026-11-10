import { PartyPopper, Sparkles } from "lucide-react";

// Confetti specks: [position classes, color, animation delay]. Complete class strings for Tailwind JIT.
const SPECKS: [string, string, string][] = [
  ["left-1 top-3", "bg-rose-400", "0ms"],
  ["right-2 top-1", "bg-amber-400", "200ms"],
  ["left-6 bottom-1", "bg-sky-400", "400ms"],
  ["right-0 bottom-6", "bg-emerald-400", "100ms"],
  ["left-0 top-1/2", "bg-violet-400", "300ms"],
  ["right-6 bottom-0", "bg-rose-300", "500ms"],
];

/** All-clear illustration: gradient tile + party icon + floating confetti. Motion is disabled for reduced-motion users. */
export function CelebrationArt() {
  return (
    <div className="relative h-28 w-28" aria-hidden>
      {SPECKS.map(([pos, color, delay], i) => (
        <span
          key={i}
          className={`absolute h-2 w-2 rounded-full ${pos} ${color} animate-bounce motion-reduce:animate-none`}
          style={{ animationDelay: delay }}
        />
      ))}
      <Sparkles className="absolute -right-1 top-5 h-5 w-5 animate-pulse text-amber-400 motion-reduce:animate-none" />
      <Sparkles className="absolute -left-1 bottom-6 h-4 w-4 animate-pulse text-violet-400 motion-reduce:animate-none" style={{ animationDelay: "300ms" }} />
      <div className="absolute inset-3 flex rotate-3 items-center justify-center rounded-3xl bg-gradient-to-br from-amber-100 via-rose-100 to-violet-100 shadow-md ring-1 ring-inset ring-white/70 dark:from-amber-950/50 dark:via-rose-950/40 dark:to-violet-950/50 dark:ring-white/10">
        <PartyPopper className="h-10 w-10 -rotate-3 text-amber-500 dark:text-amber-400" />
      </div>
    </div>
  );
}
