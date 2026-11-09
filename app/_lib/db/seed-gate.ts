type EnvLike = Record<string, string | undefined>;

function truthy(raw: string | undefined): boolean {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/** Whether the demo/fixture content seeds run AT BOOT (the ČS jobs corpus,
 *  candidates, analyses, pipeline rows, example JD, seed org members).
 *
 *  OFF by default since 2026-10-22 (operator triage T1). It used to be on unless
 *  KP_EMPTY=1, which meant a plain fresh install — `npm run dev`, `npm run up`, a
 *  Docker volume — booted into a fictional bank's hiring pipeline it never asked
 *  for. A fresh database now boots with the structural bootstrap only, and the
 *  first-run screen asks "start empty, or explore with demo data?"; the demo half
 *  of that answer is seedDemoCorpus() in core.ts, called on demand.
 *
 *  KP_SEED_DEMO=1 is the explicit opt-in for machines that need the corpus with no
 *  click in between (the Playwright webServer, `npm run up -- --demo`, CI's
 *  keyless job). KP_EMPTY=1 still wins over it, so `npm run dev:empty` stays
 *  blank whatever the shell exported. Structural bootstrap (schema, the default
 *  workspace/org rows, the standard JD template) is NOT gated here: the app cannot
 *  function without it and a real new deployment gets it too. */
export function fixtureSeedEnabled(env: EnvLike = process.env): boolean {
  if (truthy(env.KP_EMPTY)) return false;
  return truthy(env.KP_SEED_DEMO);
}

/** Whether the environment has ALREADY answered the first-run data question, so the
 *  in-app choice must not be offered: KP_EMPTY=1 says "blank" (dev:empty, the
 *  isolated e2e servers), KP_SEED_DEMO=1 says "demo" (and has seeded it at boot). */
export function seedChoiceFixedByEnv(env: EnvLike = process.env): boolean {
  return truthy(env.KP_EMPTY) || truthy(env.KP_SEED_DEMO);
}
