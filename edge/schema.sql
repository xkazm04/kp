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
