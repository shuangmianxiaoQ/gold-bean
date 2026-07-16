export type QuoteCategory = "accumulation" | "domestic" | "international" | "retail";
export type PriceDirection = "up" | "down" | "flat";
export type RefreshInterval = 10 | 30;
export type AlertDirection = "above" | "below";

export interface Quote {
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

export interface SourceStatus {
  ok: boolean;
  sourceTime?: number;
  error?: string;
}

export interface GoldApiPayload {
  success: boolean;
  fetchedAt: number;
  stale: boolean;
  quotes: Quote[];
  sources: {
    jd: SourceStatus;
    market: SourceStatus;
  };
}

export interface QuoteSnapshot extends GoldApiPayload {
  previousPrices: Record<string, number>;
}

export interface HistoryPoint {
  time: number;
  price: number;
}

export type QuoteHistory = Record<string, HistoryPoint[]>;

export interface ExtensionSettings {
  refreshInterval: RefreshInterval;
  badgeQuoteId: string;
  hiddenQuoteIds: string[];
}

export interface PriceAlert {
  id: string;
  quoteId: string;
  quoteName: string;
  direction: AlertDirection;
  threshold: number;
  enabled: boolean;
  conditionMet: boolean;
  createdAt: number;
}

export interface RefreshResult {
  ok: boolean;
  snapshot?: QuoteSnapshot;
  error?: string;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  refreshInterval: 10,
  badgeQuoteId: "jd_zs_accumulation",
  hiddenQuoteIds: [],
};

export const QUOTE_ORDER = [
  "jd_zs_accumulation",
  "au9999",
  "autd",
  "london_gold",
  "new_york_gold",
  "shuibei_gold",
];
