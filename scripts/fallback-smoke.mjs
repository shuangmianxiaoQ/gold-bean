const { isCompletePayload, mergeWithFallback } = await import("../src/fallback.ts");

const sourcesOk = {
  jdZheshang: { ok: true },
  jdMinsheng: { ok: true },
  market: { ok: true },
};
const quoteIds = [
  "jd_zs_accumulation",
  "jd_ms_accumulation",
  "au9999",
  "london_gold",
  "new_york_gold",
  "shuibei_gold",
  "retail_store_gold",
  "bank_investment_bar",
  "gold_recycle",
];
const complete = {
  success: true,
  fetchedAt: 1,
  stale: false,
  sources: sourcesOk,
  quotes: quoteIds.map((id, index) => ({ id, name: id, category: "domestic", price: 800 + index, unit: "元/克" })),
};

if (!isCompletePayload(complete)) throw new Error("Complete payload was rejected");

const partial = {
  ...complete,
  fetchedAt: 2,
  sources: { ...sourcesOk, market: { ok: false, error: "timeout" } },
  quotes: complete.quotes.filter((quote) => quote.id.startsWith("jd_")),
};
if (isCompletePayload(partial)) throw new Error("Partial payload was accepted");

const recovered = mergeWithFallback(partial, complete);
if (recovered.quotes.length !== 9) throw new Error(`Expected 9 recovered quotes, got ${recovered.quotes.length}`);
if (!recovered.stale || recovered.staleSources?.join() !== "market") throw new Error("Market fallback was not marked stale");
if (recovered.sources.market.ok) throw new Error("Current market failure should remain observable");

const incompleteMarket = {
  ...complete,
  quotes: complete.quotes.filter((quote) => quote.id !== "gold_recycle"),
};
const recoveredMissingQuote = mergeWithFallback(incompleteMarket, complete);
if (!recoveredMissingQuote.quotes.some((quote) => quote.id === "gold_recycle")) throw new Error("Missing market quote was not recovered");
if (recoveredMissingQuote.staleSources?.join() !== "market") throw new Error("Incomplete market response was not marked stale");

console.log("Worker fallback smoke test passed");
