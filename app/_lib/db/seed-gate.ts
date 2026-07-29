type EnvLike = Record<string, string | undefined>;

/** Whether the demo/fixture content seeds run at boot (the ČS jobs corpus,
 *  candidates, analyses, pipeline rows, example JD, seed org members). KP_EMPTY=1
 *  turns them OFF so `npm run dev:empty` boots a truly blank tenant — the
 *  newcomer experience a first-run user sees. Structural bootstrap (schema, the
 *  default workspace/org rows, the standard JD template) is NOT gated here: the
 *  app cannot function without it and a real new deployment gets it too. */
export function fixtureSeedEnabled(env: EnvLike = process.env): boolean {
  const v = (env.KP_EMPTY ?? "").trim().toLowerCase();
  return !(v === "1" || v === "true" || v === "yes" || v === "on");
}
