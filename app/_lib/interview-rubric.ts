// Scorecard rubrics, read straight from the SAME source the Python scorer uses
// (pipeline/jobfit/interview-rubrics.json, consumed in automation.py). Because
// both sides import one file — exactly like archetypes.json / archetypes.ts —
// the TS<->Python drift a hand-mirror used to risk is structurally impossible: a
// reworded anchor or a new competency lands in one place and both languages see it.
//
// Rubrics are keyed by the archetype's scoringModel. `experienced` keeps the
// historical generic axes; `early_career` re-gears them for zero-/low-experience
// candidates with full behaviorally-anchored (BARS) descriptors per level.
//
// "Both read the JSON" is enforced, not just asserted: interview-rubric.test.ts
// pins these exports to the JSON, and test_interview_rubrics.py pins the Python
// scorer to the same file — so TS == JSON == Python fails CI on drift.

import rubricData from "@/pipeline/jobfit/interview-rubrics.json";
import { isEarlyCareer } from "@/app/_lib/archetypes";
import { ROLE_FAMILY_SLUGS } from "@/app/_lib/role-families";
import type { ScorecardRating } from "@/app/_lib/interview-scorecard";

export type RubricCompetency = {
  competency: string;
  description: string;
  // Per-level behavioral anchors (BARS). Present on early-career competencies;
  // experienced ones omit them and fall back to the generic RATING_ANCHORS scale.
  anchors?: Record<string, string>;
};

export const RATING_ANCHORS: Record<number, string> = Object.fromEntries(
  Object.entries(rubricData.ratingAnchors).map(([k, v]) => [Number(k), v as string])
);

/** All rubrics, keyed by scoringModel ("experienced" | "early_career"). */
export const INTERVIEW_RUBRICS = rubricData.rubrics as unknown as Record<string, RubricCompetency[]>;

/** P2-3 — industry-relevant EXTRA axes, keyed by role-family. APPENDED to the
 *  base (scoringModel) rubric so a nurse is also scored on clinical judgment, a
 *  tradesperson on safety, a scientist on rigor — instead of every workforce
 *  getting the same generic axes. Description-only (no BARS), like the experienced
 *  rubric. An unmapped family contributes nothing, so this is purely additive and
 *  backward-compatible. Mirrors automation.INDUSTRY_AXES (same JSON). */
export const INDUSTRY_AXES = (rubricData as { industryAxes?: Record<string, RubricCompetency[]> }).industryAxes ?? {};

/** The extra industry axes for a role-family (empty for an unknown/blank family). */
export function industryAxesFor(roleFamily: string | null | undefined): RubricCompetency[] {
  return INDUSTRY_AXES[(roleFamily ?? "").trim()] ?? [];
}

/** WHY a resolved rubric has no industry axes. `industryAxesFor` returns `[]` for
 *  an absent family, a recognized family with none defined, AND an unrecognized
 *  string alike; the empty list then concatenates into the rubric leaving no trace.
 *  This enum is the distinction that empty array erased — and it is THREE cases,
 *  not two, because only two of them are actually problems:
 *
 *    • `no_family`           — the entry carries no role family at all, so which
 *                              axes apply is UNKNOWABLE. A genuine gap. Disclosed.
 *    • `family_no_axes`      — the family is canonical (ROLE_FAMILY_SLUGS) and
 *                              interview-rubrics.json defines no industry axes for
 *                              it. This is BY DESIGN: the axes exist for the six
 *                              care/trades/frontline families, and for the other
 *                              ten — software_engineering, data_ai,
 *                              finance_accounting, legal_compliance … — the base
 *                              rubric IS the intended rubric, not a degraded
 *                              fallback. Nothing is missing, so nothing is said.
 *                              SILENT: see RUBRIC_COVERAGE_DISCLOSED_GAPS.
 *    • `family_unrecognized` — the family string is not in the canonical taxonomy
 *                              at all. A real data anomaly (a typo, a stale import,
 *                              a since-renamed slug) worth surfacing quietly.
 *
 *  Splitting `family_no_axes` out of what used to be one "unmapped" case is the
 *  point: ten of sixteen families live there, so disclosing it fired on the
 *  MAJORITY of interviews and told the recruiter something was missing when
 *  nothing was. A notice that cries wolf on most rows trains people to ignore it —
 *  including on `no_family`, where it genuinely matters. The stamp still records
 *  the case (the data stays complete); only the human-facing noise goes away.
 *
 *  Absent from this list, on purpose: any notion of a GUESSED family. Nothing here
 *  ever infers or defaults a role family to make a disclosure go away; refusing to
 *  invent is the point. */
