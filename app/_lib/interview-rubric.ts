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
