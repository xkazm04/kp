// UAT KAT-L1-004 (rec 2) · RECON-06 (rec 2) · RECON-02 — the "confidence" guard.
//
// WHY THIS FILE EXISTS. Both findings came back a SECOND time, unbuilt, and the
// Characters said so. The defect they name has two halves, and neither half was
// pinned by anything:
//
//   1. The model's own 0-100 self-report rendered in MEASUREMENT GRAMMAR — a
//      tone-banded meter with an assertive ARIA label, visually indistinguishable
//      from a measured quantity. („AI confidence: 87 %" with nothing behind it.)
//   2. ONE word, "confidence", for FOUR unrelated quantities: a measurement
//      interval (Matrix), an LLM self-report (the review card), a salary-read
//      grade, and an archetype vote share.
//
// The suite already pinned plenty of vocabularies and nothing pinned the RENDER
// grammar, which is how a fix can land in copy and quietly regress in markup. So
// this file guards both: the catalog words (executing, over all four locales) and
// the two render sites that carry them (source-level, the kp convention from
// badge-band-vocab.test.ts — node:test cannot import a .tsx).
//
// NOTE FOR THE i18n MERGE: the catalog tests below go green only once the keys in
// scratchpad/i18n/I.json are merged into messages/*.json. Failing before that is
// the test doing its job, not a regression.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { useAiReviewCardLogic } from "@/app/features/hiring/decisions/decisionsAiReviewCardLogic";
import type { Entry } from "@/app/features/shared/decisionsTypes";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..", "..");
const LOCALES = ["en", "cs", "de", "fr"] as const;

const catalog = (locale: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path.join(repo, "messages", `${locale}.json`), "utf8")) as Record<string, unknown>;

const at = (msgs: Record<string, unknown>, dotted: string): unknown =>
  dotted.split(".").reduce<unknown>((node, part) => (node == null ? node : (node as Record<string, unknown>)[part]), msgs);

const entry = (over: Partial<Entry>): Entry =>
  ({
    id: "e1",
    candidateId: "c1",
    candidateLabel: "Candidate",
    archetype: null,
    roleFamily: null,
    jobId: null,
    jobTitle: null,
    stage: "Screened",
    matchScore: null,
    status: "active",
    approvalKind: "screening_review",
    approvalDetail: null,
    ...over,
  }) as Entry;

// ---------------------------------------------------------------------------
// 1. The self-report derivation (executing, not grep).
// ---------------------------------------------------------------------------

test("the model's self-report carries no tone band any more", () => {
  const logic = useAiReviewCardLogic(entry({ approvalDetail: JSON.stringify({ confidence: 87 }) }));
  assert.equal(logic.modelSelfReport, 87);
  // The tone was the measurement grammar in derived form: moss / amber / coral
  // banded at a threshold, then painted into a meter. It must not come back — not
  // under its old name, not as a colour class smuggled out under a new one.
  // (`hasBand` is the offer draft's SALARY band and is a different thing.)
  for (const [key, value] of Object.entries(logic)) {
    assert.ok(!/tone|colou?r/i.test(key), `useAiReviewCardLogic must not expose a tone field, found: ${key}`);
    assert.ok(
      typeof value !== "string" || !/^(bg|text|border|fill)-/.test(value),
      `useAiReviewCardLogic must not return a colour class (${key} = ${String(value)})`
    );
  }
});

test("the self-report is clamped and rounded, and absent where no scalar exists", () => {
  // Named `use…` so react-hooks/rules-of-hooks accepts the call site. The
  // underlying function is pure (it calls no React hook despite the name), which
  // is exactly why this behaviour can be pinned by an EXECUTING test at all.
  const useSelfReportOf = (detail: unknown, kind = "screening_review") =>
    useAiReviewCardLogic(entry({ approvalKind: kind, approvalDetail: JSON.stringify(detail) })).modelSelfReport;
  assert.equal(useSelfReportOf({ confidence: 142 }), 100);
  assert.equal(useSelfReportOf({ confidence: -8 }), 0);
  assert.equal(useSelfReportOf({ confidence: 66.6 }), 67);
  assert.equal(useSelfReportOf({}), null, "no scalar in the payload renders no self-report at all");
  assert.equal(useSelfReportOf({ confidence: 87 }, "scorecard_review"), null, "a scorecard's confidence is a {level,reason} band, not this scalar");
  assert.equal(useSelfReportOf({ confidence: 87 }, "offer_review"), null, "an offer draft carries no self-report");
  assert.equal(useSelfReportOf({ confidence: 87 }, "rejection_review"), 87, "a queued reject is the same screening payload");
  assert.equal(useAiReviewCardLogic(entry({ approvalDetail: "{not json" })).modelSelfReport, null);
});

// ---------------------------------------------------------------------------
// 2. The render grammar at the two sites the findings name (source-level).
// ---------------------------------------------------------------------------

