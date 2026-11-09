// ADR 0019 — what an entry-less KO decline leaves behind, and when it goes. These rows now
// exist only from before the Q1 ruling (2026-11-09); the last two tests say what covers
// the NEW case, where the contact lives on a held entry.
//
// A declined applicant has no pipeline entry, so the ref-keyed outbox scrub in
// anonymizeEntry never reaches their letter, and the ko_declined event keeps their name.
// Both are blanked after KO_DECLINE_CONTACT_RETENTION_DAYS by sweepKoDeclineContacts, and
// the address is also erased on demand when the same address later becomes an entry that
// is erased. The letter itself quotes the window, so it cannot drift from the code.
//
// Real throwaway DB: testing/unit-db.ts must stay the FIRST project import.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createTranslator } from "next-intl";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { ensureDb } from "./db/core.ts";
import { getOutboxEntry, recordOutbox } from "./db/devcase.ts";
import {
  anonymizeEntry,
  createPipelineEntry,
  KO_DECLINE_CONTACT_RETENTION_DAYS,
  recordKnockoutDecline,
  sweepKoDeclineContacts,
} from "./db/pipeline.ts";
import { pipelineAnalytics } from "./db/analytics.ts";
import { dispatchKnockoutRejection } from "./comms-dispatch.ts";
import { LOCALES } from "@/i18n/locales";

after(() => cleanupUnitDb());

const TEAM = "team-ko-retention";
const DAY = 86_400_000;
const NOW = new Date("2026-10-07T12:00:00.000Z");
const iso = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * DAY).toISOString();

function outbox(opts: { kind?: string; ref?: string | null; ws?: string; recipient: string; daysAgo: number }): string {
  const row = recordOutbox({
    recipient: opts.recipient,
    subject: "Your application",
    body: "Hi Someone",
    kind: opts.kind ?? "ko_decline",
    channel: "email",
    status: "sent",
    ref: opts.ref ?? null,
    workspaceId: opts.ws ?? TEAM,
  });
  ensureDb().prepare(`UPDATE dev_outbox SET created_at = ? WHERE id = ?`).run(iso(opts.daysAgo), row.id);
  return row.id;
}

function row(id: string) {
  return ensureDb().prepare(`SELECT * FROM dev_outbox WHERE id = ?`).get(id) as {
    recipient: string | null;
    subject: string | null;
    body: string | null;
    kind: string;
    status: string;
    channel: string;
    created_at: string;
    workspace_id: string;
  };
}

function koEvent(label: string, daysAgo: number): number {
  recordKnockoutDecline({
    candidateLabel: label,
    jobTitle: "Retention Engineer",
    channel: "apply",
    failedKoIds: ["ko_workauth"],
    workspaceId: TEAM,
  });
  const id = (ensureDb().prepare(`SELECT MAX(id) AS id FROM pipeline_events WHERE kind = 'ko_declined'`).get() as { id: number }).id;
  ensureDb().prepare(`UPDATE pipeline_events SET created_at = ? WHERE id = ?`).run(iso(daysAgo), id);
  return id;
}

function event(id: number) {
  return ensureDb().prepare(`SELECT * FROM pipeline_events WHERE id = ?`).get(id) as {
    candidate_label: string | null;
    job_title: string | null;
    kind: string;
    detail: string | null;
    created_at: string;
    workspace_id: string;
  };
}

test("the retention window is 30 days", () => {
  assert.equal(KO_DECLINE_CONTACT_RETENTION_DAYS, 30);
});

test("the sweep blanks an old ref-less ko_decline row and nothing else", () => {
  const old = outbox({ recipient: "old@example.cz", daysAgo: 31 });
  const fresh = outbox({ recipient: "fresh@example.cz", daysAgo: 29 });
  const refd = outbox({ recipient: "refd@example.cz", ref: "some-entry", daysAgo: 90 });
  const other = outbox({ recipient: "other@example.cz", kind: "offer", daysAgo: 90 });
  const otherWs = outbox({ recipient: "ws2@example.cz", ws: "team-ko-other", daysAgo: 45 });

  const before = row(old);
  assert.ok(sweepKoDeclineContacts(NOW.toISOString()) >= 2);

  const after1 = row(old);
  assert.equal(after1.recipient, null);
  assert.equal(after1.subject, null);
  assert.equal(after1.body, null);
  // The delivery audit stays.
  assert.equal(after1.kind, "ko_decline");
  assert.equal(after1.status, before.status);
  assert.equal(after1.channel, before.channel);
  assert.equal(after1.created_at, before.created_at);
  assert.equal(after1.workspace_id, TEAM);

  assert.equal(row(fresh).recipient, "fresh@example.cz", "inside the window is untouched");
  assert.equal(row(refd).recipient, "refd@example.cz", "a ref'd row is the entry's, not this sweep's");
  assert.equal(row(other).recipient, "other@example.cz", "another kind is untouched");
  // The sweep is global: another workspace's old row IS due.
  assert.equal(row(otherWs).recipient, null, "global across workspaces");
});

