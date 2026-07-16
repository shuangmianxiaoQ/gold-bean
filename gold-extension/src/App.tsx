import {
  IconArrowDownRight,
  IconArrowLeft,
  IconArrowUpRight,
  IconBell,
  IconBellPlus,
  IconChevronRight,
  IconCloudCheck,
  IconCheck,
  IconClock,
  IconCoins,
  IconDownload,
  IconPlus,
  IconRefresh,
  IconReceipt,
  IconSettings,
  IconTrash,
  IconTrendingUp,
  IconUpload,
  IconX,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getAlerts,
  getHistory,
  getSettings,
  getSnapshot,
  getPersonalData,
  getSyncStatus,
  getTransactions,
  reconcilePersonalSync,
  restorePersonalData,
  saveAlerts,
  saveSettings,
  saveTransactions,
  STORAGE_KEYS,
} from "./storage";
import { createBackupDocument, parseBackupDocument } from "./backup";
import { calculatePositions } from "./holdings";
import { TrendChart } from "./TrendChart";
import type {
  AlertDirection,
  AlertIntent,
  BackupDocument,
  ExtensionSettings,
  HoldingPosition,
  HoldingTransaction,
  PriceAlert,
  PriceDirection,
  Quote,
  QuoteCategory,
  QuoteHistory,
  QuoteSnapshot,
  RefreshResult,
  SyncStatus,
} from "./types";
import { DEFAULT_SETTINGS, QUOTE_ORDER } from "./types";

type View = "list" | "detail" | "settings" | "alerts" | "holdings";
type ChartPeriod = "day" | "week";

const excludedBadgeQuoteIds = new Set([
  "retail_store_gold",
  "bank_investment_bar",
  "shuibei_gold",
  "gold_recycle",
]);

const categoryLabels: Record<QuoteCategory, string> = {
  accumulation: "积存金",
  domestic: "国内基准",
  international: "国际市场",
  retail: "实物参考",
};

const HOLDING_PRODUCTS = [
  { id: "jd_zs_accumulation", name: "京东金融浙商积存金", valuationQuoteId: "jd_zs_accumulation" },
  { id: "jd_ms_accumulation", name: "京东金融民生积存金", valuationQuoteId: "jd_ms_accumulation" },
  { id: "alipay_accumulation", name: "支付宝积存金", valuationQuoteId: "au9999", referenceLabel: "按 Au99.99 参考估值" },
] as const;

export function App() {
  const [snapshot, setSnapshot] = useState<QuoteSnapshot | null>(null);
  const [history, setHistory] = useState<QuoteHistory>({});
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [transactions, setTransactions] = useState<HoldingTransaction[]>([]);
  const [view, setView] = useState<View>("list");
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshInFlight = useRef(false);

  const loadStorage = useCallback(async () => {
    const [storedSnapshot, storedHistory, storedSettings, storedAlerts, storedTransactions] = await Promise.all([
      getSnapshot(),
      getHistory(),
      getSettings(),
      getAlerts(),
      getTransactions(),
    ]);
    setSnapshot(storedSnapshot);
    setHistory(storedHistory);
    setSettings(storedSettings);
    setAlerts(storedAlerts);
    setTransactions(storedTransactions);
  }, []);

  const refresh = useCallback(async (force = false) => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    setRefreshing(true);
    try {
      const result = await chrome.runtime.sendMessage({ type: "refreshQuotes", force }) as RefreshResult;
      if (!result?.ok) throw new Error(result?.error ?? "刷新失败");
      setError(null);
      if (result.snapshot) setSnapshot(result.snapshot);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "刷新失败");
    } finally {
      refreshInFlight.current = false;
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadStorage().then(() => refresh());
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== "local") return;
      if (changes[STORAGE_KEYS.snapshot]?.newValue) setSnapshot(changes[STORAGE_KEYS.snapshot].newValue as QuoteSnapshot);
      if (changes[STORAGE_KEYS.history]?.newValue) setHistory(changes[STORAGE_KEYS.history].newValue as QuoteHistory);
      if (changes[STORAGE_KEYS.settings]?.newValue) setSettings(changes[STORAGE_KEYS.settings].newValue as ExtensionSettings);
      if (changes[STORAGE_KEYS.alerts]?.newValue) setAlerts(changes[STORAGE_KEYS.alerts].newValue as PriceAlert[]);
      if (changes[STORAGE_KEYS.transactions]?.newValue) setTransactions(changes[STORAGE_KEYS.transactions].newValue as HoldingTransaction[]);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [loadStorage, refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => void refresh(), settings.refreshInterval * 1_000);
    return () => window.clearInterval(timer);
  }, [refresh, settings.refreshInterval]);

  const quotes = useMemo(() => {
    const quoteMap = new Map(snapshot?.quotes.map((quote) => [quote.id, quote]) ?? []);
    return QUOTE_ORDER.map((id) => quoteMap.get(id)).filter((quote): quote is Quote => Boolean(quote));
  }, [snapshot]);

  const selectedQuote = quotes.find((quote) => quote.id === selectedQuoteId) ?? null;
  const positions = useMemo(() => calculatePositions(transactions), [transactions]);

  function openDetail(quoteId: string) {
    setSelectedQuoteId(quoteId);
    setView("detail");
  }

  return (
    <main className="app-shell">
      {view === "list" && (
        <ListView
          snapshot={snapshot}
          quotes={quotes}
          settings={settings}
          alerts={alerts}
          refreshing={refreshing}
          error={error}
          onRefresh={() => void refresh(true)}
          onOpenDetail={openDetail}
          onOpenSettings={() => setView("settings")}
          onOpenAlerts={() => setView("alerts")}
          onOpenHoldings={() => setView("holdings")}
        />
      )}
      {view === "detail" && selectedQuote && (
        <DetailView
          quote={selectedQuote}
          snapshot={snapshot}
          points={history[selectedQuote.id] ?? []}
          alerts={alerts.filter((alert) => alert.quoteId === selectedQuote.id)}
          position={positions.find((position) => position.quoteId === selectedQuote.id)}
          onBack={() => setView("list")}
          onSaveAlert={async (alert) => {
            const updated = [...alerts, alert];
            setAlerts(updated);
            await saveAlerts(updated);
          }}
        />
      )}
      {view === "settings" && (
        <SettingsView
          quotes={quotes}
          settings={settings}
          onBack={() => setView("list")}
          onChange={async (nextSettings) => {
            setSettings(nextSettings);
            await saveSettings(nextSettings);
          }}
          onRestored={loadStorage}
        />
      )}
      {view === "alerts" && (
        <AlertsView
          alerts={alerts}
          onBack={() => setView("list")}
          onChange={async (nextAlerts) => {
            setAlerts(nextAlerts);
            await saveAlerts(nextAlerts);
          }}
        />
      )}
      {view === "holdings" && (
        <HoldingsView
          quotes={quotes}
          positions={positions}
          transactions={transactions}
          onBack={() => setView("list")}
          onOpenDetail={openDetail}
          onChangeTransactions={async (nextTransactions) => {
            setTransactions(nextTransactions);
            await saveTransactions(nextTransactions);
          }}
        />
      )}
    </main>
  );
}

