class MemoryCache {
  #responses = new Map();

  async match(request) {
    return this.#responses.get(request.url)?.clone();
  }

  async put(request, response) {
    this.#responses.set(request.url, response.clone());
  }
}

Object.defineProperty(globalThis, "caches", {
  value: { default: new MemoryCache() },
  configurable: true,
});

const { default: worker } = await import("../src/index.ts");
const backgroundTasks = [];
const ctx = {
  waitUntil(promise) {
    backgroundTasks.push(promise);
  },
};

const response = await worker.fetch(
  new Request("https://gold-api.test/v1/quotes?refresh=1"),
  {},
  ctx,
);
const payload = await response.json();
await Promise.all(backgroundTasks);
console.log(JSON.stringify(payload, null, 2));

if (!response.ok || !payload.success) process.exitCode = 1;
if (payload.quotes?.length !== 9) throw new Error(`Expected 9 quotes, got ${payload.quotes?.length}`);
if (payload.quotes.some((quote) => quote.id === "autd")) throw new Error("Au(T+D) should not be returned");
const retail = payload.quotes.find((quote) => quote.id === "retail_store_gold");
if (retail?.aggregation?.sampleCount !== 8 || retail.aggregation.samples?.length !== 8) throw new Error("Expected 8 retail store samples");
const bank = payload.quotes.find((quote) => quote.id === "bank_investment_bar");
if (bank?.aggregation?.sampleCount !== 5 || bank.aggregation.samples?.length !== 5) throw new Error("Expected 5 bank samples");
