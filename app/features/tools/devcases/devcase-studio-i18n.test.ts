// devcase-studio-i18n — the Assignments studio's copy, pinned from both ends.
//
// WHY THIS FILE EXISTS. Roughly forty user-facing strings on this surface were
// hardcoded English in a four-locale product, and NOTHING was ever going to catch
// them: `eslint.config.mjs` deliberately keeps `app/features/tools/devcases/**`
// outside the `i18next/no-literal-string` ERROR list ("dev-facing copy"), so the
// rule only ever ran at `warn` here and a red build never happened. This test is
// the ratchet that block would otherwise be — scoped to the files this pass
// migrated, so the rest of the studio stays a declared gap rather than a silent one.
//
// Two halves, matching the shape of app/features/hiring/channels/channels-i18n.test.ts:
//   1. SOURCE — no user-visible literal survives in the migrated files. A regex, not
//      a parser: it is a RATCHET, not a proof. It sees JSX text nodes and literal
//      title/aria-label/placeholder/label/alt attributes, which is exactly the class
//      that regressed here; something smuggled through a helper or a template
//      expression can still get past it, and the catalog half below is what covers
//      the copy that IS wired up.
//   2. CATALOG — every key the surface calls renders, in all four locales, with the
//      real values the components pass. `tsc` cannot do this: a plural branch that
//      drops `#`, or a message missing from cs/de/fr, type-checks fine and renders a
//      hole (or the raw key) to the reader.
//
// Runner: Node's built-in test runner with type stripping — npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createTranslator } from "next-intl";
import { LOCALES, type Locale } from "@/i18n/locales";
import { DEGRADED_REASONS } from "./DevCaseDetail.publish.ts";
import { STUDIO_LOCALIZED_FILES, visibleLiterals } from "./devcaseStudioCopy.ts";

const DIR = path.dirname(fileURLToPath(import.meta.url));

