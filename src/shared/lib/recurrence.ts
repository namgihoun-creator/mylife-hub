export type RecurringType = "NONE" | "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

/** "6개월마다", "1년마다", "2주마다" … */
export function formatRecurrence(type: RecurringType, interval: number): string {
  switch (type) {
    case "DAILY":
      return `${interval}일마다`;
    case "WEEKLY":
      return `${interval}주마다`;
    case "MONTHLY":
      return interval % 12 === 0 ? `${interval / 12}년마다` : `${interval}개월마다`;
    case "YEARLY":
      return `${interval}년마다`;
    default:
      return "1회성";
  }
}

/** ISO timestamp -> 'YYYY-MM-DD' in Asia/Seoul (wall-clock date). */
export function toSeoulDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}
