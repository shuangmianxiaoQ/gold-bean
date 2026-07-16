const JD_URL =
  "https://api.jdjygold.com/gw2/generic/jrm/h5/m/stdLatestPrice?productSku=1961543816";
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
  quotes: Quote[];
  sources: {
    jd: SourceStatus;
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

interface MarketResponse {
  code?: number;
  data?: {
    metals?: MarketMetal[];
    stores?: MarketStore[];
  };
}

const metalDefinitions = [
  { sourceName: "黄金_9999", id: "au9999", name: "Au99.99", category: "domestic" },
  { sourceName: "黄金_T+D", id: "autd", name: "Au(T+D)", category: "domestic" },
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

    const payload = await fetchQuotes();
    if (payload.quotes.length > 0) {
      const freshResponse = cacheResponse(payload, FRESH_TTL_SECONDS);
      const fallbackResponse = cacheResponse(payload, FALLBACK_TTL_SECONDS);
      ctx.waitUntil(
        Promise.all([
          cache.put(freshKey, freshResponse),
          cache.put(fallbackKey, fallbackResponse),
        ]).then(() => undefined),
      );
      return jsonResponse(payload, 200, { "X-Gold-Cache": "MISS" });
    }

    const fallback = await cache.match(fallbackKey);
    if (fallback) {
      const stalePayload = (await fallback.json()) as GoldApiPayload;
      stalePayload.stale = true;
      stalePayload.sources = payload.sources;
      return jsonResponse(stalePayload, 200, { "X-Gold-Cache": "STALE" });
    }

    return jsonResponse(payload, 502, { "X-Gold-Cache": "MISS" });
  },
} satisfies ExportedHandler<Env>;

async function fetchQuotes(): Promise<GoldApiPayload> {
  const fetchedAt = Date.now();
  const [jdResult, marketResult] = await Promise.allSettled([
    fetchJson<JdResponse>(JD_URL),
    fetchJson<MarketResponse>(MARKET_URL),
  ]);

  const quotes: Quote[] = [];
  const sources = {
    jd: sourceFailure(jdResult),
    market: sourceFailure(marketResult),
  };

  if (jdResult.status === "fulfilled") {
    const data = jdResult.value.resultData?.datas;
    const price = toNumber(data?.price);
    if (jdResult.value.success && data && price !== undefined) {
      const sourceTime = toNumber(data.time);
      quotes.push({
        id: "jd_zs_accumulation",
        name: "京东金融浙商积存金",
        category: "accumulation",
        price,
        unit: "元/克",
        yesterdayPrice: toNumber(data.yesterdayPrice),
        changeAmount: toNumber(data.upAndDownAmt),
        changePercent: toPercent(data.upAndDownRate),
        sourceTime,
      });
      sources.jd = { ok: true, sourceTime };
    } else {
      sources.jd = { ok: false, error: "Invalid JD response" };
    }
  }

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

      const marketTimes = quotes
        .filter((quote) => quote.id !== "jd_zs_accumulation")
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

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "gold-api/0.1" },
    cache: "no-store",
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Upstream HTTP ${response.status}`);
  return (await response.json()) as T;
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
