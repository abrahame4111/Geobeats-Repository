/** "just now" / "5 min ago" / "1 hr ago" / "2 d ago" from a unix timestamp (seconds). */
export function timeAgo(ts?: number | null, now: number = Date.now()): string {
  if (!ts) return "offline";
  const s = Math.max(0, Math.floor(now / 1000 - ts));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24);
  return `${d} d ago`;
}
