import { isCompletePayload, mergeWithFallback, type SourceKey } from "./fallback.ts";

const JD_BASE_URL =
  "https://api.jdjygold.com/gw2/generic/jrm/h5/m/stdLatestPrice?productSku=";
const MARKET_URL = "https://60s.pixidou.com/v2/gold-price";

const FRESH_TTL_SECONDS = 5;
const FALLBACK_TTL_SECONDS = 300;
const UPSTREAM_TIMEOUT_MS = 15_000;

type QuoteCategory = "accumulation" | "domestic" | "international" | "retail";

interface Quote {
  id: string;
  name: string;
  category: QuoteCategory;
  price: number;
  unit: string;
  sellPrice?: number;
  yesterdayPrice?: number;
  changeAmount?: number;
  changePercent?: number;
  high?: number;
  low?: number;
  sourceTime?: number;
  aggregation?: QuoteAggregation;
}

interface QuoteSample {
  name: string;
  price: number;
}

interface QuoteAggregation {
  method: "median";
  sampleCount: number;
  min: number;
  max: number;
  samples: QuoteSample[];
}

interface SourceStatus {
  ok: boolean;
  sourceTime?: number;
  error?: string;
}

interface GoldApiPayload {
  success: boolean;
  fetchedAt: number;
  stale: boolean;
  staleSources?: SourceKey[];
  quotes: Quote[];
  sources: {
    jdZheshang: SourceStatus;
    jdMinsheng: SourceStatus;
    market: SourceStatus;
  };
}

interface JdResponse {
  success?: boolean;
  resultData?: {
    status?: string;
    datas?: {
      price?: string;
      yesterdayPrice?: string;
      upAndDownAmt?: string;
      upAndDownRate?: string;
      time?: string;
    };
  };
}

interface MarketMetal {
  name?: string;
  sell_price?: string;
  today_price?: string;
  high_price?: string;
  low_price?: string;
  unit?: string;
  updated_at?: number;
}

interface MarketStore {
  brand?: string;
  product?: string;
  price?: string;
  unit?: string;
  updated_at?: number;
}

interface MarketBank {
  bank?: string;
  product?: string;
  price?: string;
  unit?: string;
  updated_at?: number;
}

interface MarketRecycle {
  type?: string;
  price?: string;
  unit?: string;
  purity?: string;
  updated_at?: number;
}

interface MarketResponse {
  code?: number;
  data?: {
    metals?: MarketMetal[];
    stores?: MarketStore[];
    banks?: MarketBank[];
    recycle?: MarketRecycle[];
  };
}

const jdDefinitions = [
  { sku: "1961543816", id: "jd_zs_accumulation", name: "京东金融浙商积存金" },
  { sku: "21001001000001", id: "jd_ms_accumulation", name: "京东金融民生积存金" },
] as const;

const representativeStores = [
  "周大福",
  "老凤祥",
  "老庙黄金",
  "周生生",
  "六福珠宝",
  "菜百首饰",
  "中国黄金",
  "周大生",
] as const;

const representativeBanks = [
  "工商银行",
  "中国银行",
  "建设银行",
  "农业银行",
  "民生银行",
] as const;

const metalDefinitions = [
  { sourceName: "黄金_9999", id: "au9999", name: "Au99.99", category: "domestic" },
  {
    sourceName: "伦敦金(现货黄金)",
    id: "london_gold",
    name: "伦敦现货黄金",
    category: "international",
  },
  {
    sourceName: "纽约黄金(美国)",
    id: "new_york_gold",
    name: "纽约黄金",
    category: "international",
  },
] as const;

