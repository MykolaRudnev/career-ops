/** Poland = manual picks only; everything else is bulk-eligible. */
export type MarketLane = "ALL" | "POLAND" | "BULK";

export const MARKET_LANE_STORAGE_KEY = "career-ops.marketLane";

export function isPolandJob(job: { countries?: string[] }): boolean {
  return (job.countries || []).includes("Poland");
}

export function matchesMarketLane(job: { countries?: string[] }, lane: MarketLane): boolean {
  if (lane === "ALL") return true;
  if (lane === "POLAND") return isPolandJob(job);
  return !isPolandJob(job);
}

export function loadMarketLane(): MarketLane {
  try {
    const raw = localStorage.getItem(MARKET_LANE_STORAGE_KEY);
    if (raw === "ALL" || raw === "POLAND" || raw === "BULK") return raw;
  } catch { /* private mode */ }
  return "BULK";
}

export function saveMarketLane(lane: MarketLane): void {
  try { localStorage.setItem(MARKET_LANE_STORAGE_KEY, lane); } catch { /* ignore */ }
}
