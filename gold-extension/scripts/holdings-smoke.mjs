import { calculatePositions } from "../src/holdings.ts";

const transactions = [
  { id: "1", quoteId: "gold", quoteName: "测试积存金", type: "buy", grams: 10, price: 800, createdAt: 1 },
  { id: "2", quoteId: "gold", quoteName: "测试积存金", type: "buy", grams: 5, price: 900, createdAt: 2 },
  { id: "3", quoteId: "gold", quoteName: "测试积存金", type: "sell", grams: 3, price: 950, createdAt: 3 },
];

const position = calculatePositions(transactions)[0];
if (!position) throw new Error("Expected a holding position");
if (Math.abs(position.grams - 12) > 0.000001) throw new Error("Incorrect remaining grams");
if (Math.abs(position.cost - 10_000) > 0.001) throw new Error("Incorrect remaining cost");
if (Math.abs(position.averageCost - 833.333333) > 0.001) throw new Error("Incorrect moving average cost");

console.log(JSON.stringify({
  grams: position.grams,
  cost: position.cost,
  averageCost: Number(position.averageCost.toFixed(4)),
}, null, 2));
