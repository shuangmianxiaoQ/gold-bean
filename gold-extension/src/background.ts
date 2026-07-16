import {
  applyRemoteSyncIfNewer,
  getAlerts,
  getHistory,
  getSettings,
  getSnapshot,
  getTransactions,
  initializeStorage,
  saveAlerts,
  STORAGE_KEYS,
} from "./storage";
import { calculatePositions } from "./holdings";
import type {
  GoldApiPayload,
  HistoryPoint,
  PriceAlert,
  PriceDirection,
  Quote,
  QuoteHistory,
  QuoteSnapshot,
  RefreshResult,
} from "./types";

const API_URL = "https://gold-api.pixidou.com/v1/quotes";
const ALARM_NAME = "refresh-gold-quotes";
const BACKGROUND_INTERVAL_MINUTES = 0.5;
const REQUEST_TIMEOUT_MS = 20_000;
const HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const MINUTE_MS = 60 * 1_000;

chrome.runtime.onInstalled.addListener(() => {
  void bootstrap();
});

chrome.runtime.onStartup.addListener(() => {
  void bootstrap();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) void refreshQuotes();
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isRefreshMessage(message)) return false;
  void refreshQuotes(message.force)
    .then(sendResponse)
    .catch((error: unknown) => sendResponse({ ok: false, error: errorMessage(error) }));
  return true;
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync") {
    void applyRemoteSyncIfNewer();
    return;
  }
  if (areaName === "local" && (changes[STORAGE_KEYS.settings] || changes[STORAGE_KEYS.snapshot])) {
    void updateBadge();
  }
});

chrome.notifications.onClicked.addListener(() => {
  void chrome.action.openPopup().catch(() => undefined);
});

async function bootstrap(): Promise<void> {
  await initializeStorage();
  await ensureAlarm();
  await refreshQuotes();
}

async function ensureAlarm(): Promise<void> {
  const existing = await chrome.alarms.get(ALARM_NAME);
  if (!existing) {
    await chrome.alarms.create(ALARM_NAME, { periodInMinutes: BACKGROUND_INTERVAL_MINUTES });
  }
}

