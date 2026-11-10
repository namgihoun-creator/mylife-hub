/** "방금 전", "10분 전", "3시간 전", "2일 전", then "MM/DD". `now` is injectable for tests. */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const diffSec = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return "방금 전";
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}분 전`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}일 전`;
  const d = new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  return `${d.slice(5, 7)}/${d.slice(8, 10)}`;
}