interface ListViewProps {
  snapshot: QuoteSnapshot | null;
  quotes: Quote[];
  settings: ExtensionSettings;
  alerts: PriceAlert[];
  refreshing: boolean;
  error: string | null;
  onRefresh: () => void;
  onOpenDetail: (quoteId: string) => void;
  onOpenSettings: () => void;
  onOpenAlerts: () => void;
  onOpenHoldings: () => void;
}

function ListView(props: ListViewProps) {
  const visibleQuotes = props.quotes.filter((quote) => !props.settings.hiddenQuoteIds.includes(quote.id));
  const focusIds = ["jd_zs_accumulation", "london_gold"];
  const focusQuotes = focusIds.map((id) => visibleQuotes.find((quote) => quote.id === id)).filter((quote): quote is Quote => Boolean(quote));
  const grouped = (["accumulation", "domestic", "international", "retail"] as QuoteCategory[])
    .map((category) => ({ category, quotes: visibleQuotes.filter((quote) => quote.category === category && !focusIds.includes(quote.id)) }))
    .filter((group) => group.quotes.length > 0);

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">Au</div>
          <div>
            <strong>金豆行情</strong>
            <span>Gold pulse</span>
          </div>
        </div>
        <div className="topbar-actions">
          <button className="icon-button" onClick={props.onOpenHoldings} aria-label="持仓与收益">
            <IconCoins size={18} />
          </button>
          <button className="icon-button" onClick={props.onOpenAlerts} aria-label="到价提醒">
            <IconBell size={18} />
            {props.alerts.filter((alert) => alert.enabled).length > 0 && <i className="notification-dot" />}
          </button>
          <button className="icon-button" onClick={props.onOpenSettings} aria-label="设置">
            <IconSettings size={18} />
          </button>
        </div>
      </header>

      <section className="content list-content">
        {focusQuotes.length > 0 ? (
          <div className="focus-grid">
            {focusQuotes.map((quote) => (
              <FocusCard key={quote.id} quote={quote} snapshot={props.snapshot} onClick={() => props.onOpenDetail(quote.id)} />
            ))}
          </div>
        ) : (
          <EmptyState />
        )}

        {grouped.map((group) => (
          <section className="quote-section" key={group.category}>
            <div className="section-title">
              <span>{categoryLabels[group.category]}</span>
              {group.category === "retail" && <small>今日参考</small>}
            </div>
            <div className="quote-list">
              {group.quotes.map((quote) => (
                <QuoteRow
                  key={quote.id}
                  quote={quote}
                  snapshot={props.snapshot}
                  onClick={() => props.onOpenDetail(quote.id)}
                />
              ))}
            </div>
          </section>
        ))}
      </section>

      <footer className="statusbar">
        <div className={`status-indicator ${props.error ? "error" : props.snapshot?.stale ? "stale" : ""}`} />
        <span>{statusText(props.snapshot, props.error)}</span>
        <button className="refresh-button" onClick={props.onRefresh} disabled={props.refreshing}>
          <IconRefresh size={15} className={props.refreshing ? "spin" : ""} />
          {props.refreshing ? "刷新中" : `${props.settings.refreshInterval}秒`}
        </button>
      </footer>
    </>
  );
}

