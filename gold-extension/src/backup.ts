import type {
  BackupDocument,
  ExtensionSettings,
  HoldingTransaction,
  PersonalData,
  PriceAlert,
} from "./types.ts";
import { DEFAULT_SETTINGS } from "./types.ts";

export function createBackupDocument(data: PersonalData): BackupDocument {
  return {
    format: "gold-bean-backup",
    version: 1,
    appVersion: "0.4.2",
    exportedAt: Date.now(),
    data,
  };
}

export function parseBackupDocument(text: string): BackupDocument {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("文件不是有效的 JSON 备份");
  }
  if (!isRecord(value) || value.format !== "gold-bean-backup" || value.version !== 1 || !isRecord(value.data)) {
    throw new Error("不是金豆行情备份文件，或版本暂不支持");
  }
  const data = value.data;
  if (!isSettings(data.settings) || !Array.isArray(data.alerts) || !data.alerts.every(isAlert)
    || !Array.isArray(data.transactions) || !data.transactions.every(isTransaction)) {
    throw new Error("备份内容不完整或格式错误");
  }
  return {
    format: "gold-bean-backup",
    version: 1,
    appVersion: typeof value.appVersion === "string" ? value.appVersion : "unknown",
    exportedAt: typeof value.exportedAt === "number" ? value.exportedAt : Date.now(),
    data: {
      settings: { ...DEFAULT_SETTINGS, ...data.settings },
      alerts: data.alerts,
      transactions: data.transactions,
    },
  };
}

function isSettings(value: unknown): value is ExtensionSettings {
  return isRecord(value)
    && (value.refreshInterval === 10 || value.refreshInterval === 30 || value.refreshInterval === 60)
    && typeof value.badgeQuoteId === "string"
    && Array.isArray(value.hiddenQuoteIds)
    && value.hiddenQuoteIds.every((item) => typeof item === "string");
}

function isAlert(value: unknown): value is PriceAlert {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.quoteId === "string"
    && typeof value.quoteName === "string"
    && (value.direction === "above" || value.direction === "below")
    && isFiniteNumber(value.threshold)
    && typeof value.enabled === "boolean"
    && typeof value.conditionMet === "boolean"
    && isFiniteNumber(value.createdAt);
}

function isTransaction(value: unknown): value is HoldingTransaction {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.quoteId === "string"
    && typeof value.quoteName === "string"
    && (value.type === "buy" || value.type === "sell")
    && isFiniteNumber(value.grams) && value.grams > 0
    && isFiniteNumber(value.price) && value.price > 0
    && isFiniteNumber(value.createdAt);
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
