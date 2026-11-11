"use client";

import { useState, useTransition } from "react";
import { ChefHat, Clock, Flame, Loader2, PawPrint, Sparkles, Snowflake, Smile } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { formatWon } from "@/features/assets/utils/rental";
import type { PetType } from "../schemas/kitchen.schema";
import { consumeRecipeIngredients, generateFridgeRecipes, generatePetRecipes, type ChefResult, type RecipeCard } from "../server/kitchen-recipes.actions";

type Tab = "fridge" | "pet";
const CHIP = "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-tight";

function Recipe({ r, kind, onDone }: { r: RecipeCard; kind: Tab; onDone: (m: string) => void }) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const names = r.items.map((i) => i.name);

  function use() {
    setError(null);
    startTransition(async () => {
      const res = await consumeRecipeIngredients({ ids: r.items.map((i) => i.id) });
      if (!res.ok) return setError(res.error);
      setDone(`${res.consumed}개 소진 · ${formatWon(res.savedWon)} 절약`);
      onDone(`${r.title} 재료 ${res.consumed}개를 소진 처리했어요. ${formatWon(res.savedWon)} 아꼈어요.`);
    });
  }

  return (
    <article data-testid="recipe-card" data-source={r.source} data-kind={kind} className="flex min-w-0 flex-col gap-3 rounded-xl bg-white p-4 dark:bg-zinc-950">
      <header className="space-y-1.5">
        <h3 data-testid="recipe-title" className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{r.title}</h3>
        <div className="flex flex-wrap items-center gap-1.5">
          <span data-testid="recipe-time" className={cn(CHIP, "text-zinc-600 dark:text-zinc-400")}><Clock className="mr-1 h-3 w-3" aria-hidden />{r.cookTime}</span>
          <span data-testid="recipe-level" className={cn(CHIP, "text-zinc-600 dark:text-zinc-400")}>{r.difficulty}</span>
          {r.calories !== null && <span data-testid="recipe-kcal" className={cn(CHIP, "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300")}><Flame className="mr-1 h-3 w-3" aria-hidden />{r.calories}kcal</span>}
          {kind === "pet" && <span className={cn(CHIP, "border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-900 dark:bg-cyan-950/40 dark:text-cyan-300")}>염분 0%</span>}
        </div>
      </header>

      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">주재료</p>
        <div className="flex flex-wrap gap-1.5">
          {r.matched.map((m) => <span key={m} data-testid="ing-have" className={cn(CHIP, "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300")}>{m}</span>)}
          {r.missing.map((m) => <span key={m} data-testid="ing-missing" title="냉장고에 없는 재료" className={cn(CHIP, "border-dashed border-zinc-300 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400")}>{m} · 없음</span>)}
        </div>
        {r.condiments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-0.5" data-testid="recipe-condiments">
            {r.condiments.map((c) => <span key={c} className={cn(CHIP, "text-zinc-600 dark:text-zinc-400")}>{c}</span>)}
          </div>
        )}
      </div>

      <ol data-testid="recipe-steps" className="space-y-2">
        {r.steps.map((s, i) => (
          <li key={i} className="flex items-start gap-2.5 text-xs text-zinc-800 dark:text-zinc-200">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold tabular-nums text-zinc-900 dark:text-zinc-100 bg-slate-100 dark:bg-zinc-800">{i + 1}</span>
            <span className="min-w-0 break-words">{s}</span>
          </li>
        ))}
      </ol>

      {(r.chefTip || r.substituteTip) && (
        <div className="space-y-1 rounded-2xl bg-slate-50 p-2.5 text-[11px] text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-400">
          {r.chefTip && <p><strong className="font-semibold text-zinc-900 dark:text-zinc-100">TIP</strong> {r.chefTip}</p>}
          {r.substituteTip && <p><strong className="font-semibold text-zinc-900 dark:text-zinc-100">대체</strong> {r.substituteTip}</p>}
        </div>
      )}

      {error && <p role="alert" className="text-xs font-medium text-rose-600 dark:text-rose-400">{error}</p>}
      {done ? (
        <p data-testid="recipe-done" role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">{done}</p>
      ) : (
        <button
          type="button"
          data-testid="recipe-consume"
          disabled={pending || r.items.length === 0}
          onClick={use}
          className="mt-auto inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-zinc-900 transition-colors hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-100 dark:hover:bg-zinc-700 bg-slate-100 dark:bg-zinc-800"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Smile className="h-4 w-4" aria-hidden />}
          {r.items.length === 0 ? "소진할 냉장고 재료가 없어요" : `이 재료들 소진 처리 (${names.slice(0, 3).join("·")}${names.length > 3 ? ` 외 ${names.length - 3}` : ""})`}
        </button>
      )}
    </article>
  );
}