function FocusCard({ quote, snapshot, onClick }: { quote: Quote; snapshot: QuoteSnapshot | null; onClick: () => void }) {
  const direction = getDirection(quote, snapshot);
  return (
    <button className="focus-card" onClick={onClick}>
      <strong className="focus-name">{quote.id === "jd_zs_accumulation" ? "浙商积存金" : "伦敦现货"}</strong>
      <span className="focus-price">{quote.unit.startsWith("美元") ? "$" : "¥"}{formatQuotePrice(quote)}</span>
      <span className={`direction-text ${direction}`}>{directionLabel(quote, snapshot)}</span>
    </button>
  );
}

function QuoteRow({ quote, snapshot, onClick }: { quote: Quote; snapshot: QuoteSnapshot | null; onClick: () => void }) {
  const direction = getDirection(quote, snapshot);
  return (
    <button className="quote-row" onClick={onClick}>
      <div className="quote-name">
        <strong>{quote.name}</strong>
        <span>{quote.aggregation ? `${quote.aggregation.sampleCount} 家样本中位数` : quote.category === "retail" ? "每日参考价" : quote.unit}</span>
      </div>
      <div className="quote-value">
        <strong>{quote.unit.startsWith("美元") ? "$" : "¥"}{formatQuotePrice(quote)}</strong>
        <span className={`direction-text ${direction}`}>{directionLabel(quote, snapshot)}</span>
      </div>
      <IconChevronRight size={17} className="row-chevron" />
    </button>
  );
}

function DirectionPill({ quote, snapshot }: { quote: Quote; snapshot: QuoteSnapshot | null }) {
  const direction = getDirection(quote, snapshot);
  return (
    <span className={`direction-pill ${direction}`}>
      {direction === "up" ? <IconArrowUpRight size={14} /> : direction === "down" ? <IconArrowDownRight size={14} /> : <IconTrendingUp size={14} />}
      {directionLabel(quote, snapshot)}
    </span>
  );
}

interface DetailViewProps {
  quote: Quote;
  snapshot: QuoteSnapshot | null;
  points: { time: number; price: number }[];
  alerts: PriceAlert[];
  position?: HoldingPosition;
  onBack: () => void;
  onSaveAlert: (alert: PriceAlert) => Promise<void>;
}

