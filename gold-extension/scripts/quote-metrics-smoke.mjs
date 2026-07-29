import { getObservedDayRange } from "../src/quoteMetrics.ts";

const now = new Date(2026, 6, 29, 15, 0).getTime();
const points = [
  { time: new Date(2026, 6, 28, 23, 59).getTime(), price: 999 },
  { time: new Date(2026, 6, 29, 9, 30).getTime(), price: 4010.24 },
  { time: new Date(2026, 6, 29, 11, 20).getTime(), price: 4037.72 },
  { time: new Date(2026, 6, 30, 0, 1).getTime(), price: 1000 },
];

const range = getObservedDayRange(points, 4028.6, now);
if (range.high !== 4037.72) throw new Error(`Unexpected observed high: ${range.high}`);
if (range.low !== 4010.24) throw new Error(`Unexpected observed low: ${range.low}`);

const currentOnly = getObservedDayRange([], 4028.6, now);
if (currentOnly.high !== 4028.6 || currentOnly.low !== 4028.6) {
  throw new Error("Current price should seed an empty observed range");
}

console.log(JSON.stringify({ range, currentOnly }, null, 2));
