// Bug-ui-scan 2026-07-09 data-store #1 — seedAnalyses must be NON-DESTRUCTIVE.
//
// The seeded `seed-<id>` analyses are the app's shipped working set and ARE
// editable in-product: a recruiter sets a disposition + decision note
// (setAnalysisDisposition), attaches a GitHub deep-dive (setAnalysisGithub), and
// the save path stamps review_flags. On every server restart ensureDb() re-runs
// seedAnalyses UNCONDITIONALLY. The old `INSERT OR REPLACE` was delete-then-insert
// over a stale 8-column list, so a reboot NULLED disposition / decision_note /
// review_flags / github_json on those rows — silent, timer-driven loss of the
// human hiring decision AiDisclosure promises. This drives the REAL store writers
// against an isolated throwaway DB, simulates a reboot (drop the memoized handle
// and re-run the initializer), and asserts the recruiter/computed columns SURVIVE.
//
// Non-vacuity: against the pre-fix `INSERT OR REPLACE` the re-seed deletes and
// re-inserts the row with only the 8 seed columns, so disposition + github_json
// (and review_flags) read back NULL after the reboot and every post-reboot
// assertion below fails. It passes only because ON CONFLICT(slug) DO UPDATE SET
// touches solely the seed-owned columns. (Confirmed by temporarily restoring
// `INSERT OR REPLACE` — the four survival asserts fail.)
//
// testing/unit-db.ts MUST be the first project import — it sets KP_DB_PATH before
// db-path.ts is evaluated by core.ts's transitive import, so every store opens the
// per-process throwaway file (mkdtempSync), never a developer's real data/kp.sqlite.
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { ensureDb } from "./core.ts";
import { setAnalysisDisposition, setAnalysisGithub, loadAnalysis } from "./analyses.ts";
import { anonymizeProfile } from "./profiles.ts";
import { anonymizeEntry } from "./pipeline.ts";

after(() => cleanupUnitDb());

const holder = globalThis as typeof globalThis & { __kpDb?: { close(): void } };

// Drop the memoized connection so the NEXT ensureDb() re-runs the whole
// CREATE/ALTER/seed/backfill initializer against the already-seeded file —
// exactly what a process restart / deploy / HMR reload does.
function simulateReboot(): void {
  holder.__kpDb?.close();
  holder.__kpDb = undefined;
  ensureDb();
}

type ProtectedCols = {
  disposition: string | null;
  decision_note: string | null;
  review_flags: number | null;
  github_json: string | null;
  workspace_id: string | null;
  payload_json: string;
};

function readRow(slug: string): ProtectedCols {
  return ensureDb()
    .prepare(
      `SELECT disposition, decision_note, review_flags, github_json, workspace_id, payload_json
       FROM analyses WHERE slug = ?`
    )
    .get(slug) as ProtectedCols;
}

test("re-seeding preserves recruiter dispositions + GitHub deep-dives on seeded rows", () => {
  ensureDb(); // first boot: seed the shipped seed-<id> analyses population

  // Target a genuinely seeded row (the shipped working set), not one we inserted.
  const seeded = ensureDb()
    .prepare(`SELECT slug FROM analyses WHERE slug LIKE 'seed-%' ORDER BY slug LIMIT 1`)
    .get() as { slug: string } | undefined;
  assert.ok(seeded, "expected the seed_analyses population to be seeded on first boot");
  const slug = seeded.slug;

  // A recruiter edits the seeded candidate's report: disposition + note + a
  // GitHub deep-dive; a save also stamped review_flags (later-computed data).
  const githubJson = JSON.stringify({ summary: "strong OSS history", stars: 128 });
  assert.equal(setAnalysisDisposition(slug, "advance", "strong systems-design signal"), true);
  assert.equal(setAnalysisGithub(slug, githubJson), true);
  ensureDb().prepare(`UPDATE analyses SET review_flags = 3 WHERE slug = ?`).run(slug);

  // Guard against a vacuous pass: the writes actually landed BEFORE the reboot.
  const before = readRow(slug);
  assert.equal(before.disposition, "advance");
  assert.equal(before.decision_note, "strong systems-design signal");
  assert.equal(before.review_flags, 3);
  assert.equal(before.github_json, githubJson);
  assert.equal(before.workspace_id, "workspace");

  // Server restart: seedAnalyses re-runs unconditionally over the same file.
  simulateReboot();

  // The human/computed columns MUST survive the re-seed (pre-fix: all NULL).
  const after = readRow(slug);
  assert.equal(after.disposition, "advance", "disposition was wiped by re-seed");
  assert.equal(after.decision_note, "strong systems-design signal", "decision_note was wiped by re-seed");
  assert.equal(after.review_flags, 3, "review_flags was wiped by re-seed");
  assert.equal(after.github_json, githubJson, "github_json (GitHub deep-dive) was wiped by re-seed");
  // workspace_id must stay healed (was re-NULLed then re-backfilled under REPLACE).
  assert.equal(after.workspace_id, "workspace", "workspace_id backfill regressed");

  // The seed still refreshed the row's seed-owned payload (upsert, not skip).
  assert.ok(after.payload_json && after.payload_json.length > 0, "seed payload should still be present");

  // The full read path still resolves the row with its preserved decision.
  const loaded = loadAnalysis(slug);
  assert.ok(loaded, "loadAnalysis resolves the seeded row after reboot");
  assert.equal(loaded.row.disposition, "advance");
  assert.equal(loaded.row.github_json, githubJson);
});

