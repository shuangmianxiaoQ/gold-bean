const data = {};
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
    async create() {},
  },
};

await import("../dist/assets/background.js");
await events.installed[0]();

for (let attempt = 0; attempt < 30 && !data.quoteSnapshot; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 500));
}

if (!data.quoteSnapshot?.success) throw new Error("Background refresh did not store a valid snapshot");
if (data.quoteSnapshot.quotes.length < 6) throw new Error("Expected six aggregated quotes");
if (data.badgeText === undefined) throw new Error("Badge was not updated");
if (data.alarm?.periodInMinutes !== 0.5) throw new Error("Background alarm is not set to 30 seconds");

console.log(JSON.stringify({
  quoteCount: data.quoteSnapshot.quotes.length,
  badgeText: data.badgeText,
  badgeColor: data.badgeColor,
  alarmMinutes: data.alarm.periodInMinutes,
  title: data.title,
}, null, 2));
