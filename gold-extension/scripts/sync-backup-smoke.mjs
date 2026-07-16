import { createBackupDocument, parseBackupDocument } from "../src/backup.ts";

const localData = {
  extensionSettings: { refreshInterval: 10, badgeQuoteId: "jd_zs_accumulation", hiddenQuoteIds: [] },
  priceAlerts: [],
  holdingTransactions: Array.from({ length: 80 }, (_, index) => ({
    id: `transaction-${index}`,
    quoteId: "jd_zs_accumulation",
    quoteName: "京东金融浙商积存金",
    valuationQuoteId: "jd_zs_accumulation",
    type: "buy",
    grams: 1,
    price: 800 + index,
    createdAt: index + 1,
  })),
};
const syncData = {};

function storageArea(data) {
  return {
    async get(keys) {
      const list = keys === null ? Object.keys(data) : Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((key) => key in data).map((key) => [key, data[key]]));
    },
    async set(values) { Object.assign(data, values); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; },
  };
}

globalThis.chrome = {
  storage: {
    local: storageArea(localData),
    sync: storageArea(syncData),
  },
};

const { applyRemoteSyncIfNewer, getPersonalData, initializeStorage } = await import("../src/storage.ts");
await initializeStorage();

const manifest = syncData.goldBeanSyncManifest;
if (!manifest || manifest.transactionChunks < 2) throw new Error("Expected transactions to be split into multiple sync chunks");
if (localData.personalSyncStatus?.state !== "synced") throw new Error("Expected a successful sync status");

const personal = await getPersonalData();
const backup = createBackupDocument(personal);
const parsed = parseBackupDocument(JSON.stringify(backup));
if (parsed.data.transactions.length !== 80) throw new Error("Backup did not preserve transactions");

syncData.goldBeanSyncTransactions0 = [{ ...personal.transactions[0], price: 999 }];
syncData.goldBeanSyncManifest = {
  ...manifest,
  updatedAt: manifest.updatedAt + 10_000,
  transactionChunks: 1,
};
await applyRemoteSyncIfNewer();
const restored = await getPersonalData();
if (restored.transactions.length !== 1 || restored.transactions[0].price !== 999) throw new Error("Newer remote sync data was not applied locally");

let rejectedInvalidBackup = false;
try { parseBackupDocument('{"hello":"world"}'); } catch { rejectedInvalidBackup = true; }
if (!rejectedInvalidBackup) throw new Error("Invalid backup should be rejected");

console.log(JSON.stringify({
  transactionChunks: manifest.transactionChunks,
  backupTransactions: parsed.data.transactions.length,
  remoteApplied: restored.transactions[0].price,
}, null, 2));
