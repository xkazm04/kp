// Adversarial probe-strength audit for designed dev cases (idea-bb4f5494).
// design_case bakes covert probes with a decisionSpace, but nothing checks a probe
// actually DISCRIMINATES before the case meets a real candidate — quality was
// asserted by the design prompt, never measured. A take-home is only worth giving
// if it separates good from naive; this statically certifies each probe is
// load-bearing and flags dead ones at the approval gate, so a human never ships a
// case whose probes can't tell strong from naive.
//
// This is the deterministic STRUCTURAL audit: a probe can only discriminate if it
// forces a real choice (≥2 distinct defensible options), plants that choice at a
// concrete seam (`where`), and defines what good-vs-naive handling reveals
// (`reveals`). The deeper version — running a synthetic strong-vs-naive submission
// through the evaluate path per probe — is a follow-up; the structural gate
// catches the common failure (an empty/degenerate decisionSpace) cheaply and
// without an LLM call.
//
// Pure + import-free so the contract is unit-testable.

type ProbeLike = { id?: string; kind?: string; where?: string; reveals?: string; decisionSpace?: string[] };

export type ProbeAudit = {
  probeId: string;
  kind: string;
  where: string;
  loadBearing: boolean;
  issues: string[]; // why it can't discriminate (empty when load-bearing)
};

export type CaseProbeAudit = {
  probes: ProbeAudit[];
  total: number;
  loadBearing: number;
  // none = nothing can discriminate (ship-blocker); weak = a minority can; strong
  // = at least two probes, a majority load-bearing.
  verdict: "strong" | "weak" | "none";
};

// Minimum distinct, defensible options a decisionSpace needs to force a choice.
const MIN_OPTIONS = 2;

function distinctOptions(decisionSpace: string[] | undefined): number {
  const seen = new Set<string>();
  for (const opt of decisionSpace ?? []) {
    const norm = String(opt ?? "").trim().toLowerCase();
    if (norm) seen.add(norm);
  }
  return seen.size;
}

export function auditProbe(probe: ProbeLike): ProbeAudit {
  const issues: string[] = [];
  if (distinctOptions(probe.decisionSpace) < MIN_OPTIONS) {
    issues.push("No forced choice — needs at least two distinct defensible options.");
  }
  if (!String(probe.where ?? "").trim()) {
    issues.push("No concrete seam — nowhere in the task to plant the trap.");
  }
  if (!String(probe.reveals ?? "").trim()) {
    issues.push("No good-vs-naive criterion — nothing to grade the handling against.");
  }
  return {
    probeId: probe.id ?? "",
    kind: probe.kind ?? "probe",
    where: probe.where ?? "",
    loadBearing: issues.length === 0,
    issues,
  };
}

/** Audit every probe on a case and roll up a discrimination verdict. */
export function auditProbeStrength(probes: ProbeLike[]): CaseProbeAudit {
  const audited = probes.map(auditProbe);
  const loadBearing = audited.filter((p) => p.loadBearing).length;
  const total = audited.length;
  let verdict: CaseProbeAudit["verdict"];
  if (total === 0 || loadBearing === 0) verdict = "none";
  else if (loadBearing >= 2 && loadBearing * 2 >= total) verdict = "strong";
  else verdict = "weak";
  return { probes: audited, total, loadBearing, verdict };
}
