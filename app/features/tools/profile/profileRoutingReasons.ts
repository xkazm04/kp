// The archetype router's explanation, in the reader's language.
//
// `result.reasons` is rendered ENGLISH prose from the Python router ("currently
// enrolled", "3 years of relevant experience", "no strong signal; defaulting to
// experienced"). The result panel joined those sentences straight into its
// "Routing: …" line, so a cs/de/fr recruiter read the router's whole explanation in
// a language they never chose — the same class of defect the panel's completeness
// gaps closed one block above by joining on a stable `check` id.
//
// registry.detect_detailed now ships `reasonCodes` beside `reasons`: one
// {kind, params} per reason, in the same order, with the kinds declared in
// archetypes.json (`profile.result.reasons.<kind>` in the four catalogs). This
// module is the pure join — no React, no next-intl — so the fallback chain is unit
// tested rather than only seen in a rendered panel.

/** The one kind whose param is a wire id the reader's side must localize (the
 *  archetype the candidate declared). Mirrors detection.selfDeclaredReasonKind in
 *  archetypes.json — pinned against it in profileRoutingReasons.test.ts. */
export const SELF_DECLARED_REASON_KIND = "self_declared";

/** One routing reason as the registry emits it (pipeline/jobfit/registry.py). */
export type RoutingReasonCode = { kind: string; params?: Record<string, string | number | null> };

/**
 * Localize one reason, or fall back to the router's English sentence.
 *
 * `translate` returns null for a kind the catalogs do not carry yet (a reason kind
 * added to archetypes.json before its four entries land): the legacy string at the
 * SAME index is then the honest answer — English, but never a missing-key throw and
 * never an empty line where the router had something to say.
 */
export function routingReasonText(
  code: RoutingReasonCode | undefined,
  legacy: string | undefined,
  translate: (kind: string, params: Record<string, string | number>) => string | null
): string {
  if (code?.kind) {
    // A param whose value is null/undefined is dropped rather than interpolated:
    // ICU renders `undefined` as the literal word, and a reason only fires when its
    // signal is present, so an absent value means the template outgrew its rule.
    const params: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(code.params ?? {})) {
      if (value !== null && value !== undefined) params[key] = value;
    }
    const localized = translate(code.kind, params);
    if (localized) return localized;
  }
  return legacy ?? "";
}

/**
 * The whole routing line: every reason localized, joined the way the panel shows
 * them. Codes are authoritative when present; a result built before the registry
 * emitted them (or by an older worker) renders through the legacy strings alone.
 */
export function routingReasonsLine(
  codes: readonly RoutingReasonCode[] | undefined,
  legacy: readonly string[] | undefined,
  translate: (kind: string, params: Record<string, string | number>) => string | null
): string {
  const source = codes?.length ? codes : (legacy ?? []).map(() => undefined);
  return source
    .map((code, i) => routingReasonText(code, legacy?.[i], translate))
    .filter((line) => line.trim() !== "")
    .join("; ");
}
