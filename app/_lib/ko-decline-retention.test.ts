// ADR 0019 — what an entry-less KO decline leaves behind, and when it goes.
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
import {
  anonymizeEntry,
  createPipelineEntry,
  ensureDb,
  getOutboxEntry,
  recordOutbox,
} from "./db.ts";
import { KO_DECLINE_CONTACT_RETENTION_DAYS, recordKnockoutDecline, sweepKoDeclineContacts } from "./db/pipeline.ts";
import { pipelineAnalytics } from "./db/analytics.ts";
import { dispatchKnockoutDecline } from "./comms-dispatch.ts";
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

test("the letter carries the window in every locale", () => {
  for (const locale of LOCALES) {
    const messages = JSON.parse(readFileSync(path.join(process.cwd(), "messages", `${locale}.json`), "utf-8"));
    const t = createTranslator({ locale, messages, namespace: "comms" });
    const body = t("koDecline.body", {
      name: "N",
      role: "R",
      team: "T",
      mustHaves: "- x",
      days: KO_DECLINE_CONTACT_RETENTION_DAYS,
    });
    assert.ok(body.includes(String(KO_DECLINE_CONTACT_RETENTION_DAYS)), `${locale}: the letter must state ${KO_DECLINE_CONTACT_RETENTION_DAYS} days`);
    assert.ok(!body.includes("{days}"), `${locale}: placeholder left unrendered`);
  }
});

test("the dispatched letter is composed with the constant", async () => {
  await dispatchKnockoutDecline({ email: "composed@example.cz", name: "Composed", jobTitle: "Retention Engineer", locale: "en", workspaceId: TEAM });
  const sent = ensureDb()
    .prepare(`SELECT body FROM dev_outbox WHERE recipient = 'composed@example.cz' AND kind = 'ko_decline'`)
    .get() as { body: string };
  assert.match(sent.body, new RegExp(`after ${KO_DECLINE_CONTACT_RETENTION_DAYS} days`));
});
