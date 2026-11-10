/** 'YYYY-MM-DD' + n days (pure calendar arithmetic, no timezone involved). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * New due date after a snooze. Counted from the later of (current due date, today):
 * snoozing an overdue task by 3 days means "3 days from today", not "still overdue".
 * Used by both the Server Action and the optimistic UI so they always agree.
 */
export function snoozeTargetDate(dueDate: string, today: string, days: number): string {
  return addDays(dueDate > today ? dueDate : today, days);
}
