import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LOCALES } from "../../../i18n/locales.ts";
import { ABOUT_STEP_KEYS } from "./about-art/shared.ts";
import { INTERVIEW_PLAN_DEFAULT } from "../../_lib/decision-config-schema.ts";

/*
 * The landing page's CLAIMS, pinned to the code that has to make them true.
 *
 * `PricingSection.test.ts` does this for the price list — the public number must
 * equal the enforced number. Everything else on the page was prose nothing
 * compared to anything, and the 2026-08-28 audit found six false or overstated
 * claims sitting in four catalogs at once: onboarding that no longer exists, a
 * human gate advertised as "not a setting" while two settings turn it off, a
 * two-language claim on a four-language product, SSO advertised as shipped, an
 * authorship detector the product deliberately does not have, and calibration
 * reported as settled when the instrument's own verdict says `circular`.
 *
 * Prose cannot be diffed against code the way a number can, so each test below
 * pins the ONE structural fact the claim rests on and fails when that fact
 * moves — not when the wording is edited. Where a claim's honesty lives in a
 * qualifier ("by default"), the qualifier is required in every locale off a
 * declared table, because a claim that loses its qualifier in translation is
 * the same false claim in a language nobody here re-reads.
 *
 * Runner: node:test with type stripping. `npm run test:unit`.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..", "..", "..");

type Catalog = {
  landing: {
    marquee: string[];
    hero: { subtitle: string };
    features: { offer: { title: string; body: string } };
    trust: { human: { body: string }; audit: { body: string } };
    pricing: { enterprise: { blurb: string; capabilities: string[] } };
  };
  aboutPage: {
    hero: { subtitle: string };
    steps: Record<string, { eyebrow: string; title: string; body: string }>;
    art: Record<string, unknown>;
  };
};

const catalog = (locale: string): Catalog =>
  JSON.parse(readFileSync(path.join(REPO, "messages", `${locale}.json`), "utf8")) as Catalog;

const CATALOGS = Object.fromEntries(LOCALES.map((l) => [l, catalog(l)])) as Record<string, Catalog>;

const source = (...rel: string[]) => readFileSync(path.join(REPO, ...rel), "utf8");

/** Digits as a human reads them, grouping separators collapsed between digits. */
function numbersIn(text: string): number[] {
  const flat = text.replace(/(\d)[\s  ,.](?=\d)/g, "$1");
  return [...flat.matchAll(/\d+/g)].map((m) => Number(m[0]));
}

/* ── The human gate ──────────────────────────────────────────────────────────
 *
 * `landing.trust.human.body` used to read "No candidate is advanced, offered or
 * rejected by the machine alone… That is by design, not a setting." Two thirds
 * of that was false: Settings → Hiring exposes a per-stage gate, and
 * `automation-run.ts` reads it — `screeningGate: "auto"` auto-ratifies a held
 * screening review, `offerGate: "auto"` extends a drafted offer unattended. The
 * rejection third holds and is the part worth claiming.
 *
 * So the copy now says "human-approved BY DEFAULT" and names the delegation.
 * Both halves of that are checkable: the shipped default, and the fact that the
 * auto branches exist at all. */

test("the plan the app ships gates every stage on a human", () => {
  const steps = INTERVIEW_PLAN_DEFAULT.steps;
  assert.ok(steps.length > 0, "the default plan governs at least one column");
  for (const step of steps) {
    assert.equal(
      step.gate,
      "human",
      `the landing claims every gate is human BY DEFAULT; the shipped default sets ${step.stageId} to "${step.gate}"`
    );
    for (const round of step.rounds) {
      assert.equal(round.gate, "human", `the shipped default leaves a ${round.kind} round at ${step.stageId} unattended`);
    }
  }
});

