/** Vercel-style ambient mesh gradient at the top of a page. Place as the first child of a `relative isolate` wrapper. */
export function AmbientBackground() {
  return (
    <div
      aria-hidden="true"
      data-testid="ambient-bg"
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] overflow-hidden [mask-image:linear-gradient(to_bottom,black,transparent)]"
    >
      <div className="absolute -top-32 left-[8%] h-80 w-80 rounded-full bg-violet-300/30 blur-3xl dark:bg-violet-500/15" />
      <div className="absolute -top-40 left-[38%] h-96 w-96 rounded-full bg-sky-300/30 blur-3xl dark:bg-sky-500/10" />
      <div className="absolute -top-28 right-[6%] h-72 w-72 rounded-full bg-emerald-300/25 blur-3xl dark:bg-emerald-500/10" />
    </div>
  );
}
