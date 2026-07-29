class FakeStatement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
    this.params = [];
  }

  bind(...params) {
    this.params = params;
    return this;
  }

  async all() {
    return { success: true, results: this.database.queryRows, meta: { changes: 0 } };
  }
}

class FakeDatabase {
  statements = [];
  queryRows = [];

  prepare(sql) {
    const statement = new FakeStatement(this, sql);
    this.statements.push(statement);
    return statement;
  }

  async batch(statements) {
    return statements.map(() => ({ success: true, results: [], meta: { changes: 1 } }));
  }
}

Object.defineProperty(globalThis, "caches", {
  value: { default: { async match() {}, async put() {} } },
  configurable: true,
});

const {
  chinaDayStart,
  deleteExpiredHistory,
  historyResponse,
  persistHistory,
} = await import("../src/history.ts");

const scheduledAt = Date.UTC(2026, 6, 29, 12, 34, 56);
const minuteTimestamp = Date.UTC(2026, 6, 29, 12, 34, 0);
const chinaMidnight = Date.UTC(2026, 6, 28, 16, 0, 0);
const quotes = [
  { id: "jd_zs_accumulation", price: 880, sourceTime: scheduledAt - 1_000 },
  { id: "london_gold", price: 4_000, sourceTime: scheduledAt - 2_000 },
  { id: "shuibei_gold", price: 1_050, sourceTime: scheduledAt - 3_000 },
  { id: "gold_recycle", price: 860, sourceTime: scheduledAt - 4_000 },
];

const writeDb = new FakeDatabase();
const captured = await persistHistory(writeDb, quotes, scheduledAt);
if (captured !== 4) throw new Error(`Expected four history writes, got ${captured}`);
const bindings = writeDb.statements.map((statement) => statement.params);
if (bindings[0][1] !== minuteTimestamp || bindings[1][1] !== minuteTimestamp) {
  throw new Error("Minute quotes were not aligned to the scheduled minute");
}
if (bindings[2][1] !== chinaMidnight || bindings[3][1] !== chinaMidnight) {
  throw new Error("Daily quotes were not aligned to China Standard Time midnight");
}
if (chinaDayStart(scheduledAt) !== chinaMidnight) throw new Error("China day calculation is incorrect");

const cleanupDb = new FakeDatabase();
const deleted = await deleteExpiredHistory(cleanupDb, scheduledAt);
if (deleted !== 9 || cleanupDb.statements.length !== 9) {
  throw new Error("Cleanup did not target all nine history quote IDs");
}

const readDb = new FakeDatabase();
readDb.queryRows = [
  { quote_id: "jd_zs_accumulation", sampled_at: minuteTimestamp, price: 880 },
];
const response = await historyResponse(
  new URL("https://gold-api.test/v1/history?quoteId=jd_zs_accumulation&days=7"),
  readDb,
);
const payload = await response.json();
if (!response.ok || payload.history.jd_zs_accumulation?.[0]?.price !== 880) {
  throw new Error("History endpoint did not return the stored point");
}

const invalidResponse = await historyResponse(
  new URL("https://gold-api.test/v1/history?quoteId=unknown&days=7"),
  readDb,
);
if (invalidResponse.status !== 400) throw new Error("Unknown quote ID should be rejected");

console.log(JSON.stringify({ captured, deleted, historyPoints: payload.history.jd_zs_accumulation.length }));