export const RUBRIC_COVERAGE_GAPS = ["no_family", "family_no_axes", "family_unrecognized"] as const;
export type RubricCoverageGap = (typeof RUBRIC_COVERAGE_GAPS)[number];

/** The subset of gaps that are actually SHOWN to a human — the message catalog is
 *  pinned to exactly this list by set equality (rubric-coverage-catalog.test.ts),
 *  so a gap that must stay silent structurally cannot acquire a string to render.
 *  RubricCoverageNote gates on `isDisclosedGap`, so this tuple governs render; it
 *  is not documentation of a decision made elsewhere. */
export const RUBRIC_COVERAGE_DISCLOSED_GAPS = ["no_family", "family_unrecognized"] as const;
export type DisclosedRubricCoverageGap = (typeof RUBRIC_COVERAGE_DISCLOSED_GAPS)[number];

/** Whether a coverage gap is one a human should be told about. `null` (axes
 *  applied) and `family_no_axes` (by design bare) both render nothing. */
export function isDisclosedGap(gap: RubricCoverageGap | null): gap is DisclosedRubricCoverageGap {
  return gap !== null && (RUBRIC_COVERAGE_DISCLOSED_GAPS as readonly string[]).includes(gap);
}

/** What a resolved rubric actually covers. `gap: null` means the industry axes
 *  resolved normally. `roleFamily` is the entry's own value, trimmed — never
 *  substituted. `axisKeys` lists the industry axes that were genuinely appended,
 *  so a reader can see the coverage rather than trust it. */
export type RubricCoverage = {
  gap: RubricCoverageGap | null;
  roleFamily: string | null;
  axisKeys: string[];
};

// The canonical role-family vocabulary, taken from the repo's existing TS single
// source (role-families.ts), which role-families.test.ts pins by set equality to
// data/taxonomy.json::role_families — the same file pipeline/jobfit/taxonomy.py
// reads. Deliberately NOT derived from `Object.keys(INDUSTRY_AXES)`: that is the
// very conflation this split exists to fix (having axes ≠ being a real family).
// And deliberately not a direct import of data/taxonomy.json, which is 230 KB and
// would land in the client bundle — this module is client-bundled via
// HumanScorecardPanel (see rubricVersionHash's note on avoiding node:crypto).
const CANONICAL_FAMILIES: ReadonlySet<string> = new Set(ROLE_FAMILY_SLUGS);

/** Resolve the industry-axis coverage for a role-family. Pure + side-effect free,
 *  and deliberately SEPARATE from `rubricForArchetype` so the resolved rubric stays
 *  byte-identical to what it has always been — this reports on that resolution, it
 *  does not alter it. */
export function rubricCoverage(roleFamily: string | null | undefined): RubricCoverage {
  const family = (roleFamily ?? "").trim() || null;
  const axes = family ? industryAxesFor(family) : [];
  // Note the ORDER: a recognized family with an empty axis list is `family_no_axes`
  // (by design, silent), and only a family outside the canonical vocabulary is an
  // anomaly. A JSON entry that exists but is empty covers nothing, so it is treated
  // as no-axes rather than as applied coverage.
  const gap: RubricCoverageGap | null = !family
    ? "no_family"
    : axes.length > 0
      ? null
      : CANONICAL_FAMILIES.has(family)
        ? "family_no_axes"
        : "family_unrecognized";
  return { gap, roleFamily: family, axisKeys: axes.map((c) => c.competency) };
}