test("an old ko_declined event loses its label, keeps its facts, and the funnel does not move", () => {
  const oldId = koEvent("Declined Old", 40);
  const freshId = koEvent("Declined Fresh", 3);
  const countBefore = pipelineAnalytics(null, undefined, TEAM).koDeclined;

  sweepKoDeclineContacts(NOW.toISOString());

  const o = event(oldId);
  assert.equal(o.candidate_label, null);
  assert.equal(o.kind, "ko_declined");
  assert.equal(o.job_title, "Retention Engineer");
  assert.match(o.detail ?? "", /ko_workauth/);
  assert.equal(o.workspace_id, TEAM);
  assert.equal(event(freshId).candidate_label, "Declined Fresh");
  assert.equal(pipelineAnalytics(null, undefined, TEAM).koDeclined, countBefore, "turned-away count is unchanged");
});

test("a second sweep changes nothing", () => {
  koEvent("Declined Again", 60);
  outbox({ recipient: "again@example.cz", daysAgo: 60 });
  assert.ok(sweepKoDeclineContacts(NOW.toISOString()) > 0);
  assert.equal(sweepKoDeclineContacts(NOW.toISOString()), 0);
});

test("anonymizeEntry blanks the matching ref-less row in its own workspace only", () => {
  const address = "Applicant.Later@Example.cz";
  const mine = outbox({ recipient: address.toLowerCase(), daysAgo: 1 });
  const mineOther = outbox({ recipient: "someone.else@example.cz", daysAgo: 1 });
  const elsewhere = outbox({ recipient: address.toLowerCase(), ws: "team-ko-other", daysAgo: 1 });
  const { entry } = createPipelineEntry({
    candidateId: "cand-ko-later",
    candidateLabel: "Later Applicant",
    jobId: "job-ko-later",
    jobTitle: "Retention Engineer",
    contact: `  ${address}  `,
    workspaceId: TEAM,
  });

  anonymizeEntry(entry.id, "erasure", TEAM);

  assert.equal(row(mine).recipient, null);
  assert.equal(row(mine).subject, null);
  assert.equal(row(mine).body, null);
  assert.equal(row(mine).kind, "ko_decline");
  assert.equal(row(mineOther).recipient, "someone.else@example.cz");
  assert.equal(row(elsewhere).recipient, address.toLowerCase(), "another workspace's row is never touched");
  assert.ok(getOutboxEntry(mine, TEAM), "the row stays as the delivery audit");
});

test("expiry erases by address the same way", () => {
  const id = outbox({ recipient: "expiring@example.cz", daysAgo: 2 });
  const { entry } = createPipelineEntry({
    candidateId: "cand-ko-expiry",
    candidateLabel: "Expiring Applicant",
    jobId: "job-ko-expiry",
    jobTitle: "Retention Engineer",
    contact: "expiring@example.cz",
    workspaceId: TEAM,
  });
  anonymizeEntry(entry.id, "expiry", TEAM);
  assert.equal(row(id).recipient, null);
});

// Since the Q1 ruling (2026-11-09) a failed must-have files a HELD entry, so the contact is
// carried by the ENTRY and the letter sent when a person confirms the rejection is the
// entry's own row (ref = entry id). The 30-day window above therefore governs only the
// LEGACY ref-less rows (every decline before Q1) — nothing was shortened or lengthened:
// the sweep and its pins stay as they were, and the entry's own retention rule (consent
// expiry → anonymizeEntry, or erasure on request) now covers the new rows.
test("the confirmed letter is the entry's own row, so the entry's erasure scrubs it — and the sweep leaves it alone", async () => {
  const address = "held.letter@example.cz";
  const { entry } = createPipelineEntry({
    candidateId: "cand-ko-held-letter",
    candidateLabel: "Held Letter",
    jobId: "job-ko-held-letter",
    jobTitle: "Retention Engineer",
    contact: address,
    locale: "en",
    workspaceId: TEAM,
  });
  await dispatchKnockoutRejection(entry, ["ko_auth"]);
  const letter = ensureDb()
    .prepare(`SELECT id, ref, recipient, body FROM dev_outbox WHERE recipient = ? AND kind = 'ko_decline'`)
    .get(address) as { id: string; ref: string | null; recipient: string | null; body: string | null };
  assert.equal(letter.ref, entry.id, "ref'd to the entry");
  ensureDb().prepare(`UPDATE dev_outbox SET created_at = ? WHERE id = ?`).run(iso(400), letter.id);

  sweepKoDeclineContacts(NOW.toISOString());
  assert.equal(row(letter.id).recipient, address, "the 30-day sweep is for ref-less rows; an entry's letter is the entry's");

  anonymizeEntry(entry.id, "erasure", TEAM);
  assert.equal(row(letter.id).recipient, null, "erasing the entry scrubs the letter's recipient");
  assert.equal(row(letter.id).body, null, "…and its body");
});

test("the letter makes no 30-day claim in any locale: the contact is on the entry now, under the entry's own retention", () => {
  for (const locale of LOCALES) {
    const messages = JSON.parse(readFileSync(path.join(process.cwd(), "messages", `${locale}.json`), "utf-8"));
    const t = createTranslator({ locale, messages, namespace: "comms" });
    const body = t("koDecline.body", { name: "N", role: "R", team: "T", mustHaves: "- x", hasContact: "no", contact: "" });
    assert.ok(!body.includes(String(KO_DECLINE_CONTACT_RETENTION_DAYS)), `${locale}: the letter must not promise the retired 30-day window`);
    assert.ok(!/\{days\}/.test(body), `${locale}: no unrendered placeholder`);
  }
});