export default {
  async fetch(request: Request, _env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return corsPreflightResponse();
    if (request.method !== "GET") return jsonResponse({ error: "Method not allowed" }, 405);

    if (url.pathname === "/health") {
      return jsonResponse({ success: true, service: "gold-api", time: Date.now() });
    }

    if (url.pathname !== "/v1/quotes") {
      return jsonResponse({
        service: "gold-api",
        endpoint: "/v1/quotes",
        refreshSeconds: 10,
        cacheSeconds: FRESH_TTL_SECONDS,
      });
    }

    const cache = caches.default;
    const freshKey = cacheKey(request, "fresh");
    const fallbackKey = cacheKey(request, "fallback");
    const bypassCache = url.searchParams.get("refresh") === "1";

    if (!bypassCache) {
      const cached = await cache.match(freshKey);
      if (cached) return withClientHeaders(cached, "HIT");
    }

    const fetchedPayload = await fetchQuotes();
    let fallbackPayload: GoldApiPayload | undefined;
    let payload = fetchedPayload;

    if (!isCompletePayload(fetchedPayload)) {
      const fallbackResponse = await cache.match(fallbackKey);
      if (fallbackResponse) {
        fallbackPayload = (await fallbackResponse.json()) as GoldApiPayload;
        payload = mergeWithFallback(fetchedPayload, fallbackPayload);
      }
    }

    if (payload.quotes.length > 0) {
      const freshResponse = cacheResponse(payload, FRESH_TTL_SECONDS);
      const cacheWrites = [cache.put(freshKey, freshResponse)];
      if (isCompletePayload(fetchedPayload)) {
        cacheWrites.push(cache.put(fallbackKey, cacheResponse(fetchedPayload, FALLBACK_TTL_SECONDS)));
      }
      ctx.waitUntil(
        Promise.all(cacheWrites).then(() => undefined),
      );
      return jsonResponse(payload, 200, { "X-Gold-Cache": "MISS" });
    }

    if (fallbackPayload) {
      const stalePayload = mergeWithFallback(fetchedPayload, fallbackPayload);
      return jsonResponse(stalePayload, 200, { "X-Gold-Cache": "STALE" });
    }

    return jsonResponse(payload, 502, { "X-Gold-Cache": "MISS" });
  },
} satisfies ExportedHandler<Env>;

async function fetchQuotes(): Promise<GoldApiPayload> {
  const fetchedAt = Date.now();
  const [jdZheshangResult, jdMinshengResult, marketResult] = await Promise.allSettled([
    fetchJson<JdResponse>(`${JD_BASE_URL}${jdDefinitions[0].sku}`),
    fetchJson<JdResponse>(`${JD_BASE_URL}${jdDefinitions[1].sku}`),
    fetchJsonWithRetry<MarketResponse>(MARKET_URL),
  ]);

  const quotes: Quote[] = [];
  const sources = {
    jdZheshang: sourceFailure(jdZheshangResult),
    jdMinsheng: sourceFailure(jdMinshengResult),
    market: sourceFailure(marketResult),
  };

  sources.jdZheshang = appendJdQuote(jdZheshangResult, jdDefinitions[0], quotes);
  sources.jdMinsheng = appendJdQuote(jdMinshengResult, jdDefinitions[1], quotes);

  if (marketResult.status === "fulfilled") {
    const market = marketResult.value;
    if (market.code === 200 && market.data) {
      for (const definition of metalDefinitions) {
        const metal = market.data.metals?.find((item) => item.name === definition.sourceName);
        const price = toNumber(metal?.today_price);
        if (!metal || price === undefined) continue;
        quotes.push({
          id: definition.id,
          name: definition.name,
          category: definition.category,
          price,
          sellPrice: toNumber(metal.sell_price),
          high: toNumber(metal.high_price),
          low: toNumber(metal.low_price),
          unit: metal.unit ?? "",
          sourceTime: metal.updated_at,
        });
      }

      const shuibei = market.data.stores?.find((item) => item.brand === "水贝黄金");
      const shuibeiPrice = toNumber(shuibei?.price);
      if (shuibei && shuibeiPrice !== undefined) {
        quotes.push({
          id: "shuibei_gold",
          name: "水贝黄金",
          category: "retail",
          price: shuibeiPrice,
          unit: shuibei.unit ?? "元/克",
          sourceTime: shuibei.updated_at,
        });
      }

      const storeSamples = representativeStores.flatMap((brand) => {
        const item = market.data?.stores?.find((store) => store.brand === brand && store.product === "黄金");
        const price = toNumber(item?.price);
        return price === undefined ? [] : [{ name: brand, price, sourceTime: item?.updated_at }];
      });
      const storeAggregation = medianAggregation(storeSamples);
      if (storeAggregation) {
        quotes.push({
          id: "retail_store_gold",
          name: "门店黄金",
          category: "retail",
          price: median(storeSamples.map((sample) => sample.price)),
          unit: "元/克",
          sourceTime: latestSafeTime(storeSamples.map((sample) => sample.sourceTime), fetchedAt),
          aggregation: storeAggregation,
        });
      }

      const bankSamples = representativeBanks.flatMap((bank) => {
        const item = market.data?.banks?.find((entry) => entry.bank === bank && entry.product?.includes("金条"));
        const price = toNumber(item?.price);
        return price === undefined ? [] : [{ name: bank, price, sourceTime: item?.updated_at }];
      });
      const bankAggregation = medianAggregation(bankSamples);
      if (bankAggregation) {
        quotes.push({
          id: "bank_investment_bar",
          name: "银行投资金条",
          category: "retail",
          price: median(bankSamples.map((sample) => sample.price)),
          unit: "元/克",
          sourceTime: latestSafeTime(bankSamples.map((sample) => sample.sourceTime), fetchedAt),
          aggregation: bankAggregation,
        });
      }

      const recycle = market.data.recycle?.find((item) => item.type === "黄金回收");
      const recyclePrice = toNumber(recycle?.price);
      if (recycle && recyclePrice !== undefined) {
        quotes.push({
          id: "gold_recycle",
          name: "黄金回收",
          category: "retail",
          price: recyclePrice,
          unit: recycle.unit ?? "元/克",
          sourceTime: safeSourceTime(recycle.updated_at, fetchedAt),
        });
      }

      const marketTimes = quotes
        .filter((quote) => !quote.id.startsWith("jd_"))
        .map((quote) => quote.sourceTime)
        .filter((time): time is number => typeof time === "number");
      sources.market = { ok: true, sourceTime: Math.max(...marketTimes, 0) || undefined };
    } else {
      sources.market = { ok: false, error: "Invalid market response" };
    }
  }

  return {
    success: quotes.length > 0,
    fetchedAt,
    stale: false,
    quotes,
    sources,
  };
}