/** Backwards-compatible: the historical flat rubric IS the experienced one. The
 *  recruiter compare grid (api/interview/compare) renders this default. */
export const INTERVIEW_RUBRIC: RubricCompetency[] = INTERVIEW_RUBRICS.experienced;

/** The rubric for a candidate — early-career archetypes get the potential /
 *  mental-model BARS rubric, everyone else the experienced one — PLUS any
 *  industry axes for their role-family (P2-3), appended. Mirrors
 *  automation.rubric_for_candidate; both resolve the early-career split from the
 *  shared archetypes.json and the industry axes from the shared rubric JSON, so
 *  selection can never desync from scoring. `roleFamily` is optional: omit it and
 *  the result is exactly the pre-P2-3 base rubric. */
export function rubricForArchetype(
  archetype: string | null | undefined,
  roleFamily?: string | null
): RubricCompetency[] {
  const base = isEarlyCareer(archetype) ? INTERVIEW_RUBRICS.early_career : INTERVIEW_RUBRICS.experienced;
  return [...base, ...industryAxesFor(roleFamily)];
}

/** Case-insensitive set of the competency KEYS a rubric covers — the same match
 *  the compare grid's ratingOf / mergeRubricRows use to join a stored rating to a
 *  rubric axis (compareCohorts.ts). */
export function rubricCompetencyKeys(rubric: RubricCompetency[]): Set<string> {
  return new Set(rubric.map((c) => c.competency.toLowerCase()));
}

/** Flag every rating that falls OUTSIDE `rubric` as off-rubric — the same concept
 *  CompareInterviews surfaces (compareCohorts' offRubric). Unknown competencies are
 *  KEPT, never rejected: a scorecard outlives rubric revisions by design, so an
 *  off-taxonomy or since-renamed axis is preserved and marked so a reader knows it
 *  was scored on an axis the current rubric no longer contains. Matches
 *  case-insensitively, like the compare grid's join. An on-rubric rating is
 *  returned untouched (no `offRubric` key), so the flag only ever appears on a
 *  genuine off-rubric row. */
export function flagOffRubricRatings(ratings: ScorecardRating[], rubric: RubricCompetency[]): ScorecardRating[] {
  const known = rubricCompetencyKeys(rubric);
  return ratings.map((r) => (known.has(r.competency.toLowerCase()) ? r : { ...r, offRubric: true }));
}

/** Flag off-rubric ratings PREFERRING a scorecard's STORED rubric snapshot
 *  (Direction 2). When the scorecard carries `storedKeys` — the competency KEYS it
 *  was scored against, stamped alongside its rubricVersion at write time — off-rubric
 *  is judged against THAT historical scale, so a since-revised interview-rubrics.json
 *  can't retroactively mark a once-valid axis off-rubric. A legacy row with no stored
 *  keys (null/empty) falls back to `currentRubric`, behaving EXACTLY as
 *  flagOffRubricRatings does today — the CompareInterviews semantics for unversioned
 *  rows are unchanged. Case-insensitive, like the compare grid's join. The stored key
 *  list is the minimal shape needed to re-evaluate; the version hash is the compact
 *  identity that proves two scorecards were scored on the same scale. */
export function flagOffRubricRatingsWithKeys(
  ratings: ScorecardRating[],
  storedKeys: string[] | null | undefined,
  currentRubric: RubricCompetency[]
): ScorecardRating[] {
  const known =
    storedKeys && storedKeys.length
      ? new Set(storedKeys.map((k) => k.toLowerCase()))
      : rubricCompetencyKeys(currentRubric);
  return ratings.map((r) => (known.has(r.competency.toLowerCase()) ? r : { ...r, offRubric: true }));
}

