-- Gonzaga Portfolio Competition — submissions store (Cloudflare D1).
-- One entry per (email, category): a re-submission of the same category UPDATES the entry (last write
-- wins) via the unique index below; different categories are separate rows. A student may enter several
-- categories by submitting the form for each. Review fields are included up front so the (future)
-- Access-gated review UI needs no migration once real data exists.
--
-- Apply with:
--   wrangler d1 execute gpc_submissions --local  --file=./migrations/0001_init.sql
--   wrangler d1 execute gpc_submissions --remote --file=./migrations/0001_init.sql

CREATE TABLE IF NOT EXISTS submissions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at     TEXT NOT NULL,                          -- ISO 8601 (UTC); set on first insert, preserved on update
  updated_at     TEXT NOT NULL,                          -- ISO 8601 (UTC); bumped on every write
  name           TEXT NOT NULL,
  email          TEXT NOT NULL,                          -- stored lowercased (dedup key)
  portfolio_url  TEXT NOT NULL,
  category       TEXT NOT NULL,                          -- business | personal | design | problem-solving
  reflection     TEXT NOT NULL,                          -- "what you learned and how you grew"
  review_status  TEXT NOT NULL DEFAULT 'unreviewed',     -- unreviewed | shortlisted | winner | disqualified
  reviewer_notes TEXT NOT NULL DEFAULT '',               -- private; set by reviewers, never by students
  reviewed_by    TEXT,                                   -- reviewer identity (Access email); null until reviewed
  reviewed_at    TEXT                                    -- ISO 8601 when reviewed; null until reviewed
);

-- Dedup + abuse bound: at most one row per (email, category). Powers the UPSERT in functions/api/submit.js.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_submissions_email_category ON submissions (email, category);

CREATE INDEX IF NOT EXISTS idx_submissions_category ON submissions (category);
CREATE INDEX IF NOT EXISTS idx_submissions_created  ON submissions (created_at);
CREATE INDEX IF NOT EXISTS idx_submissions_status   ON submissions (review_status);
