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
import { PIPELINE_STEPS } from "./DevHelpers.ts";

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

function translator(locale: Locale, namespace = "devcase.studio") {
  const messages = JSON.parse(readFileSync(path.join(process.cwd(), "messages", `${locale}.json`), "utf-8"));
  const t = createTranslator({ locale, messages, namespace }) as unknown as (
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
  // Round 9 — the need form, the entrance to the whole loop.
  ["need.jdLabel", {}],
  ["need.savedJdAria", {}],
  ["need.pickJd", {}],
  ["need.loadingJd", {}],
  ["need.jdReadHint", {}],
  ["need.jdRequired", {}],
  ["need.codebasesLabel", { max: 3 }],
  ["need.repoPlaceholder", {}],
  ["need.codebaseAria", { n: 1 }],
  ["need.removeCodebaseAria", { n: 2 }],
  ["need.unsupportedRepo", {}],
  ["need.addCodebase", {}],
  ["need.seniorityLabel", {}],
  ["need.seniorityAria", {}],
  ["need.lifecycleTitle", {}],
  ["need.lifecycleRunning", {}],
  ["need.runLifecycle", {}],
  ["need.reflecting", {}],
  ["need.analyzeOnly", {}],
  ["need.recent", {}],
  // Round 10: the masthead. The three sub-tab headings lived in DevTabViews.ts as
  // English literals and are now keys; `sectionsLabel` is the tablist's accessible
  // name, which used to be the literal "Dev studio sections". The define blurb is the
  // only one that takes a value, and it is the SHARED codebase cap - a locale that
  // drops the placeholder promises the reader a different number than the form
  // enforces, so the value is passed exactly as DevTab passes it.
  ["sectionsLabel", {}],
  ["views.cases.label", {}],
  ["views.cases.title", {}],
  ["views.cases.blurb", {}],
  ["views.define.label", {}],
  ["views.define.title", {}],
  ["views.define.blurb", { max: 3 }],
  ["views.outbox.label", {}],
  ["views.outbox.title", {}],
  ["views.outbox.blurb", {}],
];

// The round-9 namespaces that sit under `devcase`, not `devcase.studio`: they are
// shared vocabularies (a provenance word, an interviewer's lead, a score's accessible
// name) rather than one screen's copy, so they hang beside `devcase.probeKind`.
const DEVCASE_CALLS: [string, Record<string, unknown>][] = [
  // Round 10: the stale-banner's subject. It was the bare English noun "the comms
  // outbox" passed into LoadStatus, on both the empty and the populated branch.
  ["outbox.loadLabel", {}],
  ["provenance.chipTitle", { step: "Evaluate", source: "Claude CLI" }],
  ["provenance.aria", { detail: "Evaluate via Claude CLI" }],
  ["provenance.ariaStep", { step: "Evaluate", source: "Claude CLI" }],
  ["provenance.source.llm", {}],
  ["provenance.source.partial", {}],
  ["provenance.source.deterministic", {}],
  ...PIPELINE_STEPS.map((k) => [`provenance.step.${k}`, {}] as [string, Record<string, unknown>]),
  ["followup.listenFor", { note: "how they picked the seam" }],
  ["followup.redFlag", { note: "rewrote the module wholesale" }],
  ["scoreBar.aria", { label: "Judgment", score: 71 }],
  ["scoreBar.ariaWeighted", { label: "Judgment", score: 71, weight: 25 }],
  ["outcomeStrip.reviewInDecisions", {}],
  ["outcomeStrip.recorded", { outcome: "hired" }],
  ["outcomeStrip.perfLabel", {}],
  ["outcomeStrip.perfAria", { n: 3 }],
  ["outcomeStrip.skipPerf", {}],
  ["outcomeStrip.hint", {}],
  ["outcomeStrip.label", {}],
  ["skillProfile.issue", {}],
  ["skillProfile.reissue", {}],
  ["skillProfile.issuing", {}],
  ["skillProfile.view", {}],
  ["skillProfile.failed", {}],
  ["submissionForm.candidatePlaceholder", {}],
  ["submissionForm.repoPlaceholder", {}],
  ["submissionForm.record", {}],
  ["submissionForm.recording", {}],
  ["submissionForm.failed", {}],
  ["submissionForm.network", {}],
  ["submissionForm.receiptRecorded", {}],
  ["submissionForm.receiptDuplicate", {}],
  ["review.tasksRequired", {}],
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

for (const locale of LOCALES) {
  test(`devcase (${locale}): the round-9 shared vocabularies render`, () => {
    const t = translator(locale, "devcase");
    for (const [key, values] of DEVCASE_CALLS) {
      const out = String(t(key, values)).trim();
      assert.ok(out.length > 0, `${locale} devcase.${key} rendered empty`);
      assert.ok(!out.includes("devcase."), `${locale} devcase.${key} is missing (next-intl echoed the key): ${out}`);
      assert.ok(!/[{}]/.test(out), `${locale} devcase.${key} left an unresolved placeholder: ${out}`);
    }
  });
}

test("the sub-tab definitions carry KEYS, and every one of them resolves in all four locales", () => {
  // The masthead is the one place a reader looks to find out what surface they are on,
  // and DevTabViews.ts used to answer in English only: `{ id: "cases", label: "Assignments" }`
  // plus a VIEW_HEADING table of English titles and blurbs, rendered UNDER a localized
  // eyebrow. The source ratchet above cannot see any of it - its extractor reads JSX text
  // and literal attributes, and this is a plain .ts module - so nothing in the suite could
  // have noticed. This is the guard that fits the shape: the module must hold KEYS, and
  // every key it holds must exist in every catalog.
  const src = readFileSync(path.join(DIR, "DevTabViews.ts"), "utf8");
  const keys = [...src.matchAll(/(?:labelKey|titleKey|blurbKey):\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.equal(keys.length, 9, "three views x label/title/blurb - the module changed shape and this guard is blind");

  // NON-VACUITY / fail-first: against HEAD these fields were `label:` / `title:` / `blurb:`
  // holding sentences, so the match above found nothing and this assertion failed first.
  for (const key of keys) {
    assert.match(key, /^views\.(cases|define|outbox)\.(label|title|blurb)$/, `${key} is not a catalog key`);
  }

  for (const locale of LOCALES) {
    const t = translator(locale);
    for (const key of keys) {
      // The define blurb takes the shared codebase cap; the others ignore it.
      const out = String(t(key, { max: 3 })).trim();
      assert.ok(out.length > 0 && !out.includes("devcase.studio"), `${locale} is missing devcase.studio.${key}`);
      assert.ok(!/[{}]/.test(out), `${locale} devcase.studio.${key} left an unresolved placeholder: ${out}`);
    }
  }
});

test("every pipeline step the strip can be handed has a catalog name, in both directions", () => {
  // The strip degrades an unknown step to a capitalised raw id — good behaviour, and
  // exactly the fallback that hid nine missing keys the last time this surface was
  // audited. Equality in BOTH directions is what stops it becoming the normal path.
  const messages = JSON.parse(readFileSync(path.join(process.cwd(), "messages", "en.json"), "utf-8"));
  const catalog = Object.keys(messages.devcase.provenance.step);
  assert.deepEqual(catalog.slice().sort(), [...PIPELINE_STEPS].sort());
});

test("the empty-library sentence keeps its one link, in every locale", () => {
  // A rich message, so the plain-`t` sweep above cannot render it: `<link>` is a tag
  // the component supplies, and a locale that drops or renames it silently loses the
  // only way out of the empty state.
  for (const locale of LOCALES) {
    const messages = JSON.parse(readFileSync(path.join(process.cwd(), "messages", `${locale}.json`), "utf-8"));
    const t = createTranslator({ locale, messages, namespace: "devcase.studio.need" });
    const parts: string[] = [];
    const out = t.rich("noJds" as never, {
      link: (chunks: unknown) => {
        parts.push(String(chunks));
        return `[${String(chunks)}]`;
      },
    } as never);
    assert.equal(parts.length, 1, `${locale} devcase.studio.need.noJds must wrap exactly one <link> chunk`);
    assert.ok(parts[0].trim().length > 0, `${locale} left the link text empty`);
    assert.ok(String(out).length > parts[0].length, `${locale} rendered nothing around the link`);
  }
});
