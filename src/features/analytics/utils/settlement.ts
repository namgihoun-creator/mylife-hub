// Month-end household settlement maths (pure; node:test imports it). Three blocks:
//   food      — food spending vs the monthly food budget ("식비 예산 방어율")
//   waste     — ingredients that expired / were thrown away, with an estimated loss
//   team      — what the couple got done together (appliance care, used-up ingredients, shopping)

/** The app's own value of one rescued / wasted ingredient (kitchen "다 먹었어요" credits the same amount). Prices are not stored per ingredient. */
export const EST_WON_PER_ITEM = 3000;

export type ActivityKind = "CONSUMED" | "DISCARDED" | "SHOPPED";

export type SettlementInput = {
  month: string;
  /** Seoul 'YYYY-MM-DD' */
  today: string;
  humanBudget: number;
  /** the month's kitchen_expenses (any category; only human_groceries + human_delivery count as food) */
  expenses: readonly { category: string; amount: number }[];
  /** the month's kitchen_activity rows; null = the log table does not exist yet (migration 19 not applied) */
  activity: readonly { kind: string; est_amount?: number | null; created_by?: string | null }[] | null;
  /** ingredients whose expiry date fell in the month and is already past, and that are still sitting in the storage */
  expiredInStock: number;
  /** the month's task-completion events (event_logs: TASK_COMPLETED / MAGIC_LINK_COMPLETED) */
  taskEvents: readonly { actor_identifier?: string | null }[];
};

export type FoodSettlement = {
  budget: number;
  spent: number;
  groceries: number;
  delivery: number;
  /** spent / budget, whole percent (can pass 100); 0 without a budget */
  usedPct: number;
  /** share of the budget still unspent, whole percent, never below 0 ("방어율") */
  defendedPct: number;
  /** budget - spent: positive = saved, negative = over */
  diff: number;
  status: "SAVED" | "OVER" | "EVEN" | "NO_BUDGET";
};

export type WasteSettlement = {
  /** whether the activity log exists (without it only the "still in the storage" part can be counted) */
  logReady: boolean;
  discardedCount: number;
  stockCount: number;
  count: number;
  /** logged est_amount + stockCount * EST_WON_PER_ITEM */
  estimatedWon: number;
  perItemWon: number;
};

export type TeamSettlement = {
  logReady: boolean;
  tasks: number;
  consumed: number;
  shopped: number;
  total: number;
  /** distinct people behind those actions (as far as they are recorded) */
  contributors: number;
};

export type Settlement = { month: string; isCurrentMonth: boolean; food: FoodSettlement; waste: WasteSettlement; team: TeamSettlement };

const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n) : 0);

export function buildSettlement(input: SettlementInput): Settlement {
  // ---- food
  let groceries = 0, delivery = 0;
  for (const e of input.expenses ?? []) {
    if (e.category === "human_groceries") groceries += num(e.amount);
    else if (e.category === "human_delivery") delivery += num(e.amount);
  }
  const spent = groceries + delivery;
  const budget = num(input.humanBudget);
  const diff = budget - spent;
  const food: FoodSettlement = {
    budget,
    spent,
    groceries,
    delivery,
    usedPct: budget > 0 ? Math.round((spent / budget) * 100) : 0,
    defendedPct: budget > 0 ? Math.max(0, Math.round((diff / budget) * 100)) : 0,
    diff,
    status: budget === 0 ? "NO_BUDGET" : diff > 0 ? "SAVED" : diff < 0 ? "OVER" : "EVEN",
  };

  // ---- waste
  const log = input.activity;
  const logged = (log ?? []).filter((a) => a.kind === "DISCARDED");
  const stockCount = Math.max(0, Math.floor(input.expiredInStock || 0));
  const waste: WasteSettlement = {
    logReady: log !== null,
    discardedCount: logged.length,
    stockCount,
    count: logged.length + stockCount,
    estimatedWon: logged.reduce((s, a) => s + (num(a.est_amount) || EST_WON_PER_ITEM), 0) + stockCount * EST_WON_PER_ITEM,
    perItemWon: EST_WON_PER_ITEM,
  };

  // ---- team
  const consumed = (log ?? []).filter((a) => a.kind === "CONSUMED").length;
  const shopped = (log ?? []).filter((a) => a.kind === "SHOPPED").length;
  const tasks = (input.taskEvents ?? []).length;
  const people = new Set<string>();
  for (const t of input.taskEvents ?? []) if (t.actor_identifier && t.actor_identifier.startsWith("user:")) people.add(t.actor_identifier);
  for (const a of log ?? []) if (a.kind !== "DISCARDED" && a.created_by) people.add(`user:${a.created_by}`);
  const team: TeamSettlement = { logReady: log !== null, tasks, consumed, shopped, total: tasks + consumed + shopped, contributors: people.size };

  return { month: input.month, isCurrentMonth: input.today.slice(0, 7) === input.month, food, waste, team };
}

/** One friendly sentence for the team block. */
export function teamMessage(t: TeamSettlement): string {
  if (t.total === 0) return "이 달에는 아직 함께 한 기록이 없어요.";
  if (t.contributors >= 2) return `${t.contributors}명이 함께 ${t.total}건을 해냈어요!`;
  if (t.contributors === 1) return `이 달에 ${t.total}건을 해냈어요. 파트너와 나눠 하면 더 가벼워져요.`;
  return `이 달에 ${t.total}건을 해냈어요.`;
}

/** Headline of the food block: "12만 원 절약" / "3만 원 초과" … in whole won with separators. */
export function foodHeadline(f: FoodSettlement): string {
  if (f.status === "NO_BUDGET") return "식비 예산이 아직 없어요";
  if (f.status === "EVEN") return "예산을 딱 맞게 썼어요";
  const won = `${Math.abs(f.diff).toLocaleString("ko-KR")}원`;
  return f.status === "SAVED" ? `${won} 절약했어요` : `${won} 초과했어요`;
}
