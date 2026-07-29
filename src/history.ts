const HISTORY_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1_000;
const MINUTE_MS = 60 * 1_000;
const CHINA_TIME_OFFSET_MS = 8 * 60 * 60 * 1_000;

interface HistoryQuote {
  id: string;
  price: number;
  sourceTime?: number;
}

interface HistoryRow {
  quote_id: string;
  sampled_at: number;
  price: number;
}

const minuteHistoryQuoteIds = [
  "jd_zs_accumulation",
  "jd_ms_accumulation",
  "au9999",
  "london_gold",
  "new_york_gold",
] as const;

const dailyHistoryQuoteIds = [
  "shuibei_gold",
  "retail_store_gold",
  "bank_investment_bar",
  "gold_recycle",
] as const;

const historyQuoteIds = [...minuteHistoryQuoteIds, ...dailyHistoryQuoteIds] as const;
const minuteHistoryQuoteIdSet = new Set<string>(minuteHistoryQuoteIds);
const dailyHistoryQuoteIdSet = new Set<string>(dailyHistoryQuoteIds);
const historyQuoteIdSet = new Set<string>(historyQuoteIds);

export async function historyResponse(url: URL, db: D1Database): Promise<Response> {
  const quoteId = url.searchParams.get("quoteId");
  if (quoteId && !historyQuoteIdSet.has(quoteId)) {
    return jsonResponse({ success: false, error: "Unknown quoteId" }, 400);
  }

  const daysValue = url.searchParams.get("days") ?? "7";
  if (!/^\d+$/.test(daysValue)) {
    return jsonResponse({ success: false, error: "days must be an integer from 1 to 30" }, 400);
  }
  const days = Number.parseInt(daysValue, 10);
  if (days < 1 || days > HISTORY_RETENTION_DAYS) {
    return jsonResponse({ success: false, error: "days must be an integer from 1 to 30" }, 400);
  }

  const ids = quoteId ? [quoteId] : [...historyQuoteIds];
  const to = Date.now();
  const from = to - days * DAY_MS;
  const placeholders = ids.map(() => "?").join(", ");
  const result = await db.prepare(`
    SELECT quote_id, sampled_at, price
    FROM quote_history
    WHERE quote_id IN (${placeholders}) AND sampled_at >= ?
    ORDER BY quote_id ASC, sampled_at ASC
  `).bind(...ids, from).all<HistoryRow>();
  const history: Record<string, Array<{ time: number; price: number }>> = Object.fromEntries(
    ids.map((id) => [id, []]),
  );
  for (const row of result.results) {
    history[row.quote_id]?.push({ time: row.sampled_at, price: row.price });
  }

  return jsonResponse({
    success: true,
    from,
    to,
    retentionDays: HISTORY_RETENTION_DAYS,
    history,
  }, 200, { "Cache-Control": "public, max-age=60" });
}

export async function persistHistory(
  db: D1Database,
  quotes: HistoryQuote[],
  scheduledAt: number,
): Promise<number> {
  const minuteTimestamp = Math.floor(scheduledAt / MINUTE_MS) * MINUTE_MS;
  const dailyTimestamp = chinaDayStart(scheduledAt);
  const statements = quotes.flatMap((quote) => {
    const isMinute = minuteHistoryQuoteIdSet.has(quote.id);
    const isDaily = dailyHistoryQuoteIdSet.has(quote.id);
    if (!isMinute && !isDaily) return [];

    return [db.prepare(`
      INSERT INTO quote_history (quote_id, sampled_at, price, source_time, granularity)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (quote_id, sampled_at) DO UPDATE SET
        price = excluded.price,
        source_time = excluded.source_time
      WHERE quote_history.price <> excluded.price
    `).bind(
      quote.id,
      isMinute ? minuteTimestamp : dailyTimestamp,
      quote.price,
      quote.sourceTime ?? scheduledAt,
      isMinute ? "minute" : "daily",
    )];
  });

  if (statements.length === 0) return 0;
  const results = await db.batch(statements);
  return results.reduce((total, result) => total + (result.meta.changes ?? 0), 0);
}

export async function deleteExpiredHistory(db: D1Database, scheduledAt: number): Promise<number> {
  const cutoff = scheduledAt - HISTORY_RETENTION_DAYS * DAY_MS;
  const statements = historyQuoteIds.map((quoteId) => db
    .prepare("DELETE FROM quote_history WHERE quote_id = ? AND sampled_at < ?")
    .bind(quoteId, cutoff));
  const results = await db.batch(statements);
  return results.reduce((total, result) => total + (result.meta.changes ?? 0), 0);
}

export function chinaDayStart(timestamp: number): number {
  return Math.floor((timestamp + CHINA_TIME_OFFSET_MS) / DAY_MS) * DAY_MS - CHINA_TIME_OFFSET_MS;
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
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      ...extraHeaders,
    },
  });
}