test("the human-gate copy carries its 'by default' qualifier in every locale", () => {
  // The auto gates are real and reachable — that is exactly why the qualifier is
  // load-bearing. Pin their existence first, so this test fails loudly if the
  // gates are ever removed (at which point the copy may harden again).
  const automation = source("app", "_lib", "automation-run.ts");
  for (const role of ["screening", "offer"]) {
    assert.match(
      automation,
      new RegExp(`getPlanGateForRole\\("${role}"[^)]*\\)\\s*===\\s*"auto"`),
      `automation-run.ts no longer delegates ${role} to the plan — the "by default" hedge may be too weak now`
    );
  }
  // No auto branch may exist for a rejection: "a rejection is always a person's"
  // is the strong half of the claim, and it is the half a future gate would break.
  assert.doesNotMatch(
    automation,
    /getPlanGateForRole\("(rejection|reject)"/,
    "a rejection gate would falsify landing.trust.human.body's first sentence"
  );

  // The qualifier, per locale. Editing the sentence is fine; dropping the hedge
  // is not, and a translation that drops it is the failure nobody would notice.
  const DEFAULT_QUALIFIER: Record<string, RegExp> = {
    en: /\bby default\b/i,
    cs: /v[ée] v[yý]choz[íi]m nastaven[íi]/i,
    de: /standardm[äa][sß]{1,2}ig/i,
    fr: /par d[ée]faut/i,
  };
  // Wording that would re-assert the claim the gates falsify.
  const DENIALS: Record<string, RegExp> = {
    en: /not a setting/i,
    cs: /ne podle nastaven[íi]/i,
    de: /nicht per Einstellung/i,
    fr: /pas d[’']un r[ée]glage/i,
  };

  assert.deepEqual(
    Object.keys(DEFAULT_QUALIFIER).sort(),
    [...LOCALES].sort(),
    "a locale was added without a 'by default' qualifier for the human-gate claim"
  );

  for (const locale of LOCALES) {
    const body = CATALOGS[locale].landing.trust.human.body;
    assert.match(
      body,
      DEFAULT_QUALIFIER[locale],
      `${locale} states the human gate without saying it is the DEFAULT, which the auto gates make false`
    );
    assert.doesNotMatch(
      body,
      DENIALS[locale],
      `${locale} denies the gates are configurable; app/features/settings/hiring configures them`
    );
  }
});

/* ── The retired onboarding module ───────────────────────────────────────── */

test("no marketing copy promises the onboarding module that was retired", () => {
  // The module is gone: its tables are retired and no route serves it. Pin that,
  // so the copy ban below is anchored to the codebase rather than to a memory.
  assert.match(
    source("app", "_lib", "tenancy.ts"),
    /TENANCY_RETIRED_TABLES[\s\S]{0,600}onboarding/,
    "the onboarding tables are no longer listed as retired — re-check before re-promising onboarding"
  );

  // Per locale: the words that would promise post-hire onboarding. `intégration`
  // is French for onboarding; `nástup`/`Onboarding` likewise. Anything matching
  // is a promise the offer flow does not keep — accept ends at Hired plus the
  // ATS/HRIS webhook (`app/_lib/offer-finalize.ts`).
  const ONBOARDING: Record<string, RegExp> = {
    en: /\bonboarding\b|\bpre-boarding\b/i,
    cs: /onboarding|pre-boarding/i,
    de: /onboarding|pre-boarding/i,
    fr: /onboarding|int[ée]gration/i,
  };
  assert.deepEqual(
    Object.keys(ONBOARDING).sort(),
    [...LOCALES].sort(),
    "a locale was added with no onboarding-word pattern; the ban would silently not apply to it"
  );

  for (const locale of LOCALES) {
    const c = CATALOGS[locale];
    // The whole public marketing surface, not just the two keys that were caught.
    const prose = JSON.stringify([c.landing, c.aboutPage]);
    const hits = prose.split(/(?<=[.!?"])\s+/).filter((s) => ONBOARDING[locale].test(s));
    assert.deepEqual(
      hits,
      [],
      `${locale} still promises onboarding on a public marketing page: ${hits.join(" | ")}`
    );
  }
});

/* ── The language claim ──────────────────────────────────────────────────── */

test("the marquee's language claim states the number of locales that ship", () => {
  for (const locale of LOCALES) {
    const marquee = CATALOGS[locale].landing.marquee;
    const claims = marquee.filter((item) => numbersIn(item).includes(LOCALES.length));
    assert.equal(
      claims.length,
      1,
      `${locale}'s marquee must carry exactly one language claim stating ${LOCALES.length}; it carries ${claims.length}`
    );
  }
});

/* ── SSO ─────────────────────────────────────────────────────────────────── */

test("the enterprise band does not sell SSO as shipped code", () => {
  // Backlog #41 E1. Only two comments in the tree mention an SSO seam; there is
  // no SAML/OIDC/SCIM implementation. If one lands, this test is the reminder
  // that the copy may drop its hedge.
  const authFiles = ["app/_lib/auth/password.ts", "app/_lib/auth/session.ts"];
  for (const rel of authFiles) {
    const src = source(...rel.split("/"));
    assert.doesNotMatch(
      src,
      /^(?!\s*(\/\/|\*|\/\*)).*\b(SAMLResponse|oidc|openid-client|@node-saml)\b/im,
      `${rel} looks like it implements SSO now — re-check landing.pricing.enterprise`
    );
  }

  const PLANNED: Record<string, RegExp> = {
    en: /\(planned\)/i,
    cs: /\(v pl[áa]nu\)/i,
    de: /\(geplant\)/i,
    fr: /\(pr[ée]vu\)/i,
  };
  assert.deepEqual(Object.keys(PLANNED).sort(), [...LOCALES].sort(), "a locale has no 'planned' marker");

  for (const locale of LOCALES) {
    const { blurb, capabilities } = CATALOGS[locale].landing.pricing.enterprise;
    const sso = capabilities.filter((c) => /SSO/i.test(c));
    assert.equal(sso.length, 1, `${locale} lists ${sso.length} SSO capabilities, expected exactly one`);
    assert.match(sso[0], PLANNED[locale], `${locale} sells SSO as a shipped capability: "${sso[0]}"`);
    assert.doesNotMatch(blurb, /SSO/i, `${locale}'s enterprise blurb still says SSO is in the repository`);
  }
});

/* ── /about walks every phase the product has ────────────────────────────── */

test("every /about phase carries copy and art keys in all four catalogs", () => {
  for (const locale of LOCALES) {
    const { steps, art } = CATALOGS[locale].aboutPage;
    assert.deepEqual(
      Object.keys(steps),
      [...ABOUT_STEP_KEYS],
      `${locale}'s aboutPage.steps must name every phase AboutCurve draws, in the order it draws them`
    );
    for (const key of ABOUT_STEP_KEYS) {
      for (const field of ["eyebrow", "title", "body"] as const) {
        assert.ok(steps[key][field]?.trim(), `${locale} aboutPage.steps.${key}.${field} is empty`);
      }
    }
    // Art keys are a SUBSET: several phases draw illustrations with no labels.
    for (const key of Object.keys(art)) {
      assert.ok(
        (ABOUT_STEP_KEYS as readonly string[]).includes(key),
        `${locale} carries aboutPage.art.${key} for a phase /about no longer walks`
      );
    }
  }
});

test("each /about step's eyebrow states its own position on the curve", () => {
  // The eyebrow reads "Step 05 · Assignment". Inserting a phase renumbers every
  // step after it, in four catalogs — exactly the edit that gets half-done. The
  // dot beside each row already renders `index + 1`, so a stale eyebrow puts two
  // different numbers on one row.
  for (const locale of LOCALES) {
    const { steps } = CATALOGS[locale].aboutPage;
    ABOUT_STEP_KEYS.forEach((key, i) => {
      assert.deepEqual(
        numbersIn(steps[key].eyebrow),
        [i + 1],
        `${locale} aboutPage.steps.${key}.eyebrow ("${steps[key].eyebrow}") is not step ${i + 1}`
      );
    });
  }
});

test("the /about hero states how many steps the curve actually draws", () => {
  // "Seven steps, one continuous line" outlived the seventh step by one commit
  // once already. Numerals in every locale, so this reads them the same way the
  // pricing test reads a price.
  const WORD_FOR_COUNT: Record<string, Record<number, RegExp>> = {
    en: { 8: /\beight\b/i },
    cs: { 8: /\bosm\b/i },
    de: { 8: /\bacht\b/i },
    fr: { 8: /\bhuit\b/i },
  };
  for (const locale of LOCALES) {
    const pattern = WORD_FOR_COUNT[locale]?.[ABOUT_STEP_KEYS.length];
    assert.ok(
      pattern,
      `no word for ${ABOUT_STEP_KEYS.length} in ${locale}: the /about hero copy needs updating for the new phase count`
    );
    assert.match(
      CATALOGS[locale].aboutPage.hero.subtitle,
      pattern,
      `${locale}'s /about hero does not say the curve has ${ABOUT_STEP_KEYS.length} steps`
    );
  }
});

test("the assignment phase the landing leads with is on the /about curve", () => {
  // The #proof band is the landing's headline argument and it is entirely about
  // the work sample. A timeline of "the whole pipeline" that steps from Screen
  // to Interview omits precisely the phase the visitor came to understand.
  assert.ok(
    (ABOUT_STEP_KEYS as readonly string[]).includes("assignment"),
    "/about must walk the assignment phase the landing's #proof band sells"
  );
  const i = ABOUT_STEP_KEYS.indexOf("assignment");
  assert.ok(
    i > ABOUT_STEP_KEYS.indexOf("screen") && i < ABOUT_STEP_KEYS.indexOf("interview"),
    "the case goes out at screening and the interview is grounded in the submission: assignment sits between them"
  );
  // The curve derives its spine from the same list, so a phase can never be drawn
  // without a node to sit on.
  assert.match(
    source("app", "landing", "spark", "AboutCurve.tsx"),
    /ABOUT_STEP_KEYS/,
    "AboutCurve must derive its rows and its spine from the phase list, not from a parallel literal"
  );
});