/** A stable content hash of a RESOLVED rubric slice (rubricForArchetype output) —
 *  the "rubric version" a scorecard stamps at write time so it can be re-evaluated
 *  against the exact scale it was scored on, even after interview-rubrics.json
 *  revises (Direction 2). Covers competency + description + BARS anchors, so a
 *  reworded anchor advances the version, not just an added/removed axis.
 *
 *  The serialization is a delimiter-joined canonical string (NOT JSON) and the hash
 *  is a 64-bit FNV-1a over its UTF-8 bytes — chosen so the TS and Python stamps are
 *  byte-identical WITHOUT depending on cross-language JSON canonicalization or a
 *  crypto lib (this module is client-bundled via HumanScorecardPanel, so it must
 *  stay free of node:crypto). automation.rubric_version_hash mirrors this exactly;
 *  interview-rubric.test.ts + test_interview_rubrics.py pin BOTH to the same literal,
 *  so a drift on either side fails that language's CI lane. */
export function rubricVersionHash(rubric: RubricCompetency[]): string {
  const US = "␟"; // unit separator (competency fields)
  const RS = "␞"; // record separator (between competencies)
  const canon = rubric
    .map((c) => {
      const anchors = c.anchors
        ? Object.keys(c.anchors)
            .sort((a, b) => Number(a) - Number(b))
            .map((k) => `${k}=${c.anchors![k]}`)
            .join(US)
        : "";
      return [c.competency, c.description, anchors].join(US);
    })
    .join(RS);
  const bytes = new TextEncoder().encode(canon);
  // BigInt() constructors (not `n` literals) so this compiles at the repo's ES2017
  // target while staying 64-bit exact at runtime (esnext lib provides the type).
  const MASK = BigInt("0xffffffffffffffff");
  const PRIME = BigInt("0x100000001b3");
  let h = BigInt("0xcbf29ce484222325"); // FNV-1a 64-bit offset basis
  for (const b of bytes) {
    h ^= BigInt(b);
    h = (h * PRIME) & MASK;
  }
  return h.toString(16).padStart(16, "0");
}

export const RUBRIC_ANCHOR_LINE = Object.entries(RATING_ANCHORS)
  .map(([k, v]) => `${k} = ${v}`)
  .join(" · ");

