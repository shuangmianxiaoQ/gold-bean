import type {
  ExtensionSettings,
  PriceAlert,
  QuoteHistory,
  QuoteSnapshot,
} from "./types";
import { DEFAULT_SETTINGS } from "./types";

export const STORAGE_KEYS = {
  snapshot: "quoteSnapshot",
  history: "quoteHistory",
  settings: "extensionSettings",
  alerts: "priceAlerts",
} as const;

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
  return {
    ...DEFAULT_SETTINGS,
    ...((result[STORAGE_KEYS.settings] as Partial<ExtensionSettings> | undefined) ?? {}),
  };
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: settings });
}

export async function getAlerts(): Promise<PriceAlert[]> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.alerts);
  return (result[STORAGE_KEYS.alerts] as PriceAlert[] | undefined) ?? [];
}

export async function saveAlerts(alerts: PriceAlert[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.alerts]: alerts });
}

export async function initializeStorage(): Promise<void> {
  const result = await chrome.storage.local.get([
    STORAGE_KEYS.settings,
    STORAGE_KEYS.history,
    STORAGE_KEYS.alerts,
  ]);
  const initial: Record<string, unknown> = {};
  if (!result[STORAGE_KEYS.settings]) initial[STORAGE_KEYS.settings] = DEFAULT_SETTINGS;
  if (!result[STORAGE_KEYS.history]) initial[STORAGE_KEYS.history] = {};
  if (!result[STORAGE_KEYS.alerts]) initial[STORAGE_KEYS.alerts] = [];
  if (Object.keys(initial).length > 0) await chrome.storage.local.set(initial);
}
