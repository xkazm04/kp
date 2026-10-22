import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BACKLOG_SKIP_REASONS } from "../../../../../_lib/comms-backlog.ts";
import { tallyBacklogResults } from "./backlogOfferModel.ts";

test("each delivery outcome is counted once and every skip is kept by name", () => {
  const tally = tallyBacklogResults([
    { id: "a", outcome: "sent" },
    { id: "b", outcome: "sent" },
    { id: "c", outcome: "failed", detail: "http 503" },
    { id: "d", outcome: "queued" },
    { id: "e", outcome: "skipped", reason: "suppressed" },
    { id: "f", outcome: "skipped", reason: "already_sent" },
  ]);
  assert.deepEqual(tally, {
    sent: 2,
    failed: 1,
    queued: 1,
    skipped: [{ id: "e", reason: "suppressed" }, { id: "f", reason: "already_sent" }],
  });
});

test("every skip reason the server can name has words in all four catalogs", () => {
  for (const locale of ["en", "cs", "de", "fr"]) {
    const catalog = JSON.parse(readFileSync(new URL(`../../../../../../messages/${locale}.json`, import.meta.url), "utf8"));
    const skip = catalog.channelsNight.ledger.backlog.skip as Record<string, string>;
    for (const reason of BACKLOG_SKIP_REASONS) assert.ok(skip[reason]?.trim(), `${locale}: skip.${reason}`);
  }
});
