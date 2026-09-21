// Tenant scope — proof for job_translations (the role posting rendered into another
// language, db/job-translations.ts).
//
// The rule is the strict one, with an EMPTY exemption list: every query — point reads
// included — must bind workspace_id. There is deliberately NO shared NULL tier here,
// even though the ROLE a translation belongs to may itself be a shared corpus row
// (jobs.workspace_id NULL): the translation was generated on one team's order and
// against one team's LLM spend, so a leaked job id must not hand another team the body
// they paid for.
//
// Two halves: the source guard (every statement binds the column) and a behavioral
// drive of the real store across two workspaces.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  getJobTranslation,
  listJobTranslationLangs,
  listJobTranslations,
  saveJobTranslation,
  deleteJobTranslations,
} from "./job-translations.ts";
import { TENANCY_SCOPED_TABLES } from "../tenancy.ts";

after(() => cleanupUnitDb());

const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "job-translations.ts"), "utf8");
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

const TOUCHES = /\b(from|into|update|join)\s+job_translations\b/i;

/** workspace_id must be BOUND — a predicate or an INSERT column — never merely
 *  mentioned (a SELECT-list column name is the hollow-guard shape). */
function bindsWorkspace(sql: string): boolean {
  if (/workspace_id\s*(=|IN\b|IS\b)/i.test(sql)) return true;
  return /INSERT\s+INTO\s+[a-z_]+\s*\([^)]*\bworkspace_id\b[^)]*\)/i.test(sql);
}

test("job_translations: every query binds workspace_id (no by-id exemptions)", () => {
  const touching = sqlBlocks.filter((s) => TOUCHES.test(s));
  assert.ok(touching.length >= 4, `expected >=4 job_translations queries, found ${touching.length}`);
  for (const sql of touching) {
    assert.ok(bindsWorkspace(sql), `a job_translations query does not BIND workspace_id:\n${sql.trim().slice(0, 240)}`);
  }
});

test("job_translations is declared in the tenancy manifest", () => {
  // The manifest is fail-closed: a persistent table missing from it is a reported gap.
  assert.ok(TENANCY_SCOPED_TABLES.has("job_translations"));
});

// ---- behavioral ------------------------------------------------------------

const A = "ws-tenant-a";
const B = "ws-tenant-b";

test("nothing crosses: the same role's translations are per-team", () => {
  saveJobTranslation({ jobId: "role-1", lang: "cs", sourceLang: "en", title: "Vyvojar", bodyMd: "Tym A" }, A);
  saveJobTranslation({ jobId: "role-1", lang: "cs", sourceLang: "en", title: "Entwickler", bodyMd: "Team B" }, B);

  assert.equal(getJobTranslation("role-1", "cs", A)?.bodyMd, "Tym A");
  assert.equal(getJobTranslation("role-1", "cs", B)?.bodyMd, "Team B");
  // The language list is per team too — B's row must not make A think it holds `de`.
  saveJobTranslation({ jobId: "role-1", lang: "de", sourceLang: "en", title: "Entwickler", bodyMd: "Team B de" }, B);
  assert.deepEqual(listJobTranslationLangs("role-1", A), ["cs"]);
  assert.deepEqual(listJobTranslationLangs("role-1", B), ["cs", "de"]);
  assert.deepEqual(
    listJobTranslations("role-1", A).map((tr) => tr.lang),
    ["cs"]
  );
});

test("re-generating a language REPLACES its body rather than accumulating drafts", () => {
  saveJobTranslation({ jobId: "role-2", lang: "fr", sourceLang: "en", title: "V1", bodyMd: "first" }, A);
  saveJobTranslation({ jobId: "role-2", lang: "fr", sourceLang: "en", title: "V2", bodyMd: "second" }, A);
  const all = listJobTranslations("role-2", A);
  assert.equal(all.length, 1);
  assert.equal(all[0].bodyMd, "second");
  assert.equal(all[0].title, "V2");
  // …and the replacement stayed inside the tenant.
  assert.equal(getJobTranslation("role-2", "fr", B), null);
});

test("a re-ingest drops ONE team's renderings of a role, never the other team's", () => {
  saveJobTranslation({ jobId: "role-3", lang: "cs", sourceLang: "en", title: "A cs", bodyMd: "Tym A" }, A);
  saveJobTranslation({ jobId: "role-3", lang: "de", sourceLang: "en", title: "A de", bodyMd: "Team A" }, A);
  saveJobTranslation({ jobId: "role-3", lang: "cs", sourceLang: "en", title: "B cs", bodyMd: "Tym B" }, B);
  assert.equal(deleteJobTranslations("role-3", A), 2);
  assert.deepEqual(listJobTranslationLangs("role-3", A), []);
  assert.deepEqual(listJobTranslationLangs("role-3", B), ["cs"]);
  assert.equal(deleteJobTranslations("role-3", A), 0);
});