function appendJdQuote(
  result: PromiseSettledResult<JdResponse>,
  definition: (typeof jdDefinitions)[number],
  quotes: Quote[],
): SourceStatus {
  if (result.status === "rejected") return { ok: false, error: errorMessage(result.reason) };
  const data = result.value.resultData?.datas;
  const price = toNumber(data?.price);
  if (!result.value.success || !data || price === undefined) {
    return { ok: false, error: "Invalid JD response" };
  }
  const sourceTime = toNumber(data.time);
  quotes.push({
    id: definition.id,
    name: definition.name,
    category: "accumulation",
    price,
    unit: "元/克",
    yesterdayPrice: toNumber(data.yesterdayPrice),
    changeAmount: toNumber(data.upAndDownAmt),
    changePercent: toPercent(data.upAndDownRate),
    sourceTime,
  });
  return { ok: true, sourceTime };
}

function medianAggregation(samples: Array<{ name: string; price: number }>): QuoteAggregation | undefined {
  if (samples.length < 3) return undefined;
  const prices = samples.map((sample) => sample.price);
  return {
    method: "median",
    sampleCount: samples.length,
    min: Math.min(...prices),
    max: Math.max(...prices),
    samples: samples.map(({ name, price }) => ({ name, price })),
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function latestSafeTime(values: Array<number | undefined>, fetchedAt: number): number {
  const safeValues = values
    .map((value) => safeSourceTime(value, fetchedAt))
    .filter((value): value is number => value !== undefined);
  return safeValues.length > 0 ? Math.max(...safeValues) : fetchedAt;
}

function safeSourceTime(value: number | undefined, fetchedAt: number): number | undefined {
  if (!value || value > fetchedAt + 5 * 60 * 1_000) return fetchedAt;
  return value;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "gold-api/0.1" },
    cache: "no-store",
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Upstream HTTP ${response.status}`);
  return (await response.json()) as T;
}

async function fetchJsonWithRetry<T>(url: string): Promise<T> {
  try {
    return await fetchJson<T>(url);
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 300));
    return fetchJson<T>(url);
  }
}

function sourceFailure<T>(result: PromiseSettledResult<T>): SourceStatus {
  if (result.status === "fulfilled") return { ok: false, error: "Invalid response" };
  return { ok: false, error: errorMessage(result.reason) };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown upstream error";
}

function toNumber(value: string | number | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toPercent(value: string | undefined): number | undefined {
  if (!value) return undefined;
  return toNumber(value.replace("%", ""));
}

function cacheKey(request: Request, kind: "fresh" | "fallback"): Request {
  const url = new URL(request.url);
  url.pathname = `/__gold_api_cache/${kind}`;
  url.search = "";
  return new Request(url.toString(), { method: "GET" });
}

function cacheResponse(payload: GoldApiPayload, ttl: number): Response {
  return new Response(JSON.stringify(payload), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=${ttl}`,
      ...corsHeaders(),
    },
  });
}

function withClientHeaders(response: Response, cacheStatus: string): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Gold-Cache", cacheStatus);
  return new Response(response.body, { status: response.status, headers });
}

function jsonResponse(
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders(),
      ...extraHeaders,
    },
  });
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function corsPreflightResponse(): Response {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
