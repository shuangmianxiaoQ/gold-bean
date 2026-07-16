import type {
  ExtensionSettings,
  HoldingTransaction,
  PersonalData,
  PriceAlert,
  QuoteHistory,
  QuoteSnapshot,
  SyncStatus,
} from "./types.ts";
import { DEFAULT_SETTINGS } from "./types.ts";

export const STORAGE_KEYS = {
  snapshot: "quoteSnapshot",
  history: "quoteHistory",
  settings: "extensionSettings",
  alerts: "priceAlerts",
  transactions: "holdingTransactions",
  personalMeta: "personalDataMeta",
  syncStatus: "personalSyncStatus",
} as const;

const SYNC_KEYS = {
  manifest: "goldBeanSyncManifest",
  alertsPrefix: "goldBeanSyncAlerts",
  transactionsPrefix: "goldBeanSyncTransactions",
} as const;

const SYNC_SCHEMA_VERSION = 1;
const SYNC_CHUNK_BYTES = 7_000;

interface PersonalMeta {
  updatedAt: number;
}

interface SyncManifest {
  version: 1;
  updatedAt: number;
  settings: ExtensionSettings;
  alertChunks: number;
  transactionChunks: number;
}

let syncQueue: Promise<void> = Promise.resolve();

export async function getSnapshot(): Promise<QuoteSnapshot | null> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.snapshot);
  return (result[STORAGE_KEYS.snapshot] as QuoteSnapshot | undefined) ?? null;
}

export async function getHistory(): Promise<QuoteHistory> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.history);
  return (result[STORAGE_KEYS.history] as QuoteHistory | undefined) ?? {};
}

export async function getSettings(): Promise<ExtensionSettings> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.settings);
  return normalizeSettings(result[STORAGE_KEYS.settings] as Partial<ExtensionSettings> | undefined);
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await savePersonalField(STORAGE_KEYS.settings, settings);
}

export async function getAlerts(): Promise<PriceAlert[]> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.alerts);
  return (result[STORAGE_KEYS.alerts] as PriceAlert[] | undefined) ?? [];
}

export async function saveAlerts(alerts: PriceAlert[]): Promise<void> {
  await savePersonalField(STORAGE_KEYS.alerts, alerts);
}

export async function getTransactions(): Promise<HoldingTransaction[]> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.transactions);
  return (result[STORAGE_KEYS.transactions] as HoldingTransaction[] | undefined) ?? [];
}

export async function saveTransactions(transactions: HoldingTransaction[]): Promise<void> {
  await savePersonalField(STORAGE_KEYS.transactions, transactions);
}

export async function getPersonalData(): Promise<PersonalData> {
  const result = await chrome.storage.local.get([
    STORAGE_KEYS.settings,
    STORAGE_KEYS.alerts,
    STORAGE_KEYS.transactions,
  ]);
  return {
    settings: normalizeSettings(result[STORAGE_KEYS.settings] as Partial<ExtensionSettings> | undefined),
    alerts: (result[STORAGE_KEYS.alerts] as PriceAlert[] | undefined) ?? [],
    transactions: (result[STORAGE_KEYS.transactions] as HoldingTransaction[] | undefined) ?? [],
  };
}

export async function getSyncStatus(): Promise<SyncStatus> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.syncStatus);
  return (result[STORAGE_KEYS.syncStatus] as SyncStatus | undefined) ?? { state: "idle" };
}

export async function restorePersonalData(data: PersonalData, mode: "merge" | "replace"): Promise<void> {
  const current = await getPersonalData();
  const next = mode === "replace" ? data : {
    settings: current.settings,
    alerts: mergeById(data.alerts, current.alerts),
    transactions: mergeById(data.transactions, current.transactions),
  };
  const updatedAt = Date.now();
  await chrome.storage.local.set({
    [STORAGE_KEYS.settings]: next.settings,
    [STORAGE_KEYS.alerts]: next.alerts,
    [STORAGE_KEYS.transactions]: next.transactions,
    [STORAGE_KEYS.personalMeta]: { updatedAt } satisfies PersonalMeta,
  });
  await pushPersonalDataToSync();
}