// ---- The sibling seeder: seedCandidates over the shipped `cand-*` profiles ----
//
// Same class of defect, same file. seedCandidates used `INSERT OR REPLACE` (delete-
// then-insert) over a 7-column list that predates workspace_id and the lineage /
// divergence stamps, and it too runs UNCONDITIONALLY on every boot. 54 of the shipped
// pipeline entries carry a `cand-*` candidate_id, so anonymizeEntry → anonymizeProfile
// (GDPR erasure / consent expiry) masked the name and scrubbed the CV payload in
// place — and the very next restart re-inserted BOTH straight from the committed seed
// JSON. Erasure that un-erases itself on a timer is the worst possible failure here.
type ProfileCols = { label: string; payload_json: string; updated_at: string | null };
const readProfile = (id: string): ProfileCols =>
  ensureDb().prepare(`SELECT label, payload_json, updated_at FROM profiles WHERE id = ?`).get(id) as ProfileCols;

test("re-seeding never resurrects an ERASED seeded candidate profile (GDPR Art. 17)", () => {
  ensureDb(); // the shipped cand-* population is seeded on boot
  const seeded = ensureDb()
    .prepare(`SELECT id FROM profiles WHERE id LIKE 'cand-%' ORDER BY id LIMIT 1`)
    .get() as { id: string } | undefined;
  assert.ok(seeded, "expected the shipped cand-* candidate population to be seeded");
  const id = seeded.id;
  const original = readProfile(id);

  // A candidate exercises their right to erasure (or their consent lapses): the label
  // is masked and the CV payload deep-scrubbed in place.
  assert.equal(anonymizeProfile(id, "workspace"), true, "the seeded profile is erasable");
  const erased = readProfile(id);
  // Guard against a vacuous pass: the erasure actually changed the row BEFORE the reboot.
  assert.notEqual(erased.label, original.label, "the erasure masked the candidate's name");
  assert.notEqual(erased.payload_json, original.payload_json, "the erasure scrubbed the CV payload");
  assert.ok(erased.updated_at, "the content write stamped updated_at");

  // Server restart: seedCandidates re-runs unconditionally over the same file.
  simulateReboot();

  const after = readProfile(id);
  assert.equal(after.label, erased.label, "the boot re-seed resurrected the erased candidate's NAME");
  assert.equal(after.payload_json, erased.payload_json, "the boot re-seed resurrected the erased CV PAYLOAD");
});

test("…yet an untouched seeded profile still refreshes from the committed corpus (non-vacuous)", () => {
  const pristine = ensureDb()
    .prepare(`SELECT id, label FROM profiles WHERE id LIKE 'cand-%' AND updated_at IS NULL ORDER BY id DESC LIMIT 1`)
    .get() as { id: string; label: string } | undefined;
  assert.ok(pristine, "expected a pristine (never app-written) seeded profile");
  // Stand in for a regenerated seed corpus: drift the stored row WITHOUT the product
  // writing it (updated_at stays NULL), exactly as a re-generated seed JSON would look.
  ensureDb().prepare(`UPDATE profiles SET label = 'DRIFTED' WHERE id = ?`).run(pristine.id);
  simulateReboot();
  assert.equal(
    readProfile(pristine.id).label,
    pristine.label,
    "a pristine seed row must still be refreshed from the committed seed JSON"
  );
});

// The two columns the seed upsert DOES own — candidate_label and payload_json — are
// exactly the two anonymizeEntry scrubs on a linked analysis, so preserving
// disposition/github_json alone was not enough: the CV payload came straight back on
// the next boot. 54 shipped pipeline entries resolve to a seeded analysis by label.
test("re-seeding never resurrects an ERASED seeded analysis (GDPR Art. 17)", () => {
  const link = ensureDb()
    .prepare(
      `SELECT a.slug AS slug, e.id AS entryId
         FROM analyses a
         JOIN pipeline_entries e
           ON LOWER(TRIM(a.candidate_label)) = LOWER(TRIM(e.candidate_label))
          AND a.workspace_id = e.workspace_id
        WHERE a.slug LIKE 'seed-%' AND e.anonymized_at IS NULL
        ORDER BY a.slug LIMIT 1`
    )
    .get() as { slug: string; entryId: string } | undefined;
  assert.ok(link, "expected a seeded analysis reachable from a seeded pipeline entry");
  const readCv = (slug: string) =>
    ensureDb().prepare(`SELECT candidate_label, payload_json FROM analyses WHERE slug = ?`).get(slug) as {
      candidate_label: string;
      payload_json: string;
    };
  const before = readCv(link.slug);

  // The candidate exercises their right to erasure via the public /data/[token] page.
  assert.ok(anonymizeEntry(link.entryId, "erasure"), "the seeded entry is erasable");
  const erased = readCv(link.slug);
  // Guard against a vacuous pass: the erasure reached the analysis BEFORE the reboot.
  assert.notEqual(erased.candidate_label, before.candidate_label, "the erasure masked the name on the analysis");
  assert.notEqual(erased.payload_json, before.payload_json, "the erasure scrubbed the CV payload on the analysis");

  simulateReboot();

  const after = readCv(link.slug);
  assert.equal(after.candidate_label, erased.candidate_label, "the boot re-seed resurrected the erased NAME");
  assert.equal(after.payload_json, erased.payload_json, "the boot re-seed resurrected the erased CV PAYLOAD");
});

test("a genuinely new seed row still inserts on a truly empty DB (one-time seed intact)", () => {
  // The first test already forced at least one boot; assert the shipped seed
  // population is present and each carries the backfilled default workspace, i.e.
  // the legitimate one-time seed + workspace_id backfill for NEW rows is unchanged.
  const rows = ensureDb()
    .prepare(`SELECT COUNT(*) AS n FROM analyses WHERE slug LIKE 'seed-%' AND workspace_id = 'workspace'`)
    .get() as { n: number };
  assert.ok(rows.n > 0, "seeded rows exist and are backfilled to the default workspace");
});
