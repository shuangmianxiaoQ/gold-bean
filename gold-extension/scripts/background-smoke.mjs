const data = {};
const syncData = {};
const now = Date.now();
data.extensionSettings = {
  refreshInterval: 60,
  badgeQuoteId: "gold_recycle",
  hiddenQuoteIds: [],
};
data.quoteHistory = {
  jd_zs_accumulation: [
    { time: now - 8 * 24 * 60 * 60_000, price: 800 },
    { time: now - 2 * 24 * 60 * 60_000, price: 850 },
  ],
};
data.holdingTransactions = [{
  id: "holding-1",
  quoteId: "jd_zs_accumulation",
  quoteName: "京东金融浙商积存金",
  type: "buy",
  grams: 1,
  price: 1,
  createdAt: Date.now() - 1_000,
}];
data.priceAlerts = [{
  id: "cost-alert-1",
  quoteId: "jd_zs_accumulation",
  quoteName: "京东金融浙商积存金",
  direction: "above",
  threshold: -100,
  kind: "costPercent",
  intent: "costChange",
  notifyMode: "once",
  enabled: true,
  conditionMet: false,
  createdAt: Date.now(),
}];
const events = {
  installed: [],
  startup: [],
  alarm: [],
  message: [],
  changed: [],
  notificationClicked: [],
};

function event(name) {
  return {
    addListener(listener) {
      events[name].push(listener);
    },
  };
}

globalThis.chrome = {
  runtime: {
    onInstalled: event("installed"),
    onStartup: event("startup"),
    onMessage: event("message"),
  },
  alarms: {
    onAlarm: event("alarm"),
    async get() { return undefined; },
    async create(name, options) { data.alarm = { name, ...options }; },
  },
  storage: {
    local: {
      async get(keys) {
        const list = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(list.filter((key) => key in data).map((key) => [key, data[key]]));
      },
      async set(values) {
        Object.assign(data, values);
      },
    },
    sync: {
      async get(keys) {
        const list = keys === null ? Object.keys(syncData) : Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(list.filter((key) => key in syncData).map((key) => [key, syncData[key]]));
      },
      async set(values) {
        Object.assign(syncData, values);
      },
      async remove(keys) {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete syncData[key];
      },
    },
    onChanged: event("changed"),
  },
  action: {
    async setBadgeText(value) { data.badgeText = value.text; },
    async setBadgeBackgroundColor(value) { data.badgeColor = value.color; },
    async setTitle(value) { data.title = value.title; },
    async openPopup() {},
  },
  notifications: {
    onClicked: event("notificationClicked"),
    async create(id, options) { data.notification = { id, options }; },
  },
};

await import("../dist/assets/background.js");
await events.installed[0]();

for (let attempt = 0; attempt < 30 && !data.quoteSnapshot; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 500));
}
for (let attempt = 0; attempt < 30 && !data.quoteHistory.jd_zs_accumulation?.some((point) => point.time % 60_000 === 0); attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 500));
}

if (!data.quoteSnapshot?.success) throw new Error("Background refresh did not store a valid snapshot");
if (data.quoteSnapshot.quotes.length < 9) throw new Error("Expected nine aggregated quotes");
if (data.badgeText === undefined) throw new Error("Badge was not updated");
if (!data.title?.startsWith("京东金融浙商积存金")) throw new Error("Unsupported physical badge selection was not migrated");
if (data.alarm?.periodInMinutes !== 0.5) throw new Error("Background alarm is not set to 30 seconds");
const retainedHistory = data.quoteHistory.jd_zs_accumulation;
if (retainedHistory.some((point) => point.time < now - 7 * 24 * 60 * 60_000)) throw new Error("History older than seven days was retained");
if (!retainedHistory.some((point) => point.price === 850)) throw new Error("History from the previous seven days was lost");
if (!retainedHistory.some((point) => point.time % 60_000 === 0)) throw new Error("Server history was not restored");
if (!data.notification) throw new Error("Cost-based alert did not create a notification");
if (!data.priceAlerts[0]?.completed || data.priceAlerts[0]?.enabled) throw new Error("One-time alert was not completed");
if (!syncData.goldBeanSyncManifest) throw new Error("Personal data was not mirrored to Chrome Sync");

const offlinePoint = { time: Date.now() - 60_000, price: 123.45 };
data.quoteHistory.offline_only = [offlinePoint];
const nativeFetch = globalThis.fetch;
let offlineHistoryAttempted = false;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  if (url.includes("/v1/history")) {
    offlineHistoryAttempted = true;
    return Promise.reject(new Error("offline"));
  }
  return nativeFetch(input, init);
};
events.startup[0]();
for (let attempt = 0; attempt < 30 && !offlineHistoryAttempted; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 500));
}
globalThis.fetch = nativeFetch;
if (data.quoteHistory.offline_only?.[0]?.price !== offlinePoint.price) {
  throw new Error("Local history was lost when the server endpoint was unavailable");
}

const dailyQuoteIds = new Set(["shuibei_gold", "retail_store_gold", "bank_investment_bar", "gold_recycle"]);
const dayMs = 24 * 60 * 60_000;
const chinaOffsetMs = 8 * 60 * 60_000;
for (const [quoteId, points] of Object.entries(data.quoteHistory)) {
  const buckets = points.map((point) => dailyQuoteIds.has(quoteId)
    ? Math.floor((point.time + chinaOffsetMs) / dayMs) * dayMs - chinaOffsetMs
    : Math.floor(point.time / 60_000) * 60_000);
  if (new Set(buckets).size !== buckets.length) {
    throw new Error(`Duplicate history bucket for ${quoteId}`);
  }
}

console.log(JSON.stringify({
  quoteCount: data.quoteSnapshot.quotes.length,
  badgeText: data.badgeText,
  badgeColor: data.badgeColor,
  alarmMinutes: data.alarm.periodInMinutes,
  title: data.title,
  costAlertCompleted: data.priceAlerts[0].completed,
  serverHistoryRestored: true,
  offlineHistoryPreserved: true,
}, null, 2));
