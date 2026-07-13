-- Gonzaga Portfolio Competition — submissions store (Cloudflare D1).
-- One row per entry. A student may submit multiple times (one category per entry).
-- Apply with:
--   wrangler d1 execute gpc_submissions --local  --file=./migrations/0001_init.sql
--   wrangler d1 execute gpc_submissions --remote --file=./migrations/0001_init.sql

CREATE TABLE IF NOT EXISTS submissions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at    TEXT    NOT NULL,   -- ISO 8601 timestamp (UTC)
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL,
  portfolio_url TEXT    NOT NULL,
  category      TEXT    NOT NULL,   -- business | personal | design | problem-solving
  reflection    TEXT    NOT NULL,   -- "what you learned and how you grew"
  ip            TEXT,               -- CF-Connecting-IP (light abuse triage)
  country       TEXT,               -- request.cf.country
  user_agent    TEXT
);

CREATE INDEX IF NOT EXISTS idx_submissions_category ON submissions (category);
CREATE INDEX IF NOT EXISTS idx_submissions_email    ON submissions (email);
CREATE INDEX IF NOT EXISTS idx_submissions_created  ON submissions (created_at);
