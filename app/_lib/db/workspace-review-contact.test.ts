// Owner ruling Q7 (docs/product/oss-1.0-cut.md §3): the review-request copy names a contact
// address per workspace, in four locales. Pins:
//   • the store: an email is validated at the write boundary, an empty value clears, and one
//     workspace can neither read nor overwrite another's address;
//   • the resolver every candidate surface shares (disclosureComplianceFor) hands over ONLY
//     the address, from the workspace the surface already holds;
//   • the copy, rendered for real in all four locales: with an address the line names it, and
//     without one it promises no reply door (C6 is out of 1.0) and contains no `reply`;
//   • the PATCH door stays behind team:manage on the TARGET workspace and answers a coded refusal.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createTranslator } from "next-intl";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { createWorkspace, getWorkspace, getWorkspaceReviewContact, setWorkspaceReviewContact } from "./workspaces.ts";
import { disclosureComplianceFor } from "../compliance-disclosure.ts";
import { reviewContactArgs } from "../compliance-regimes.ts";
import { REFUSAL_ERRORS } from "../api-errors/refusal-errors.ts";
import { LOCALES } from "../../../i18n/locales.ts";

after(() => cleanupUnitDb());

test("an address is stored trimmed, read back, and an empty value clears it", () => {
  const ws = createWorkspace("Q7 store");
  assert.equal(getWorkspaceReviewContact(ws.id), null, "a new team names none");
  const set = setWorkspaceReviewContact(ws.id, "  people@example.com ");
  assert.ok(set.ok);
  assert.equal(getWorkspaceReviewContact(ws.id), "people@example.com");
  assert.equal(getWorkspace(ws.id)?.reviewContactEmail, "people@example.com");
  assert.ok(setWorkspaceReviewContact(ws.id, "   ").ok);
  assert.equal(getWorkspaceReviewContact(ws.id), null, "empty clears");
});

test("anything that is not an email is refused and leaves the stored address alone", () => {
  const ws = createWorkspace("Q7 validate");
  assert.ok(setWorkspaceReviewContact(ws.id, "keep@example.com").ok);
  for (const bad of ["not-an-email", "a@b", "two words@example.com", "a@@b.co", `${"x".repeat(250)}@example.com`]) {
    const res = setWorkspaceReviewContact(ws.id, bad);
    assert.deepEqual(res, { ok: false, reason: "invalid" }, bad);
  }
  assert.equal(getWorkspaceReviewContact(ws.id), "keep@example.com");
  assert.deepEqual(setWorkspaceReviewContact("no-such-workspace", "a@example.com"), { ok: false, reason: "not_found" });
});

test("a workspace can neither read nor write another workspace's address", () => {
  const a = createWorkspace("Q7 A");
  const b = createWorkspace("Q7 B");
  assert.ok(setWorkspaceReviewContact(a.id, "a@example.com").ok);
  assert.equal(getWorkspaceReviewContact(b.id), null, "B does not see A's address");
  assert.ok(setWorkspaceReviewContact(b.id, "b@example.com").ok);
  assert.equal(getWorkspaceReviewContact(a.id), "a@example.com", "writing B left A alone");
  assert.equal(disclosureComplianceFor(a.id).reviewContact, "a@example.com");
  assert.equal(disclosureComplianceFor(b.id).reviewContact, "b@example.com");
  assert.equal(disclosureComplianceFor("no-such-workspace").reviewContact, null, "an unknown workspace names none");
});

test("the candidate-facing resolver exposes the address and nothing else about the workspace", () => {
  const ws = createWorkspace("Q7 projection");
  setWorkspaceReviewContact(ws.id, "p@example.com");
  assert.deepEqual(Object.keys(disclosureComplianceFor(ws.id)).sort(), ["regimeId", "retentionMonths", "reviewContact"]);
});

const REVIEW_LINES: { ns: string[]; extra: Record<string, string | number> }[] = [
  { ns: ["aiDisclosure", "interviewData"], extra: { months: 12 } },
  { ns: ["status", "decisions", "humanReviewNote"], extra: {} },
  { ns: ["apply", "declinedReviewEmail"], extra: {} },
  { ns: ["comms", "koDecline", "body"], extra: { name: "N", role: "R", team: "T", mustHaves: "- x" } },
];

test("every review-request line, in every locale, names the address when set and promises no reply when not", () => {
  const address = "review@example.com";
  for (const locale of LOCALES) {
    const messages = JSON.parse(readFileSync(path.join(process.cwd(), "messages", `${locale}.json`), "utf-8"));
    for (const { ns, extra } of REVIEW_LINES) {
      const key = ns.join(".");
      const t = createTranslator({ locale, messages, namespace: ns.slice(0, -1).join(".") as never }) as unknown as (
        k: string,
        v: Record<string, unknown>
      ) => string;
      const leaf = ns[ns.length - 1];
      const withAddress = t(leaf, { ...extra, ...reviewContactArgs(address) });
      const without = t(leaf, { ...extra, ...reviewContactArgs(null) });
      assert.ok(withAddress.includes(address), `${locale} ${key}: names the address`);
      assert.ok(!without.includes("@") && !without.includes("{"), `${locale} ${key}: names none and leaves no placeholder`);
      assert.ok(!/\b(reply|odpovězte|odpovědí na|antworten Sie|répondez|répondre à)/i.test(without), `${locale} ${key}: without an address it does not tell the candidate to reply`);
    }
  }
});

test("the PATCH door: team:manage on the target workspace, a coded refusal for a bad address, the id from the URL only", () => {
  const src = readFileSync(path.join(process.cwd(), "app", "api", "workspaces", "[id]", "route.ts"), "utf-8");
  assert.match(src, /requireWorkspaceCapability\(id, "team:manage"\)/);
  assert.match(src, /setWorkspaceReviewContact\(id,/, "the write targets the workspace in the URL, which the gate just checked");
  assert.match(src, /jsonRefusal\("REVIEW_CONTACT_EMAIL_INVALID", 400\)/);
  assert.ok(REFUSAL_ERRORS.REVIEW_CONTACT_EMAIL_INVALID);
  for (const locale of LOCALES) {
    const errors = (JSON.parse(readFileSync(path.join(process.cwd(), "messages", `${locale}.json`), "utf-8")) as { errors: Record<string, string> }).errors;
    assert.ok(errors.REVIEW_CONTACT_EMAIL_INVALID, `${locale}: the refusal has a catalog entry`);
  }
});

test("candidate surfaces resolve the address from the token/job/session they hold, never from the client", () => {
  for (const rel of [
    ["app", "status", "[token]", "page.tsx"],
    ["app", "interview", "[token]", "page.tsx"],
    ["app", "apply", "[id]", "page.tsx"],
    ["app", "apply", "[id]", "quick", "page.tsx"],
  ]) {
    const src = readFileSync(path.join(process.cwd(), ...rel), "utf-8");
    assert.match(src, /disclosureComplianceFor\(/, `${rel.join("/")}: resolves through the shared server-side resolver`);
    assert.doesNotMatch(src, /searchParams[^;]*workspace/i, `${rel.join("/")}: no workspace id from the query`);
  }
});
