export type SourceKey = "jdZheshang" | "jdMinsheng" | "market" | "exchangeRate";

interface FallbackPayload<TQuote extends { id: string }> {
  success: boolean;
  stale: boolean;
  staleSources?: SourceKey[];
  quotes: TQuote[];
  sources: Record<SourceKey, { ok: boolean }>;
  exchangeRates?: {
    usdCny: number;
    sourceTime: number;
  };
}

const sourceQuoteIds: Record<SourceKey, readonly string[]> = {
  jdZheshang: ["jd_zs_accumulation"],
  jdMinsheng: ["jd_ms_accumulation"],
  market: [
    "au9999",
    "london_gold",
    "new_york_gold",
    "shuibei_gold",
    "retail_store_gold",
    "bank_investment_bar",
    "gold_recycle",
  ],
  exchangeRate: [],
};

export function isCompletePayload<TQuote extends { id: string }>(payload: FallbackPayload<TQuote>): boolean {
  return (Object.keys(sourceQuoteIds) as SourceKey[]).every((source) => sourceIsComplete(payload, source));
}

export function mergeWithFallback<
  TQuote extends { id: string },
  TPayload extends FallbackPayload<TQuote>,
>(current: TPayload, fallback: TPayload): TPayload {
  const quotes = [...current.quotes];
  const quoteIds = new Set(quotes.map((quote) => quote.id));
  const staleSources: SourceKey[] = [];
  let exchangeRates = current.exchangeRates;

  for (const source of Object.keys(sourceQuoteIds) as SourceKey[]) {
    if (sourceIsComplete(current, source)) continue;
    if (source === "exchangeRate") {
      if (fallback.exchangeRates) {
        exchangeRates = fallback.exchangeRates;
        staleSources.push(source);
      }
      continue;
    }
    let recovered = false;
    for (const quote of fallback.quotes) {
      if (!sourceQuoteIds[source].includes(quote.id) || quoteIds.has(quote.id)) continue;
      quotes.push(quote);
      quoteIds.add(quote.id);
      recovered = true;
    }
    if (recovered) staleSources.push(source);
  }

  return {
    ...current,
    success: quotes.length > 0,
    stale: staleSources.length > 0,
    staleSources,
    quotes,
    exchangeRates,
  };
}

function sourceIsComplete<TQuote extends { id: string }>(payload: FallbackPayload<TQuote>, source: SourceKey): boolean {
  if (!payload.sources[source].ok) return false;
  if (source === "exchangeRate") {
    return typeof payload.exchangeRates?.usdCny === "number" && payload.exchangeRates.usdCny > 0;
  }
  const quoteIds = new Set(payload.quotes.map((quote) => quote.id));
  return sourceQuoteIds[source].every((id) => quoteIds.has(id));
}