async function refreshQuotes(force = false): Promise<RefreshResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_URL}${force ? "?refresh=1" : ""}`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`行情接口返回 ${response.status}`);

    const payload = (await response.json()) as GoldApiPayload;
    if (!payload.success || !Array.isArray(payload.quotes)) throw new Error("行情数据格式异常");

    const previousSnapshot = await getSnapshot();
    const previousPrices = Object.fromEntries(
      previousSnapshot?.quotes.map((quote) => [quote.id, quote.price]) ?? [],
    );
    const snapshot: QuoteSnapshot = { ...payload, previousPrices };
    const history = await updateHistory(payload.quotes, payload.fetchedAt);

    await chrome.storage.local.set({
      [STORAGE_KEYS.snapshot]: snapshot,
      [STORAGE_KEYS.history]: history,
    });

    await updateBadge(snapshot);
    await evaluateAlerts(payload.quotes);
    return { ok: true, snapshot };
  } catch (error) {
    await markBadgeStale(errorMessage(error));
    return { ok: false, error: errorMessage(error) };
  } finally {
    clearTimeout(timeout);
  }
}

async function updateHistory(quotes: Quote[], fetchedAt: number): Promise<QuoteHistory> {
  const history = await getHistory();
  const cutoff = fetchedAt - HISTORY_RETENTION_MS;

  for (const quote of quotes) {
    const points = (history[quote.id] ?? []).filter((point) => point.time >= cutoff);
    const last = points.at(-1);
    const isDailyQuote = quote.category === "retail";
    const shouldAppend = isDailyQuote
      ? !last || new Date(last.time).toDateString() !== new Date(fetchedAt).toDateString()
      : !last || fetchedAt - last.time >= MINUTE_MS;

    if (shouldAppend) points.push({ time: fetchedAt, price: quote.price });
    history[quote.id] = points;
  }

  return history;
}

async function evaluateAlerts(quotes: Quote[]): Promise<void> {
  const [alerts, transactions] = await Promise.all([getAlerts(), getTransactions()]);
  if (alerts.length === 0) return;
  const positions = calculatePositions(transactions);

  let changed = false;
  for (const alert of alerts) {
    if (!alert.enabled || alert.completed) continue;
    const quote = quotes.find((item) => item.id === alert.quoteId);
    if (!quote) continue;

    const kind = alert.kind ?? "price";
    const position = positions.find((item) => item.quoteId === alert.quoteId);
    if (kind === "costPercent" && !position) continue;
    const currentValue = kind === "costPercent" && position
      ? ((quote.price - position.averageCost) / position.averageCost) * 100
      : quote.price;
    const conditionMet = alert.direction === "above"
      ? currentValue >= alert.threshold
      : currentValue <= alert.threshold;

    if (conditionMet && !alert.conditionMet) {
      await notifyAlert(alert, quote, currentValue);
      alert.conditionMet = true;
      if (alert.notifyMode === "once") {
        alert.completed = true;
        alert.enabled = false;
      }
      changed = true;
    } else if (!conditionMet && alert.conditionMet) {
      alert.conditionMet = false;
      changed = true;
    }
  }

  if (changed) await saveAlerts(alerts);
}

async function notifyAlert(alert: PriceAlert, quote: Quote, currentValue: number): Promise<void> {
  if (alert.kind === "costPercent") {
    const directionText = alert.direction === "above" ? "达到收益目标" : "达到回撤提醒";
    await chrome.notifications.create(`gold-alert-${alert.id}-${Date.now()}`, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: `${quote.name} 持仓提醒`,
      message: `当前相对成本 ${formatSignedPercent(currentValue)}，已${directionText} ${formatSignedPercent(alert.threshold)}`,
      priority: 2,
    });
    return;
  }
  const directionText = alert.direction === "above" ? "达到或高于" : "达到或低于";
  const intentText = alert.intent === "buy" ? "目标买入价" : alert.intent === "takeProfit" ? "目标止盈价" : "目标价格";
  await chrome.notifications.create(`gold-alert-${alert.id}-${Date.now()}`, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: `${quote.name} 到价提醒`,
    message: `当前 ${formatPrice(quote.price)} ${quote.unit}，${intentText}已${directionText} ${formatPrice(alert.threshold)}`,
    priority: 2,
  });
}

function formatSignedPercent(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

async function updateBadge(snapshot?: QuoteSnapshot | null): Promise<void> {
  const [currentSnapshot, settings] = await Promise.all([
    snapshot === undefined ? getSnapshot() : Promise.resolve(snapshot),
    getSettings(),
  ]);
  const quote = currentSnapshot?.quotes.find((item) => item.id === settings.badgeQuoteId);
  if (!quote) return markBadgeUnavailable();

  const previousPrice = currentSnapshot?.previousPrices[quote.id];
  const direction = priceDirection(quote.price, previousPrice);
  await Promise.all([
    chrome.action.setBadgeText({ text: formatBadgePrice(quote.price) }),
    chrome.action.setBadgeBackgroundColor({ color: badgeColor(direction) }),
    chrome.action.setTitle({
      title: `${quote.name} ${formatPrice(quote.price)} ${quote.unit}\n更新于 ${formatTime(currentSnapshot?.fetchedAt)}`,
    }),
  ]);
}

async function markBadgeUnavailable(): Promise<void> {
  await Promise.all([
    chrome.action.setBadgeText({ text: "--" }),
    chrome.action.setBadgeBackgroundColor({ color: "#555A60" }),
  ]);
}

async function markBadgeStale(reason: string): Promise<void> {
  const [snapshot, settings] = await Promise.all([getSnapshot(), getSettings()]);
  const quote = snapshot?.quotes.find((item) => item.id === settings.badgeQuoteId);
  if (!quote) return markBadgeUnavailable();
  await Promise.all([
    chrome.action.setBadgeText({ text: formatBadgePrice(quote.price) }),
    chrome.action.setBadgeBackgroundColor({ color: "#555A60" }),
    chrome.action.setTitle({ title: `${quote.name} ${formatPrice(quote.price)} ${quote.unit}\n更新失败：${reason}` }),
  ]);
}

function priceDirection(current: number, previous?: number): PriceDirection {
  if (previous === undefined || current === previous) return "flat";
  return current > previous ? "up" : "down";
}

function badgeColor(direction: PriceDirection): string {
  if (direction === "up") return "#C84E57";
  if (direction === "down") return "#2F9567";
  return "#A77B2F";
}

function formatBadgePrice(price: number): string {
  return String(Math.round(price));
}

function formatPrice(price: number): string {
  return price >= 1_000 ? price.toFixed(2) : price.toFixed(2);
}

function formatTime(timestamp?: number): string {
  if (!timestamp) return "未知";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(timestamp);
}

function errorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") return "行情请求超时";
  return error instanceof Error ? error.message : "未知错误";
}

function isRefreshMessage(value: unknown): value is { type: "refreshQuotes"; force?: boolean } {
  return typeof value === "object" && value !== null && "type" in value && value.type === "refreshQuotes";
}