// PREP3 — Czech DISPLAY overlay. The canonical English `competency` stays the
// storage + scoring KEY (stored in ScorecardRating.competency by both the
// Python scorer and the human panel, matched across surfaces), so this overlay
// is keyed BY that canonical string and provides only display strings. A cs
// recruiter sees a Czech rubric while every POST still carries the canonical
// key; the Python scorer is untouched, and interview-rubric.test.ts asserts
// every overlay key maps to a canonical competency so a typo can't silently
// fall back to English forever.
type RubricCsEntry = { label: string; description: string; anchors?: Record<string, string> };
export const RUBRIC_CS: Record<string, RubricCsEntry> = {
  // experienced
  "Technical depth": { label: "Technická hloubka", description: "Hloubka a správnost v klíčových dovednostech role." },
  "Problem-solving": { label: "Řešení problémů", description: "Uvažování, ladění chyb a strukturované myšlení pod otázkami." },
  Communication: { label: "Komunikace", description: "Srozumitelnost, struktura a aktivní naslouchání." },
  "Experience & fit": { label: "Zkušenosti a vhodnost", description: "Relevance zázemí a projektů k této konkrétní roli." },
  Motivation: { label: "Motivace", description: "Skutečný zájem o roli a tým." },
  // early_career
  "Problem decomposition": {
    label: "Rozklad problému",
    description: "Jak rozloží neznámý problém: odkrytí předpokladů, omezení a struktury dříve, než sáhnou po řešení.",
    anchors: {
      "1": "Pouze přeformuluje problém nebo skočí k naučené odpovědi; žádný rozklad.",
      "2": "Pojmenuje pár částí, ale mine klíčová omezení nebo závislosti.",
      "3": "Rozloží problém na souvislé podproblémy a uvede hlavní omezení.",
      "4": "Rozkládá čistě, odkrývá skryté předpoklady a ptá se na upřesnění před rozhodnutím.",
      "5": "Přerámuje problém tak, aby odhalil jeho jádro, řadí podproblémy podle rizika a sám uvažuje o hraničních případech.",
    },
  },
  "Learning agility": {
    label: "Schopnost učení",
    description: "Jak se učí a zotavují, když uvíznou: důkaz opakovatelné smyčky, ne jednorázového úspěchu.",
    anchors: {
      "1": "Neumí popsat, jak se učí nebo jak se odblokovali; přičítá to štěstí nebo jiným lidem.",
      "2": "Popisuje pasivní učení (sledování tutoriálů) bez reflexe toho, co fungovalo.",
      "3": "Pojmenuje konkrétní strategii učení a jednu věc, kterou by udělali jinak.",
      "4": "Ukazuje cílenou smyčku diagnostika–experiment–úprava na reálném příkladu uvíznutí a zotavení.",
      "5": "Přenáší poznatek z jedné oblasti do nové a reflektuje, jak se jejich přístup sám zlepšuje.",
    },
  },
  Coachability: {
    label: "Trénovatelnost",
    description: "Jak v reálném čase přijmou nápovědu, opravu nebo nesouhlas: zapojí ji, odmítnou, nebo ztuhnou.",
    anchors: {
      "1": "Nápovědu ignoruje nebo se proti ní reflexivně brání.",
      "2": "Nápovědu uzná, ale neumí podle ní jednat.",
      "3": "Po nápovědě se přizpůsobí, s určitým pobízením.",
      "4": "Nápovědu rychle zapojí a vysvětlí, jak mění jejich přístup.",
      "5": "Nápovědu prozkoumá, položí zpřesňující otázku a zobecní ji nad rámec daného problému.",
    },
  },
  "Conceptual depth": {
    label: "Pojmová hloubka",
    description: "Zda chápou proč, nejen co: testováno protipříklady a přenosem na nové případy.",
    anchors: {
      "1": "Vybaví si definice, ale neumí vysvětlit proč; selže při jakékoli variantě „co kdyby“.",
      "2": "Vysvětlí ideální průběh, ale ne kompromisy ani co se mění za jiných podmínek.",
      "3": "Vysvětlí mechanismus a zvládne jednoduchý protipříklad.",
      "4": "Uvažuje o kompromisech a přizpůsobí koncept změněnému požadavku.",
      "5": "Odvodí myšlenku z prvních principů a předpoví, kde selže za nového omezení.",
    },
  },
  "Motivation & direction": {
    label: "Motivace a směřování",
    description: "Soudržnost a konkrétnost toho, proč tento obor a tato role: vnitřní pohon nad naučenými odpověďmi.",
    anchors: {
      "1": "Obecné nebo čistě vnější („dobrý plat“); žádný konkrétní zájem.",
      "2": "Uvádí zájem, ale neumí ho navázat na nic, co skutečně dělali.",
      "3": "Uvede konkrétní, konzistentní důvod opřený o reálnou zkušenost nebo projekt.",
      "4": "Ukazuje souvislou linii od minulých voleb k této roli a budoucímu cíli.",
      "5": "Vyjádří ostré, sebereflektující směřování s důkazy o samostatném zkoumání směrem k němu.",
    },
  },
  "Communication & collaboration": {
    label: "Komunikace a spolupráce",
    description: "Srozumitelnost a struktura vysvětlení, aktivní naslouchání a jak pracují s podněty druhých.",
    anchors: {
      "1": "Neuspořádané nebo vyhýbavé; neodpovídá na položenou otázku.",
      "2": "Odpoví, ale odbíhá nebo postrádá strukturu; těžko se sleduje.",
      "3": "Jasné, strukturované odpovědi; naslouchá a reaguje na skutečnou otázku.",
      "4": "Vysvětlí složité myšlenky jednoduše a ověří porozumění.",
      "5": "Přizpůsobí vysvětlení posluchači a konstruktivně otevře nesouhlas.",
    },
  },
  // industry axes (P2-3) — description-only, like the experienced rubric
  "Clinical judgment & patient safety": {
    label: "Klinický úsudek a bezpečnost pacienta",
    description: "Spolehlivé klinické uvažování, znalost rozsahu kompetencí a instinkt klást bezpečnost pacienta na první místo pod tlakem.",
  },
  "Safety & hands-on competence": {
    label: "Bezpečnost a praktická zdatnost",
    description: "Prokázaná praktická dovednost a nekompromisní přístup k bezpečnosti na pracovišti, normám a správným postupům.",
  },
  "Scientific rigor": {
    label: "Vědecká přísnost",
    description: "Experimentální přísnost, integrita dat a poctivé uvažování o důkazech, omezeních a reprodukovatelnosti.",
  },
  "Craft & portfolio depth": {
    label: "Řemeslo a hloubka portfolia",
    description: "Hloubka a originalita řemesla doložená skutečnou prací — portfoliem, ne jen deklarovanými dovednostmi.",
  },
  "Operational execution": {
    label: "Provozní realizace",
    description: "Spolehlivá realizace ve velkém: průchodnost, stanovení priorit a klidný úsudek, když naroste objem nebo výjimky.",
  },
  "Service orientation & reliability": {
    label: "Orientace na službu a spolehlivost",
    description: "Přístup orientovaný na zákazníka, klid pod tlakem a spolehlivá docházka a dotahování věcí.",
  },
};