function DetailView({ quote, snapshot, points, alerts, position, onBack, onSaveAlert }: DetailViewProps) {
  const isDaily = quote.category === "retail";
  const [period, setPeriod] = useState<ChartPeriod>(isDaily ? "week" : "day");
  const [showAlertForm, setShowAlertForm] = useState(false);
  const [alertIntent, setAlertIntent] = useState<AlertIntent>("buy");
  const [alertDirection, setAlertDirection] = useState<AlertDirection>("below");
  const [threshold, setThreshold] = useState(quote.price.toFixed(2));
  const [percentThreshold, setPercentThreshold] = useState("5");
  const [notifyMode, setNotifyMode] = useState<"once" | "cross">("once");
  const direction = getDirection(quote, snapshot);

  async function createAlert() {
    const numericThreshold = alertIntent === "costChange"
      ? Number.parseFloat(percentThreshold) * (alertDirection === "below" ? -1 : 1)
      : Number.parseFloat(threshold);
    if (!Number.isFinite(numericThreshold)) return;
    if (alertIntent === "costChange" && !position) return;
    await onSaveAlert({
      id: crypto.randomUUID(),
      quoteId: quote.id,
      quoteName: quote.name,
      direction: alertDirection,
      threshold: numericThreshold,
      kind: alertIntent === "costChange" ? "costPercent" : "price",
      intent: alertIntent,
      notifyMode,
      enabled: true,
      conditionMet: false,
      createdAt: Date.now(),
    });
    setShowAlertForm(false);
  }

  return (
    <>
      <SubHeader title={quote.name} onBack={onBack} />
      <section className="content detail-content">
        <div className="detail-price-block">
          <span className="eyebrow">{categoryLabels[quote.category]}</span>
          <div className="detail-price">
            <span>{quote.unit.startsWith("美元") ? "$" : "¥"}</span>
            {formatQuotePrice(quote)}
            <small>{quote.unit.includes("/克") ? "/克" : "/盎司"}</small>
          </div>
          <div className={`detail-change ${direction}`}>
            {direction === "up" ? <IconArrowUpRight size={16} /> : direction === "down" ? <IconArrowDownRight size={16} /> : <IconTrendingUp size={16} />}
            {directionLabel(quote, snapshot)}
            <span>更新于 {formatTime(quote.sourceTime ?? snapshot?.fetchedAt)}</span>
          </div>
        </div>

        <div className="chart-card">
          <div className="chart-header">
            <div>
              <span className="eyebrow">价格趋势</span>
              <strong>{isDaily ? "最近每日报价" : period === "day" ? "今日走势" : "近7日"}</strong>
            </div>
            {!isDaily && (
              <div className="segmented compact">
                <button className={period === "day" ? "active" : ""} onClick={() => setPeriod("day")}>今日</button>
                <button className={period === "week" ? "active" : ""} onClick={() => setPeriod("week")}>7日</button>
              </div>
            )}
          </div>
          <TrendChart points={points} period={period} currentPrice={quote.price} dailySampling={isDaily} />
          {isDaily && <p className="chart-note">实物参考价每天保存一个价格点，历史数据会从安装后逐步积累。</p>}
        </div>

        {!quote.aggregation && (
          <div className="metrics-grid">
            {metricEntries(quote).map(([label, value]) => (
              <div className="metric" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        )}

        {quote.aggregation && (
          <section className="sample-card">
            <div className="sample-heading">
              <span className="eyebrow">聚合样本</span>
              <span>中位数 ¥{formatQuotePrice(quote)}</span>
            </div>
            <div className="sample-list">
              {quote.aggregation.samples.map((sample) => (
                <div key={sample.name}><span>{sample.name}</span><strong>¥{formatMetric(sample.price)}</strong></div>
              ))}
            </div>
          </section>
        )}

        {!isDaily && (showAlertForm ? (
          <div className="alert-form">
            <div className="alert-form-title">
              <strong>设置交易提醒</strong>
              <button className="icon-button small" onClick={() => setShowAlertForm(false)}><IconX size={16} /></button>
            </div>
            <div className="segmented triple">
              <button className={alertIntent === "buy" ? "active" : ""} onClick={() => { setAlertIntent("buy"); setAlertDirection("below"); }}>买入价</button>
              <button className={alertIntent === "takeProfit" ? "active" : ""} onClick={() => { setAlertIntent("takeProfit"); setAlertDirection("above"); }}>止盈价</button>
              <button className={alertIntent === "costChange" ? "active" : ""} disabled={!position} onClick={() => { setAlertIntent("costChange"); setAlertDirection("above"); }}>成本涨跌</button>
            </div>
            {alertIntent === "costChange" ? (
              <>
                <div className="segmented alert-direction">
                  <button className={alertDirection === "above" ? "active" : ""} onClick={() => setAlertDirection("above")}>盈利达到</button>
                  <button className={alertDirection === "below" ? "active" : ""} onClick={() => setAlertDirection("below")}>回撤达到</button>
                </div>
                <label className="price-input">
                  <span>%</span>
                  <input aria-label="成本涨跌幅" value={percentThreshold} inputMode="decimal" onChange={(event) => setPercentThreshold(event.target.value)} />
                  <small>平均成本 {position?.averageCost.toFixed(2)}</small>
                </label>
              </>
            ) : (
              <label className="price-input">
                <span>{quote.unit.startsWith("美元") ? "$" : "¥"}</span>
                <input aria-label="提醒目标价格" value={threshold} inputMode="decimal" onChange={(event) => setThreshold(event.target.value)} />
                <small>{quote.unit.includes("/克") ? "元/克" : "美元/盎司"}</small>
              </label>
            )}
            <div className="segmented notify-mode">
              <button className={notifyMode === "once" ? "active" : ""} onClick={() => setNotifyMode("once")}>仅提醒一次</button>
              <button className={notifyMode === "cross" ? "active" : ""} onClick={() => setNotifyMode("cross")}>每次重新穿越</button>
            </div>
            {!position && <p className="form-hint">添加该产品持仓后，可设置相对成本涨跌提醒。</p>}
            <button className="primary-button" onClick={() => void createAlert()}>保存提醒</button>
          </div>
        ) : (
          <button className="alert-action" onClick={() => setShowAlertForm(true)}>
            <IconBellPlus size={19} />
            <span><strong>设置到价提醒</strong><small>{alerts.length > 0 ? `当前已有 ${alerts.length} 个提醒` : "价格穿越目标线时通知"}</small></span>
            <IconChevronRight size={18} />
          </button>
        ))}
      </section>
    </>
  );
}

function HoldingsView({ quotes, positions, transactions, onBack, onOpenDetail, onChangeTransactions }: {
  quotes: Quote[];
  positions: HoldingPosition[];
  transactions: HoldingTransaction[];
  onBack: () => void;
  onOpenDetail: (quoteId: string) => void;
  onChangeTransactions: (transactions: HoldingTransaction[]) => Promise<void>;
}) {
  const defaultProduct = HOLDING_PRODUCTS[0];
  const [showForm, setShowForm] = useState(transactions.length === 0);
  const [productId, setProductId] = useState<string>(defaultProduct.id);
  const [type, setType] = useState<"buy" | "sell">("buy");
  const [grams, setGrams] = useState("");
  const [price, setPrice] = useState(quotes.find((quote) => quote.id === defaultProduct.valuationQuoteId)?.price.toFixed(2) ?? "");
  const [formError, setFormError] = useState<string | null>(null);
  const selectedProduct = HOLDING_PRODUCTS.find((product) => product.id === productId) ?? defaultProduct;
  const selectedValuationQuote = quotes.find((quote) => quote.id === selectedProduct.valuationQuoteId);
  const selectedPosition = positions.find((position) => position.quoteId === productId);

  const totals = positions.reduce((summary, position) => {
    const quote = quotes.find((item) => item.id === position.valuationQuoteId);
    const marketValue = position.grams * (quote?.price ?? position.averageCost);
    summary.cost += position.cost;
    summary.marketValue += marketValue;
    return summary;
  }, { cost: 0, marketValue: 0 });
  const totalProfit = totals.marketValue - totals.cost;
  const totalRate = totals.cost > 0 ? totalProfit / totals.cost * 100 : 0;

  function changeProduct(nextProductId: string) {
    setProductId(nextProductId);
    const product = HOLDING_PRODUCTS.find((item) => item.id === nextProductId);
    const quote = quotes.find((item) => item.id === product?.valuationQuoteId);
    if (quote) setPrice(quote.price.toFixed(2));
    setFormError(null);
  }

  async function addTransaction() {
    const numericGrams = Number.parseFloat(grams);
    const numericPrice = Number.parseFloat(price);
    if (!selectedValuationQuote || !Number.isFinite(numericGrams) || numericGrams <= 0 || !Number.isFinite(numericPrice) || numericPrice <= 0) {
      setFormError("请输入有效的克数和成交价");
      return;
    }
    if (type === "sell" && numericGrams > (selectedPosition?.grams ?? 0) + 0.000001) {
      setFormError(`最多可卖出 ${(selectedPosition?.grams ?? 0).toFixed(4)} 克`);
      return;
    }
    const next = [...transactions, {
      id: crypto.randomUUID(),
      quoteId: selectedProduct.id,
      quoteName: selectedProduct.name,
      valuationQuoteId: selectedProduct.valuationQuoteId,
      type,
      grams: numericGrams,
      price: numericPrice,
      createdAt: Date.now(),
    } satisfies HoldingTransaction];
    await onChangeTransactions(next);
    setGrams("");
    setFormError(null);
    setShowForm(false);
  }

  return (
    <>
      <SubHeader title="持仓与收益" onBack={onBack} />
      <section className="content holdings-content">
        <div className="portfolio-card">
          <span className="eyebrow">持仓总市值</span>
          <strong>{formatCurrency(totals.marketValue)}</strong>
          <div className="portfolio-stats">
            <div><span>持仓成本</span><b>{formatCurrency(totals.cost)}</b></div>
            <div><span>浮动盈亏</span><b className={profitClass(totalProfit)}>{signedMoney(totalProfit)}</b></div>
            <div><span>收益率</span><b className={profitClass(totalProfit)}>{signed(totalRate)}%</b></div>
          </div>
        </div>

        <div className="section-heading">
          <div><strong>我的持仓</strong><span>{positions.length > 0 ? `${positions.length} 个产品` : "添加第一笔买入"}</span></div>
          <button className="mini-action" onClick={() => setShowForm((value) => !value)}><IconPlus size={15} />记一笔</button>
        </div>

        {showForm && (
          <div className="transaction-form">
            <div className="segmented">
              <button className={type === "buy" ? "active" : ""} onClick={() => { setType("buy"); setFormError(null); }}>买入</button>
              <button className={type === "sell" ? "active" : ""} onClick={() => { setType("sell"); setFormError(null); }}>卖出</button>
            </div>
            <select className="select-input" value={productId} onChange={(event) => changeProduct(event.target.value)}>
              {HOLDING_PRODUCTS.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
            </select>
            {"referenceLabel" in selectedProduct && <p className="valuation-note">{selectedProduct.referenceLabel}</p>}
            <div className="transaction-inputs">
              <label><span>克数</span><input value={grams} inputMode="decimal" placeholder="0.0000" onChange={(event) => setGrams(event.target.value)} /><small>克</small></label>
              <label><span>成交价</span><input value={price} inputMode="decimal" placeholder="0.00" onChange={(event) => setPrice(event.target.value)} /><small>元/克</small></label>
            </div>
            {type === "sell" && <p className="form-hint">当前可卖出 {(selectedPosition?.grams ?? 0).toFixed(4)} 克</p>}
            {formError && <p className="form-error">{formError}</p>}
            <button className="primary-button" onClick={() => void addTransaction()}>保存{type === "buy" ? "买入" : "卖出"}记录</button>
          </div>
        )}

        {positions.length === 0 ? (
          !showForm && <div className="holding-empty"><IconReceipt size={25} /><strong>还没有持仓记录</strong><span>点击“记一笔”录入积存金买入</span></div>
        ) : (
          <div className="position-list">
            {positions.map((position) => {
              const quote = quotes.find((item) => item.id === position.valuationQuoteId);
              const isAlipay = position.quoteId === "alipay_accumulation";
              const marketValue = position.grams * (quote?.price ?? position.averageCost);
              const profit = marketValue - position.cost;
              const rate = position.cost > 0 ? profit / position.cost * 100 : 0;
              return (
                <button className="position-card" key={position.quoteId} onClick={() => { if (!isAlipay) onOpenDetail(position.valuationQuoteId); }}>
                  <div className="position-title"><strong>{position.quoteName}</strong>{isAlipay ? <span className="reference-badge">Au99.99 估值</span> : <IconChevronRight size={16} />}</div>
                  <div className="position-value"><strong>{formatCurrency(marketValue)}</strong><span className={profitClass(profit)}>{signedMoney(profit)} · {signed(rate)}%</span></div>
                  <div className="position-meta"><span>{position.grams.toFixed(4)} 克</span><span>成本 {position.averageCost.toFixed(2)}</span><span>{isAlipay ? "参考价" : "现价"} {quote?.price.toFixed(2) ?? "--"}</span></div>
                </button>
              );
            })}
          </div>
        )}

        <div className="section-heading transaction-heading">
          <div><strong>交易明细</strong><span>移动平均成本</span></div>
        </div>
        <div className="transaction-list">
          {[...transactions].sort((a, b) => b.createdAt - a.createdAt).map((transaction) => (
            <div className="transaction-item" key={transaction.id}>
              <div className={`transaction-badge ${transaction.type}`}>{transaction.type === "buy" ? "买" : "卖"}</div>
              <div><strong>{transaction.quoteName}</strong><span><IconClock size={12} />{formatTransactionTime(transaction.createdAt)}</span></div>
              <div><strong>{transaction.grams.toFixed(4)} 克</strong><span>¥{transaction.price.toFixed(2)}/克</span></div>
              <button className="delete-button" aria-label="删除交易记录" onClick={() => void onChangeTransactions(transactions.filter((item) => item.id !== transaction.id))}><IconTrash size={16} /></button>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function SettingsView({ quotes, settings, onBack, onChange, onRestored }: {
  quotes: Quote[];
  settings: ExtensionSettings;
  onBack: () => void;
  onChange: (settings: ExtensionSettings) => Promise<void>;
  onRestored: () => Promise<void>;
}) {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ state: "idle" });
  const [pendingBackup, setPendingBackup] = useState<BackupDocument | null>(null);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void getSyncStatus().then(setSyncStatus);
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && changes[STORAGE_KEYS.syncStatus]?.newValue) {
        setSyncStatus(changes[STORAGE_KEYS.syncStatus].newValue as SyncStatus);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  async function exportBackup() {
    const document = createBackupDocument(await getPersonalData());
    const blob = new Blob([JSON.stringify(document, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement("a");
    link.href = url;
    link.download = `gold-bean-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setBackupMessage("备份已导出");
    setBackupError(null);
  }

  async function selectBackup(file?: File) {
    if (!file) return;
    try {
      setPendingBackup(parseBackupDocument(await file.text()));
      setBackupMessage(null);
      setBackupError(null);
    } catch (error) {
      setPendingBackup(null);
      setBackupError(error instanceof Error ? error.message : "无法读取备份");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function importBackup(mode: "merge" | "replace") {
    if (!pendingBackup) return;
    await restorePersonalData(pendingBackup.data, mode);
    await onRestored();
    setBackupMessage(mode === "merge" ? "备份已合并并同步" : "备份已覆盖恢复并同步");
    setBackupError(null);
    setPendingBackup(null);
  }

  async function syncNow() {
    await reconcilePersonalSync();
    setSyncStatus(await getSyncStatus());
  }

  return (
    <>
      <SubHeader title="设置" onBack={onBack} />
      <section className="content settings-content">
        <SettingGroup title="弹窗刷新周期" description="弹窗关闭后固定每30秒后台检查">
          <div className="segmented">
            {[10, 30, 60].map((seconds) => (
              <button
                key={seconds}
                className={settings.refreshInterval === seconds ? "active" : ""}
                onClick={() => void onChange({ ...settings, refreshInterval: seconds as 10 | 30 | 60 })}
              >{seconds === 60 ? "1分钟" : `${seconds}秒`}</button>
            ))}
          </div>
        </SettingGroup>

        <SettingGroup title="工具栏角标" description="选择固定显示在扩展图标上的价格">
          <select
            className="select-input"
            value={settings.badgeQuoteId}
            onChange={(event) => void onChange({ ...settings, badgeQuoteId: event.target.value })}
          >
            {quotes.filter((quote) => !excludedBadgeQuoteIds.has(quote.id)).map((quote) => (
              <option key={quote.id} value={quote.id}>{quote.name}</option>
            ))}
          </select>
        </SettingGroup>

        <SettingGroup title="行情显示" description="隐藏后仍会在后台获取行情和执行提醒">
          <div className="visibility-toolbar">
            <span>已显示 {quotes.filter((quote) => !settings.hiddenQuoteIds.includes(quote.id)).length}/{quotes.length}</span>
            {settings.hiddenQuoteIds.length > 0 && (
              <button onClick={() => void onChange({ ...settings, hiddenQuoteIds: [] })}>全部显示</button>
            )}
          </div>
          <div className="visibility-grid">
            {quotes.map((quote) => {
              const visible = !settings.hiddenQuoteIds.includes(quote.id);
              return (
                <button
                  type="button"
                  className={visible ? "active" : ""}
                  aria-pressed={visible}
                  title={quote.name}
                  key={quote.id}
                  onClick={() => {
                    const hiddenQuoteIds = visible
                      ? [...settings.hiddenQuoteIds, quote.id]
                      : settings.hiddenQuoteIds.filter((id) => id !== quote.id);
                    void onChange({ ...settings, hiddenQuoteIds });
                  }}
                >
                  <IconCheck size={13} />
                  <span>{quote.name}</span>
                </button>
              );
            })}
          </div>
        </SettingGroup>

        <SettingGroup title="Chrome 同步" description="同步持仓、提醒和设置；不包含行情历史">
          <div className={`sync-card ${syncStatus.state}`}>
            <IconCloudCheck size={20} />
            <div>
              <strong>{syncStatusLabel(syncStatus)}</strong>
              <span>{syncStatusDetail(syncStatus)}</span>
            </div>
            <button className="mini-action" disabled={syncStatus.state === "syncing"} onClick={() => void syncNow()}>
              {syncStatus.state === "syncing" ? "同步中" : "立即同步"}
            </button>
          </div>
          <p className="setting-note">需要相同扩展 ID、相同 Chrome 账号，并在浏览器中开启同步。</p>
        </SettingGroup>

        <SettingGroup title="数据备份" description="导出或恢复持仓、交易、提醒和设置">
          <div className="backup-actions">
            <button className="secondary-action" onClick={() => void exportBackup()}><IconDownload size={16} />导出 JSON</button>
            <button className="secondary-action" onClick={() => fileInputRef.current?.click()}><IconUpload size={16} />导入备份</button>
            <input ref={fileInputRef} className="file-input" type="file" accept="application/json,.json" onChange={(event) => void selectBackup(event.target.files?.[0])} />
          </div>
          {pendingBackup && (
            <div className="import-preview">
              <div><strong>确认导入备份</strong><span>{pendingBackup.data.transactions.length} 笔交易 · {pendingBackup.data.alerts.length} 个提醒</span></div>
              <p>合并会保留当前设置并合并记录；覆盖会用备份替换全部个人数据。</p>
              <div>
                <button className="secondary-action" onClick={() => void importBackup("merge")}>合并导入</button>
                <button className="danger-action" onClick={() => void importBackup("replace")}>覆盖恢复</button>
              </div>
            </div>
          )}
          {backupMessage && <p className="backup-message">{backupMessage}</p>}
          {backupError && <p className="form-error">{backupError}</p>}
        </SettingGroup>

        <div className="about-card">
          <div className="brand-mark small-mark">Au</div>
          <div><strong>金豆行情 v0.4.0</strong><span>数据仅供参考，以实际交易报价为准</span></div>
        </div>
      </section>
    </>
  );
}

function AlertsView({ alerts, onBack, onChange }: {
  alerts: PriceAlert[];
  onBack: () => void;
  onChange: (alerts: PriceAlert[]) => Promise<void>;
}) {
  return (
    <>
      <SubHeader title="到价提醒" onBack={onBack} />
      <section className="content alerts-content">
        {alerts.length === 0 ? (
          <div className="alerts-empty">
            <div className="empty-icon"><IconBell size={25} /></div>
            <strong>还没有到价提醒</strong>
            <span>进入任一行情详情即可添加</span>
          </div>
        ) : alerts.map((alert) => (
          <div className="alert-item" key={alert.id}>
            <div>
              <strong>{alert.quoteName}</strong>
              <span>{alertDescription(alert)} <b>{alert.kind === "costPercent" ? `${signed(alert.threshold)}%` : alert.threshold.toFixed(2)}</b></span>
              <small>{alert.completed ? "已完成" : alert.notifyMode === "once" ? "仅提醒一次" : "每次重新穿越提醒"}</small>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                aria-label={`${alert.quoteName}提醒开关`}
                checked={alert.enabled}
                onChange={() => void onChange(alerts.map((item) => item.id === alert.id
                  ? { ...item, enabled: !item.enabled, completed: item.enabled ? item.completed : false, conditionMet: item.enabled ? item.conditionMet : false }
                  : item))}
              />
              <i />
            </label>
            <button className="delete-button" aria-label={`删除${alert.quoteName}提醒`} onClick={() => void onChange(alerts.filter((item) => item.id !== alert.id))}>
              <IconTrash size={17} />
            </button>
          </div>
        ))}
      </section>
    </>
  );
}

function SubHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <header className="sub-header">
      <button className="icon-button" onClick={onBack} aria-label="返回"><IconArrowLeft size={19} /></button>
      <strong>{title}</strong>
      <span />
    </header>
  );
}

function SettingGroup({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="setting-group">
      <div><strong>{title}</strong><span>{description}</span></div>
      {children}
    </section>
  );
}

function EmptyState() {
  return <div className="empty-state">正在获取积存金行情…</div>;
}

function metricEntries(quote: Quote): [string, string][] {
  if (quote.aggregation) return [["聚合方式", "中位数"], ["有效样本", `${quote.aggregation.sampleCount} 家`], ["价格区间", `¥${formatMetric(quote.aggregation.min)}–${formatMetric(quote.aggregation.max)}`]];
  if (quote.category === "retail") return [["报价类型", "每日参考"], ["当前报价", `¥${formatQuotePrice(quote)}`]];
  const candidates: [string, number | undefined][] = [
    ["最高价", quote.high],
    ["最低价", quote.low],
    ["卖出价", quote.sellPrice],
    ["昨日价格", quote.yesterdayPrice],
  ];
  return candidates.filter((entry): entry is [string, number] => entry[1] !== undefined)
    .slice(0, 3)
    .map(([label, value]) => [label, formatMetric(value)]);
}

function getDirection(quote: Quote, snapshot: QuoteSnapshot | null): PriceDirection {
  const previous = snapshot?.previousPrices[quote.id];
  if (previous === undefined || previous === quote.price) return "flat";
  return quote.price > previous ? "up" : "down";
}

function directionLabel(quote: Quote, snapshot: QuoteSnapshot | null): string {
  const previous = snapshot?.previousPrices[quote.id];
  if (previous === undefined || previous === quote.price) return "持平";
  return signed(quote.price - previous);
}

function statusText(snapshot: QuoteSnapshot | null, error: string | null): string {
  if (error) return `更新失败 · ${error}`;
  if (!snapshot) return "正在连接行情…";
  if (snapshot.stale) return `最近有效价格 · ${relativeTime(snapshot.fetchedAt)}`;
  return `行情正常 · ${relativeTime(snapshot.fetchedAt)}`;
}

function syncStatusLabel(status: SyncStatus): string {
  if (status.state === "syncing") return "正在同步个人数据";
  if (status.state === "synced") return "已写入 Chrome Sync";
  if (status.state === "error") return "当前仅保存在本机";
  return "等待首次同步";
}

function syncStatusDetail(status: SyncStatus): string {
  if (status.state === "error") return status.error ?? "Chrome 同步暂不可用";
  if (status.lastSyncedAt) return `最近同步 ${relativeTime(status.lastSyncedAt)}`;
  return "数据会保持本地可用";
}

function relativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1_000));
  if (seconds < 10) return "刚刚更新";
  if (seconds < 60) return `${seconds}秒前`;
  return `${Math.floor(seconds / 60)}分钟前`;
}

function formatQuotePrice(quote: Quote): string {
  if (quote.category === "retail" && Number.isInteger(quote.price)) return quote.price.toFixed(0);
  return quote.price.toFixed(2);
}

function formatMetric(value: number): string {
  return value >= 1_000 ? value.toFixed(2) : value.toFixed(2);
}

function formatTime(timestamp?: number): string {
  if (!timestamp) return "--";
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(timestamp);
}

function signed(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
}

function formatCurrency(value: number): string {
  return `¥${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function signedMoney(value: number): string {
  return `${value >= 0 ? "+" : "-"}¥${Math.abs(value).toFixed(2)}`;
}

function profitClass(value: number): "profit-up" | "profit-down" | "profit-flat" {
  if (value > 0.005) return "profit-up";
  if (value < -0.005) return "profit-down";
  return "profit-flat";
}

function formatTransactionTime(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(timestamp);
}

function alertDescription(alert: PriceAlert): string {
  if (alert.kind === "costPercent") return alert.direction === "above" ? "盈利达到" : "回撤达到";
  if (alert.intent === "buy") return "目标买入价";
  if (alert.intent === "takeProfit") return "目标止盈价";
  return alert.direction === "above" ? "高于或等于" : "低于或等于";
}