export async function reconcilePersonalSync(): Promise<void> {
  return enqueueSync(async () => {
    await setSyncStatus({ state: "syncing" });
    try {
      const [localData, localState, remoteState] = await Promise.all([
        getPersonalData(),
        chrome.storage.local.get(STORAGE_KEYS.personalMeta),
        chrome.storage.sync.get(SYNC_KEYS.manifest),
      ]);
      const localMeta = localState[STORAGE_KEYS.personalMeta] as PersonalMeta | undefined;
      const remoteManifest = remoteState[SYNC_KEYS.manifest] as SyncManifest | undefined;

      if (!remoteManifest) {
        const updatedAt = localMeta?.updatedAt ?? Date.now();
        await chrome.storage.local.set({ [STORAGE_KEYS.personalMeta]: { updatedAt } satisfies PersonalMeta });
        await writeSyncData(localData, updatedAt);
        return;
      }

      if (!localMeta) {
        if (hasMeaningfulData(localData)) {
          const remoteData = await readSyncData(remoteManifest);
          const merged: PersonalData = {
            settings: localData.settings,
            alerts: mergeById(remoteData.alerts, localData.alerts),
            transactions: mergeById(remoteData.transactions, localData.transactions),
          };
          const updatedAt = Date.now();
          await writeLocalPersonalData(merged, updatedAt);
          await writeSyncData(merged, updatedAt);
        } else {
          await writeLocalPersonalData(await readSyncData(remoteManifest), remoteManifest.updatedAt);
          await setSyncStatus({ state: "synced", lastSyncedAt: remoteManifest.updatedAt });
        }
        return;
      }

      if (remoteManifest.updatedAt > localMeta.updatedAt) {
        await writeLocalPersonalData(await readSyncData(remoteManifest), remoteManifest.updatedAt);
        await setSyncStatus({ state: "synced", lastSyncedAt: remoteManifest.updatedAt });
      } else if (localMeta.updatedAt > remoteManifest.updatedAt) {
        await writeSyncData(localData, localMeta.updatedAt);
      } else {
        await setSyncStatus({ state: "synced", lastSyncedAt: localMeta.updatedAt });
      }
    } catch (error) {
      await setSyncStatus({ state: "error", error: errorMessage(error) });
    }
  });
}

export async function applyRemoteSyncIfNewer(): Promise<void> {
  return enqueueSync(async () => {
    try {
      const [localState, remoteState] = await Promise.all([
        chrome.storage.local.get(STORAGE_KEYS.personalMeta),
        chrome.storage.sync.get(SYNC_KEYS.manifest),
      ]);
      const localMeta = localState[STORAGE_KEYS.personalMeta] as PersonalMeta | undefined;
      const remoteManifest = remoteState[SYNC_KEYS.manifest] as SyncManifest | undefined;
      if (!remoteManifest || (localMeta && remoteManifest.updatedAt <= localMeta.updatedAt)) return;
      await writeLocalPersonalData(await readSyncData(remoteManifest), remoteManifest.updatedAt);
      await setSyncStatus({ state: "synced", lastSyncedAt: remoteManifest.updatedAt });
    } catch (error) {
      await setSyncStatus({ state: "error", error: errorMessage(error) });
    }
  });
}

export async function initializeStorage(): Promise<void> {
  const result = await chrome.storage.local.get([
    STORAGE_KEYS.settings,
    STORAGE_KEYS.history,
    STORAGE_KEYS.alerts,
    STORAGE_KEYS.transactions,
  ]);
  const initial: Record<string, unknown> = {};
  if (!result[STORAGE_KEYS.settings]) initial[STORAGE_KEYS.settings] = DEFAULT_SETTINGS;
  if (!result[STORAGE_KEYS.history]) initial[STORAGE_KEYS.history] = {};
  if (!result[STORAGE_KEYS.alerts]) initial[STORAGE_KEYS.alerts] = [];
  if (!result[STORAGE_KEYS.transactions]) initial[STORAGE_KEYS.transactions] = [];
  if (Object.keys(initial).length > 0) await chrome.storage.local.set(initial);
  await reconcilePersonalSync();
}

async function savePersonalField(key: string, value: unknown): Promise<void> {
  const updatedAt = Date.now();
  await chrome.storage.local.set({
    [key]: value,
    [STORAGE_KEYS.personalMeta]: { updatedAt } satisfies PersonalMeta,
  });
  await pushPersonalDataToSync();
}

async function pushPersonalDataToSync(): Promise<void> {
  return enqueueSync(async () => {
    await setSyncStatus({ state: "syncing" });
    try {
      const [data, state] = await Promise.all([
        getPersonalData(),
        chrome.storage.local.get(STORAGE_KEYS.personalMeta),
      ]);
      const updatedAt = (state[STORAGE_KEYS.personalMeta] as PersonalMeta | undefined)?.updatedAt ?? Date.now();
      await writeSyncData(data, updatedAt);
    } catch (error) {
      await setSyncStatus({ state: "error", error: errorMessage(error) });
    }
  });
}

