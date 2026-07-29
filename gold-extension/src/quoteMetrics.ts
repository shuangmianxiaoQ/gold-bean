import type { HistoryPoint } from "./types";

export interface ObservedPriceRange {
  high: number;
  low: number;
}

export function getObservedDayRange(
  points: HistoryPoint[],
  currentPrice: number,
  now = Date.now(),
): ObservedPriceRange {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const prices = points
    .filter((point) => point.time >= start.getTime() && point.time < end.getTime())
    .map((point) => point.price)
    .filter((price) => Number.isFinite(price));

  if (Number.isFinite(currentPrice)) prices.push(currentPrice);

  return {
    high: Math.max(...prices),
    low: Math.min(...prices),
  };
}
