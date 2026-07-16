import type { HoldingPosition, HoldingTransaction } from "./types";

const EPSILON = 0.000001;

export function calculatePositions(transactions: HoldingTransaction[]): HoldingPosition[] {
  const positions = new Map<string, HoldingPosition>();
  const ordered = [...transactions].sort((a, b) => a.createdAt - b.createdAt);

  for (const transaction of ordered) {
    const current = positions.get(transaction.quoteId) ?? {
      quoteId: transaction.quoteId,
      quoteName: transaction.quoteName,
      valuationQuoteId: transaction.valuationQuoteId ?? transaction.quoteId,
      grams: 0,
      cost: 0,
      averageCost: 0,
    };

    if (transaction.type === "buy") {
      current.valuationQuoteId = transaction.valuationQuoteId ?? transaction.quoteId;
      current.grams += transaction.grams;
      current.cost += transaction.grams * transaction.price;
    } else if (current.grams > EPSILON) {
      const soldGrams = Math.min(transaction.grams, current.grams);
      current.cost -= soldGrams * current.averageCost;
      current.grams -= soldGrams;
    }

    if (current.grams <= EPSILON) {
      current.grams = 0;
      current.cost = 0;
      current.averageCost = 0;
    } else {
      current.averageCost = current.cost / current.grams;
    }
    positions.set(transaction.quoteId, current);
  }

  return [...positions.values()].filter((position) => position.grams > EPSILON);
}

export function positionForQuote(
  transactions: HoldingTransaction[],
  quoteId: string,
): HoldingPosition | undefined {
  return calculatePositions(transactions).find((position) => position.quoteId === quoteId);
}