test("the AI review card quotes the model, it does not meter it", () => {
  const src = readFileSync(path.join(repo, "app", "features", "hiring", "decisions", "DecisionsAiReviewCard.tsx"), "utf8");
  // Measurement grammar, banned on this number: a proportional fill, a tone
  // class driven by the value, and an ARIA role that asserts it as a fact.
  assert.ok(!src.includes("confidenceTone"), "no tone band on the self-report");
  assert.ok(!/style=\{\{\s*width:/.test(src), "no proportional meter fill on the self-report");
  assert.ok(!src.includes('role="img"'), "no assertive ARIA role over the self-report");
  assert.ok(!src.includes('t("confidenceAria"'), "the old assertive aria string is gone");
  assert.ok(!src.includes('t("confidencePct"'), "the bare percentage is gone");
  // And the disclosure leads (G1): the label naming the author of the number is
  // rendered BEFORE the number itself, not as a footnote under it.
  const label = src.indexOf('t("selfReportLabel")');
  const value = src.indexOf('t("selfReportValue"');
  assert.ok(label > 0 && value > 0, "the card must render the labelled self-report");
  assert.ok(label < value, "the self-reported label must lead, never trail the number");
  // The verdict badge must not re-print the same unlabelled number as a suffix.
  assert.ok(!/RecBadge[^/]*confidence=/.test(src), "RecBadge must not carry the self-report as a bare suffix");
});

test("the Matrix score names its producer and its interval", () => {
  const src = readFileSync(path.join(repo, "app", "features", "insights", "matrix", "focus", "MatchCard.tsx"), "utf8");
  // RECON-02: producer (C), the fresh recompute, is the one the Matrix renders.
  // It resolves through the SHARED scoreProvenance catalog so the board, the
  // decisions queue and this card cannot drift apart on the wording.
  assert.ok(src.includes('useTranslations("scoreProvenance")'), "the Matrix score must resolve provenance from the shared catalog");
  assert.ok(src.includes('tProv("freshMatch")'), "the Matrix score must name its producer on screen");
  // RECON-06: the interval gets its own visible word, not a bare pair of digits.
  assert.ok(src.includes('t("card.rangeLabel")'), "the score interval must be labelled");
  assert.ok(src.includes('t("card.rangeAria"'), "the score interval needs an accessible name");
});

// ---------------------------------------------------------------------------
// 3. Four quantities, four words, in all four locales.
// ---------------------------------------------------------------------------

// One representative render string per quantity. If a future change re-merges any
// two of these onto one word, this fails in every locale at once.
const QUANTITIES = {
  interval: "match.jobCompare.confidence",
  selfReport: "decisions.aiReview.selfReportLabel",
  salaryEvidence: "report.confidence.high",
  signalAgreement: "report.archetype.confidence",
} as const;

// The word each locale used for ALL FOUR before this fix. None of the four may
// use it now, or the collision is back under a different spelling.
//
// Deliberately NOT matching the legitimate neighbour "uncertainty" (nejistota /
// Unsicherheit / incertitude): a measurement's own uncertainty is exactly what a
// score range IS, and the group-eval separation caveat is right to name it. Only
// the CONFIDENCE stem is the collision.
const COLLIDED_STEM: Record<(typeof LOCALES)[number], RegExp> = {
  en: /confidence/i,
  cs: /(?<!ne)jistot|spolehliv/i,
  de: /konfidenz|(?<!un)sicherheit/i,
  fr: /confiance/i,
};

/** Copy a recruiter actually reads: ICU placeholder NAMES are wire contract
 *  (`{confidence}` is the payload field), not vocabulary. */
const copyOf = (value: string): string => value.replace(/\{[^}]*\}/g, " ");

test("no locale renders the four quantities with one shared word", () => {
  for (const locale of LOCALES) {
    const msgs = catalog(locale);
    const rendered = Object.entries(QUANTITIES).map(([name, key]) => {
      const value = at(msgs, key);
      assert.equal(typeof value, "string", `${locale}: ${key} missing (pending the i18n manifest merge?)`);
      assert.ok((value as string).length > 0, `${locale}: ${key} empty`);
      return [name, value as string] as const;
    });
    for (const [name, value] of rendered) {
      assert.ok(
        !COLLIDED_STEM[locale].test(copyOf(value)),
        `${locale}: ${name} still uses the collided word (${QUANTITIES[name as keyof typeof QUANTITIES]} = ${JSON.stringify(value)})`
      );
    }
    // And they must be four distinct strings, not four spellings of one.
    const words = rendered.map(([, value]) => value.replace(/\{[^}]*\}/g, "").trim().toLowerCase());
    assert.equal(new Set(words).size, words.length, `${locale}: two quantities share a label: ${JSON.stringify(words)}`);
  }
});

test("the self-report copy and the Matrix provenance exist in every locale", () => {
  for (const locale of LOCALES) {
    const msgs = catalog(locale);
    for (const key of [
      "decisions.aiReview.selfReportLabel",
      "decisions.aiReview.selfReportValue",
      "decisions.aiReview.selfReportNote",
      "decisions.aiReview.selfReportTitle",
      "match.card.rangeLabel",
      "match.card.rangeAria",
      "scoreProvenance.freshMatch",
      "scoreProvenance.freshMatchTitle",
    ]) {
      const value = at(msgs, key);
      assert.equal(typeof value, "string", `${locale}: ${key} missing (pending the i18n manifest merge?)`);
      assert.ok((value as string).length > 0, `${locale}: ${key} empty`);
    }
    // The disclosure must survive translation: every locale's label has to name
    // the model as the author of the number, not merely restate the number.
    const label = at(msgs, "decisions.aiReview.selfReportLabel") as string;
    assert.ok(/model|modèle/i.test(label), `${locale}: the self-report label must name the model as its author`);
  }
});
