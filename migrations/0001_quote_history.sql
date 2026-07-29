CREATE TABLE IF NOT EXISTS quote_history (
  quote_id TEXT NOT NULL,
  sampled_at INTEGER NOT NULL,
  price REAL NOT NULL,
  source_time INTEGER,
  granularity TEXT NOT NULL CHECK (granularity IN ('minute', 'daily')),
  PRIMARY KEY (quote_id, sampled_at)
) WITHOUT ROWID;