/** AI 셰프: fridge recipes (expiring items first) and, for pet households, boiled/steamed 0%-salt specials. */
export function AiChefSection({ petType, itemCount, onNotice }: { petType: PetType; itemCount: number; onNotice: (m: string) => void }) {
  const [tab, setTab] = useState<Tab>("fridge");
  const [results, setResults] = useState<Partial<Record<Tab, ChefResult>>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const petOn = petType !== "none";
  const result = results[tab];

  function make() {
    setError(null);
    startTransition(async () => {
      const res = tab === "pet" ? await generatePetRecipes() : await generateFridgeRecipes();
      if (!res.ok) return setError(res.error);
      setResults((r) => ({ ...r, [tab]: res.result }));
    });
  }

  return (
    <section aria-label="AI 셰프" data-testid="ai-chef" className="space-y-4 rounded-3xl bg-white p-4 dark:bg-zinc-900 sm:p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-900"><ChefHat className="h-4 w-4" aria-hidden /></span>
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">AI 셰프</h2>
            <p className="text-[11px] font-normal text-zinc-500 dark:text-zinc-400">기한이 급한 재료부터 골라 만들 수 있는 요리를 알려 드려요.</p>
          </div>
        </div>
        <div role="radiogroup" aria-label="셰프 모드" className="inline-flex rounded-xl p-1 bg-slate-100 dark:bg-zinc-800">
          {([["fridge", "즉석 냉파", Snowflake], ["pet", "댕냥이 특식", PawPrint]] as const).map(([k, label, Icon]) => {
            const disabled = k === "pet" && !petOn;
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={tab === k}
                aria-disabled={disabled}
                disabled={disabled}
                title={disabled ? "반려동물을 설정하면 쓸 수 있어요" : undefined}
                data-testid="chef-tab"
                data-tab={k}
                onClick={() => setTab(k)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                  tab === k ? "bg-sky-600 text-white dark:bg-sky-500 dark:text-white" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900",
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
              </button>
            );
          })}
        </div>
      </div>

      {tab === "pet" && (
        <p data-testid="pet-rule-note" className="rounded-lg bg-cyan-50 px-3 py-2 text-[11px] font-medium text-cyan-800 dark:bg-cyan-950/30 dark:text-cyan-300">
          급여해도 되는 재료만 골라, 소금·기름·양념 없이 삶거나 쪄서 식혀 주는 레시피예요. 처음에는 소량부터 주세요.
        </p>
      )}

      <button
        type="button"
        data-testid="chef-generate"
        disabled={pending || (tab === "fridge" && itemCount === 0)}
        onClick={make}
        className="inline-flex h-10 items-center gap-2 rounded-lg bg-sky-600 px-4 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-50 dark:bg-sky-500 dark:text-white dark:hover:bg-sky-400"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
        {pending ? "레시피를 고르는 중…" : tab === "pet" ? "댕냥이 특식 만들기" : "냉장고 레시피 만들기"}
      </button>
      {tab === "fridge" && itemCount === 0 && <p className="text-[11px] text-zinc-500 dark:text-zinc-400">재료를 추가하면 레시피를 만들 수 있어요.</p>}

      {error && <p role="alert" data-testid="chef-error" className="text-xs font-medium text-rose-600 dark:text-rose-400">{error}</p>}

      {result && (
        <div className="space-y-3" data-testid="chef-result" data-source={result.source}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] font-normal text-zinc-500 dark:text-zinc-400">
            <span data-testid="chef-source" className={cn(CHIP, result.source === "gemini" ? "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300" : "text-zinc-600 dark:text-zinc-400")}>
              {result.source === "gemini" ? "AI 셰프" : "기본 레시피"}
            </span>
            {result.note && <span data-testid="chef-note">{result.note}</span>}
            {result.excludedExpired > 0 && <span data-testid="chef-expired">기한이 지난 재료 {result.excludedExpired}개는 제외했어요.</span>}
          </div>
          {result.ingredients.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5" data-testid="chef-ingredients">
              <span className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">사용한 재료</span>
              {result.ingredients.map((i) => (
                <span key={i.id} data-urgent={i.urgent} className={cn(CHIP, i.urgent ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" : "text-zinc-600 dark:text-zinc-400")}>
                  {i.name}{i.urgent ? ` · ${i.days === 0 ? "D-Day" : `D-${i.days}`}` : ""}
                </span>
              ))}
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            {result.recipes.map((r, i) => <Recipe key={`${tab}-${i}-${r.title}`} r={r} kind={tab} onDone={onNotice} />)}
          </div>
        </div>
      )}
    </section>
  );
}
