# Ambiguity+Business — High Wave 1: Dark-capability activations

> 4 commits, 4 High findings closed. Surfacing value the engine already computes — kp's recurring "built-but-unwired" pattern, on the highest-ROI cluster (all S-effort, pure presentation).
> Baseline preserved: tsc 0 · JS unit 1033 · i18n 2883 (en/cs parity) · Python untouched. 0 regressions.

## Commits

| # | Commit | Finding | Files |
|---|---|---|---|
| 1 | `d454709` | skill-matrix coverage gap never surfaced | MatrixTab.tsx, en/cs.json |
| 2 | `e92e564` | per-role-family calibration unreachable in the UI | calibration/route.ts, CalibrationPanel.tsx, en/cs.json |
| 3 | `2f35c94` | JD inclusivity lint only ran on the AI builder | JdLintPanel.tsx (new), JdBuilderResult.tsx, LibraryJdForm.tsx |
| 4 | `c308ab5` | salary anchor + grounding sources computed but never shown | shared.tsx (EnginePanel), en/cs.json |

## What was surfaced

1. **Matrix coverage gap.** The "Skill Matrix & **Coverage**" view computed per-column strong counts but never rolled them up. Added a Coverage banner — "N of M open roles have no strong fit — source for these: …" — pure presentation over the existing `colScores` + `STRONG_THRESHOLD`. Turns a lookup grid into a talent-gap signal.

2. **Per-role-family calibration.** The API already accepted `?roleFamily` (the route's own headline use case: "how accurate are you for backend roles?") but `CalibrationPanel` fetched the bare endpoint with no selector. The route now also returns the distinct `families` present, and the panel renders a role-family `<select>` that refetches per family.

3. **JD lint on the paste path.** `lintJd` (vague phrases, missing pay/place, research-backed gendered/ageist "exclusionary" detection) fired only in the AI builder, so pasted JDs — the dominant authoring surface — shipped with no inclusivity check. Extracted the findings render into a shared `JdLintPanel` and wired it into `LibraryJdForm`'s paste textarea (live as the recruiter types). The builder now renders the same panel.

4. **Salary anchor + grounding.** `EnginePanel` dropped the "show your work" trust artifacts — `metadata.groundingSources` and `deterministicEvidence.anchorBand` — that separate a defensible pay number from an opaque guess. Now rendered when present (near-zero effort; data already on the payload).

## Verification

| Gate | Result |
|---|---|
| tsc --noEmit | 0 |
| JS unit (`node --test`) | 1033 |
| i18n en/cs parity | OK (2883 keys) |

## Pattern (catalogue item 15)

15. **"Built-but-unwired" is a render, not a build.** The highest-ROI Highs here were all pure presentation over data the engine already computes and persists (coverage counts, per-family pairs, lint findings, grounding sources). When a finding says "computed but never surfaced," the fix is almost always a banner / selector / shared panel — verify the data path, then render it; no new compute, no new tests beyond the existing pure-logic coverage.

## What remains (the High tail)

~88 Highs across the INDEX themes — biggest clusters: Revenue/billing (19), Fairness/regulated-hiring (17), Dark-capability (9 left), Cross-tenant (11, mostly the deferred read-scoping), Comms (10). Next high-ROI candidates: the remaining dark-capability surfacings (voice telemetry panel, JD `JobPosting` JSON-LD for Google-for-Jobs, offer accept-rate KPI) and the fairness/correctness Highs.
