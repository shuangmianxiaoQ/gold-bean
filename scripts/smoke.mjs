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
