// floors-tell-the-truth — pure derivations shared by the two family-floor
// consumers (DecisionRulesModal + ScreenWaveModal). Kept side-effect-free and
// React-free so the sentence/summary logic is unit-testable without a DOM.
//
// Family floors are per-role-family overrides of the global screening
// `maxMatchToReject` (see decision-config-schema::effectiveFloor). The rules
// modal describes them; the wave preview discloses which rows they moved.

// One override entry resolved to a display label + value. `labelFor` localizes
// the family slug (useEnumLabel("family", …) in the UI; the English fallback in
// tests) — this module never reaches into i18n itself.
export type FamilyFloorEntry = { family: string; label: string; floor: number };

// The family-floor overrides that actually DIFFER from the global floor, sorted
// by slug for a stable render. An override equal to the global floor is a no-op
// and is omitted so the UI never claims an override that changes nothing.
export function familyFloorEntries(
  familyFloors: Record<string, number> | undefined | null,
  globalFloor: number,
  labelFor: (slug: string) => string
): FamilyFloorEntry[] {
  if (!familyFloors) return [];
  return Object.entries(familyFloors)
    .filter(([, floor]) => typeof floor === "number" && Number.isFinite(floor) && floor !== globalFloor)
    .map(([family, floor]) => ({ family, label: labelFor(family), floor }))
    .sort((a, b) => a.family.localeCompare(b.family));
}

// The plain-text list an ICU sentence embeds, e.g. "Software 55, Legal / Compliance 60".
export function familyFloorSummaryList(entries: FamilyFloorEntry[]): string {
  return entries.map((e) => `${e.label} ${e.floor}`).join(", ");
}

// A screen-wave reject row's EFFECTIVE floor — the threshold the wave actually
// judged it against, threaded through reasonParams.threshold (screen-wave.ts).
// Null for any row without a numeric threshold (keeps, older shapes).
export function rowEffectiveFloor(reasonParams: Record<string, string | number> | undefined | null): number | null {
  const v = reasonParams?.threshold;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// How many REJECT rows were decided against a family floor that differs from the
// global slider value — the "N rows used a family override" summary count.
export function familyOverrideRejectCount(
  decisions: { action: string; reasonParams?: Record<string, string | number> }[],
  globalFloor: number
): number {
  let n = 0;
  for (const d of decisions) {
    if (d.action !== "reject") continue;
    const floor = rowEffectiveFloor(d.reasonParams);
    if (floor != null && floor !== globalFloor) n += 1;
  }
  return n;
}