export const RATING_ANCHORS_CS: Record<number, string> = {
  1: "Hluboko pod laťkou",
  2: "Pod laťkou",
  3: "Splňuje laťku",
  4: "Nad laťkou",
  5: "Výjimečné",
};

// A competency with its display strings resolved for a locale; `competency` is
// always the canonical KEY that surfaces POST, never the localized label.
export type LocalizedRubricCompetency = {
  competency: string;
  label: string;
  description: string;
  anchors?: Record<string, string>;
};

/** Resolve a rubric's display strings for `locale`. English (or an unmapped
 *  competency) falls back to the canonical strings, so a missing overlay entry
 *  degrades gracefully rather than rendering blank. The canonical `competency`
 *  key is preserved for the scorecard POST. */
export function localizedRubric(rubric: RubricCompetency[], locale: string): LocalizedRubricCompetency[] {
  const cs = locale === "cs";
  return rubric.map((c) => {
    const overlay = cs ? RUBRIC_CS[c.competency] : undefined;
    return {
      competency: c.competency,
      label: overlay?.label ?? c.competency,
      description: overlay?.description ?? c.description,
      anchors: (cs ? overlay?.anchors : undefined) ?? c.anchors,
    };
  });
}

/** The 1–5 rating scale labels for a locale (falls back to English). */
export function localizedRatingAnchors(locale: string): Record<number, string> {
  return locale === "cs" ? RATING_ANCHORS_CS : RATING_ANCHORS;
}

/** Display label for a STORED (canonical) competency key — for surfaces that
 *  render persisted ScorecardRating rows rather than iterating the rubric. Falls
 *  back to the canonical key when there's no overlay (English, or a custom
 *  competency the LLM scorer emitted that isn't in the fixed rubric). */
export function rubricLabel(canonicalCompetency: string, locale: string): string {
  return (locale === "cs" ? RUBRIC_CS[canonicalCompetency]?.label : undefined) ?? canonicalCompetency;
}