async function writeSyncData(data: PersonalData, updatedAt: number): Promise<void> {
  const alertChunks = chunkItems(data.alerts);
  const transactionChunks = chunkItems(data.transactions);
  const previous = await chrome.storage.sync.get(SYNC_KEYS.manifest);
  const previousManifest = previous[SYNC_KEYS.manifest] as SyncManifest | undefined;
  const chunkValues: Record<string, unknown> = {};
  alertChunks.forEach((chunk, index) => { chunkValues[`${SYNC_KEYS.alertsPrefix}${index}`] = chunk; });
  transactionChunks.forEach((chunk, index) => { chunkValues[`${SYNC_KEYS.transactionsPrefix}${index}`] = chunk; });
  if (Object.keys(chunkValues).length > 0) await chrome.storage.sync.set(chunkValues);
  const manifest: SyncManifest = {
    version: SYNC_SCHEMA_VERSION,
    updatedAt,
    settings: data.settings,
    alertChunks: alertChunks.length,
    transactionChunks: transactionChunks.length,
  };
  await chrome.storage.sync.set({ [SYNC_KEYS.manifest]: manifest });
  const staleKeys = [
    ...staleChunkKeys(SYNC_KEYS.alertsPrefix, alertChunks.length, previousManifest?.alertChunks ?? 0),
    ...staleChunkKeys(SYNC_KEYS.transactionsPrefix, transactionChunks.length, previousManifest?.transactionChunks ?? 0),
  ];
  if (staleKeys.length > 0) await chrome.storage.sync.remove(staleKeys);
  await setSyncStatus({ state: "synced", lastSyncedAt: updatedAt });
}

async function readSyncData(manifest: SyncManifest): Promise<PersonalData> {
  if (manifest.version !== SYNC_SCHEMA_VERSION) throw new Error("同步数据版本暂不支持");
  const alertKeys = Array.from({ length: manifest.alertChunks }, (_, index) => `${SYNC_KEYS.alertsPrefix}${index}`);
  const transactionKeys = Array.from({ length: manifest.transactionChunks }, (_, index) => `${SYNC_KEYS.transactionsPrefix}${index}`);
  const result = await chrome.storage.sync.get([...alertKeys, ...transactionKeys]);
  return {
    settings: normalizeSettings(manifest.settings),
    alerts: alertKeys.flatMap((key) => (result[key] as PriceAlert[] | undefined) ?? []),
    transactions: transactionKeys.flatMap((key) => (result[key] as HoldingTransaction[] | undefined) ?? []),
  };
}

const excludedBadgeQuoteIds = new Set([
  "retail_store_gold",
  "bank_investment_bar",
  "shuibei_gold",
  "gold_recycle",
]);

function normalizeSettings(value?: Partial<ExtensionSettings>): ExtensionSettings {
  const settings = { ...DEFAULT_SETTINGS, ...(value ?? {}) };
  return excludedBadgeQuoteIds.has(settings.badgeQuoteId)
    ? { ...settings, badgeQuoteId: DEFAULT_SETTINGS.badgeQuoteId }
    : settings;
}

async function writeLocalPersonalData(data: PersonalData, updatedAt: number): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEYS.settings]: data.settings,
    [STORAGE_KEYS.alerts]: data.alerts,
    [STORAGE_KEYS.transactions]: data.transactions,
    [STORAGE_KEYS.personalMeta]: { updatedAt } satisfies PersonalMeta,
  });
}

async function setSyncStatus(status: SyncStatus): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.syncStatus]: status });
}

function enqueueSync(operation: () => Promise<void>): Promise<void> {
  syncQueue = syncQueue.then(operation, operation);
  return syncQueue;
}

function chunkItems<T>(items: T[]): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  for (const item of items) {
    const candidate = [...current, item];
    if (current.length > 0 && byteLength(candidate) > SYNC_CHUNK_BYTES) {
      chunks.push(current);
      current = [item];
    } else {
      current = candidate;
    }
    if (byteLength(current) > SYNC_CHUNK_BYTES) throw new Error("单条同步数据过大");
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function staleChunkKeys(prefix: string, nextCount: number, previousCount: number): string[] {
  return Array.from({ length: Math.max(0, previousCount - nextCount) }, (_, index) => `${prefix}${nextCount + index}`);
}

function mergeById<T extends { id: string }>(imported: T[], current: T[]): T[] {
  const merged = new Map(imported.map((item) => [item.id, item]));
  current.forEach((item) => merged.set(item.id, item));
  return [...merged.values()];
}

function hasMeaningfulData(data: PersonalData): boolean {
  return data.alerts.length > 0
    || data.transactions.length > 0
    || JSON.stringify(data.settings) !== JSON.stringify(DEFAULT_SETTINGS);
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Chrome 同步暂不可用";
}