test("no migrated studio file carries a user-visible English literal", () => {
  const offenders: string[] = [];
  for (const file of STUDIO_LOCALIZED_FILES) {
    for (const lit of visibleLiterals(readFileSync(path.join(DIR, file), "utf8"))) {
      offenders.push(`${file} :: ${lit}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "these render English to a cs/de/fr reader. Put the string in messages/en.json under devcase.studio " +
      "(plus cs/de/fr in the same change) and call it through useTranslations"
  );
});

test("the ratchet can still see a literal (the detector is not vacuously green)", () => {
  // A guard that cannot fail is a comment. Prove the matcher on the exact shape the
  // header shipped before this pass.
  const sample = '<h3 className="x">Publish this case?</h3><span title="Rank the existing candidate DB">y</span>';
  assert.deepEqual(visibleLiterals(sample), ["Publish this case?", "Rank the existing candidate DB"]);
});

// ---- the catalog half -------------------------------------------------------

function translator(locale: Locale) {
  const messages = JSON.parse(readFileSync(path.join(process.cwd(), "messages", `${locale}.json`), "utf-8"));
  const t = createTranslator({ locale, messages, namespace: "devcase.studio" }) as unknown as (
    key: string,
    values?: Record<string, unknown>
  ) => string;
  return t;
}

/** The write actions, read off their PRODUCER rather than re-typed: `runAction`
 *  builds its banner sentence from `action.<id>`, so an id the hook can pass and the
 *  catalogs do not carry would put a raw key in front of a recruiter. */
function devActionIds(): string[] {
  const src = readFileSync(path.join(DIR, "useDevTabActions.ts"), "utf8");
  const m = src.match(/export type DevAction =([^;]*);/);
  assert.ok(m, "could not locate `export type DevAction` — the hook changed shape and this guard is blind");
  return [...m![1].matchAll(/"([A-Za-z_]+)"/g)].map((x) => x[1]);
}

// (key, values) exactly as the components call them.
const CALLS: [string, Record<string, unknown>][] = [
  ["dismiss", {}],
  ["loadLabel", {}],
  ["analysis.empty", {}],
  ["analysis.running", {}],
  ["analysis.runningHint", {}],
  ["analysis.designing", {}],
  ["analysis.designingHint", {}],
  ["analysis.designCta", {}],
  ["analysis.snapshot", {}],
  ["analysis.snapshotIndexed", { index: 2, total: 3 }],
  ["analysis.loc", { loc: "12,400" }],
  ["analysis.topDirs", { dirs: "app / pipeline / scripts" }],
  ["analysis.commitsRead", { count: 1 }],
  ["analysis.commitsRead", { count: 2 }],
  ["analysis.commitsRead", { count: 12 }],
  ["analysis.noSnapshot", {}],
  ["analysis.resultUnreadable", {}],
  ["analysis.failed", {}],
  ["reflection.title", {}],
  ["reflection.complexity", { level: "high" }],
  ["reflection.confidence", { value: "0.72" }],
  ["reflection.gaps", {}],
  ["reflection.risks", { areas: "auth · billing" }],
  ["design.role", {}],
  ["design.mustHaves", {}],
  ["design.responsibilities", {}],
  ["design.assignment", {}],
  ["design.timebox", { hours: 2 }],
  ["design.covertProbes", {}],
  ["design.approved", {}],
  ["design.approving", {}],
  ["design.approve", {}],
  ["design.humanGate", {}],
  ["detail.back", {}],
  ["detail.created", { when: "3d ago" }],
  ["detail.scenarioTemplate", {}],
  ["detail.scenarioTemplateHint", {}],
  ["detail.scenarioReady", {}],
  ["detail.seedSkeleton", {}],
  ["detail.seedSkeletonHint", {}],
  ["detail.publish", {}],
  ["detail.publishing", {}],
  ["detail.published", {}],
  ["detail.sourceDb", {}],
  ["detail.sourcing", {}],
  ["detail.sourced", { count: 7 }],
  ["detail.sourceHint", {}],
  ["detail.confirmLabel", {}],
  ["detail.confirmTitle", {}],
  ["detail.confirmBody", {}],
  ["detail.degradedTitle", {}],
  ["detail.degradedAck", {}],
  ["detail.confirmCta", {}],
  ["detail.cancel", {}],
  ["detail.seedSummary", {}],
  ["detail.seedFiles", { count: 1 }],
  ["detail.seedFiles", { count: 2 }],
  ["detail.seedFiles", { count: 9 }],
  ["detail.seedSkeletonWarning", {}],
  ["internal.title", {}],
  ["internal.noProbes", {}],
  ["internal.roleMustHaves", {}],
  ["internal.roleResponsibilities", {}],
  ["shortlist.title", {}],
  ["channels.title", {}],
  ["channels.posting", {}],
  ["channels.received", { count: 4 }],
  ["channels.applyLink", {}],
  ["compare.title", {}],
  ["compare.topOf", { shown: 5, total: 9 }],
  ["compare.truncated", { shown: 5, hidden: 1 }],
  ["compare.truncated", { shown: 5, hidden: 4 }],
  ["compare.axis", {}],
  ["compare.fit", { score: 71 }],
  ["applyPill.noToken", {}],
  ["applyPill.copy", {}],
  ["applyPill.copyAria", {}],
  ["applyPill.copiedAria", {}],
  ["applyPill.copied", {}],
  ["applyPill.token", { token: "a1b2c3" }],
  ["applyPill.blocked", {}],
  ["waiting.title", {}],
  ["waiting.body", {}],
  ["jds.failed", {}],
  ["jds.retry", {}],
  ["actionFailed", { action: "Publish" }],
  ["actionUnreachable", { action: "Publish" }],
];

for (const locale of LOCALES) {
  test(`devcase.studio (${locale}): every message renders with the values the UI passes`, () => {
    const t = translator(locale);
    const calls: [string, Record<string, unknown>][] = [
      ...CALLS,
      ...DEGRADED_REASONS.map((r) => [`degradedReason.${r}`, {}] as [string, Record<string, unknown>]),
      ...devActionIds().map((a) => [`action.${a}`, {}] as [string, Record<string, unknown>]),
    ];
    for (const [key, values] of calls) {
      const out = String(t(key, values)).trim();
      assert.ok(out.length > 0, `${locale} devcase.studio.${key} rendered empty`);
      assert.ok(
        !out.includes("devcase.studio"),
        `${locale} devcase.studio.${key} is missing (next-intl echoed the key): ${out}`
      );
      assert.ok(!/[{}]/.test(out), `${locale} devcase.studio.${key} left an unresolved placeholder: ${out}`);
    }
  });
}
