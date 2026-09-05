-- The edge's ENTIRE storage. Two tables, and one of them is a key/value scratchpad.
--
-- `events` is an append-only log that is DELETED as it drains (see /ack in
-- src/index.ts): the install applies an event to the real database and the edge then
-- forgets it. That is what keeps this a queue rather than a shadow copy of the
-- pipeline. `seq` is the cursor the install resumes from, so it must be monotonic
-- and must never be reused -- AUTOINCREMENT, not plain rowid, which SQLite may
-- recycle after a delete.
CREATE TABLE IF NOT EXISTS events (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL,           -- lead | mail | receipt
  token       TEXT,                    -- the receiver token (lead/mail); NULL for receipts
  body        TEXT,                    -- cleartext JSON, ONLY while no sealing key is published
  sealed      TEXT,                    -- sealed envelope JSON; mutually exclusive with body
  received_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_seq ON events (seq);

-- Everything else the edge knows, which is deliberately almost nothing:
--   public_jwk    the install's sealing key (published at /pair)
--   last_seen_at  when the install last drained or beat -- the presence signal
--   nudge_target  where to send "you have mail"; owned by the install, re-sent every beat
--   nudged_at     set when a nudge goes out, cleared by the next heartbeat, so one
--                 quiet period produces exactly one nudge
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Replay guard. The signature scheme bounds a captured envelope to a +/-5 minute
-- window (edge-crypto.ts EDGE_SIGNATURE_SKEW_MS); within that window a captured
-- `POST /ack {upto}` could be replayed verbatim and DELETE queued events that the
-- install never applied. So every authenticated call spends a nonce exactly once:
-- the SHA-256 of its signature for the signed endpoints, the receipt's nonce for
-- the relay callback. A second presentation is answered 409 and changes nothing.
--
-- Rows are garbage, not truth: they expire with the window that made them
-- necessary and are pruned on the next claim. Nothing here is a credential -- a
-- signature HASH cannot be replayed by whoever reads this table.
CREATE TABLE IF NOT EXISTS nonces (
  nonce      TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nonces_expiry ON nonces (expires_at);

-- The public door's rate limiter (POST /in/<token>). One row per (receiver token,
-- caller IP) per minute, holding a count and the instant the window resets; expired
-- rows are pruned on the next claim, exactly like `nonces`.
--
-- It lives in D1 rather than KV so an operator has nothing new to create: D1 is
-- already the Worker's only binding, and this is one integer per caller per minute.
-- It is abuse CONTAINMENT, not an exact quota -- read-then-write is not atomic, so a
-- burst arriving in the same millisecond can over-admit by a few. The hard bound is
-- the 10,000-event queue cap in src/index.ts, which is checked on every write and
-- refuses (503 + Retry-After) rather than dropping the oldest event: a stored event
-- has already been answered `202 held`, and silently discarding it later would break
-- that promise with nobody told, while a refusal is one every sender retries.
CREATE TABLE IF NOT EXISTS rate (
  key      TEXT PRIMARY KEY,
  count    INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_reset ON rate (reset_at);
