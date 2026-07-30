// W0.4 — the METRIC PACK: the four numbers a buyer asks for, in one artifact.
//
// A competitor sells on "55% lower time-to-fill · 65% more HR productivity · $25K saved
// per 100 hires · recruiters went from 4-6 roles to 8-12". kp computes every ingredient
// for those claims already (analytics: time-to-hire, cost-per-hire, automation ROI hours,
// compute cost) — but scattered across panels, so there was nothing to put on a slide.
// This assembles them into one shareable, self-describing pack.
//
// THE HONESTY CONTRACT (why this is not just four numbers):
// a marketing number computed off two hires is a lie with a decimal point. Every metric
// here carries its own `status`:
//
//   measured        — enough data; the value stands
//   thin            — a real value from a sample below MIN_SAMPLE; shown, always labelled
//   not_measurable  — no data at all; value is null, and NO number is invented
//
// A pack renderer must show the status beside the value. `certifiable` is the one-line
// answer to "can this go in front of a customer": true only when every headline metric is
// `measured`. That is the difference between our number and theirs — ours says when it
// does not know.
//
// Pure + dependency-free (structural inputs, no DB import) so it loads under `node --test`.

/** Below this many samples a metric is real but not certifiable. Eight hires is roughly
 *  a quarter of hiring for a mid-size team — enough to stop a single outlier hire from
 *  moving a headline number by tens of percent. */
export const MIN_SAMPLE = 8;

/** Recruiter capacity below this many open roles per recruiter is not a capacity signal,
 *  it is a quiet quarter. Stated, not hidden. */
export const MIN_OPEN_ROLES = 3;

export type MetricStatus = "measured" | "thin" | "not_measurable";

export type Metric = {
  key: string;
  /** Machine value in `unit`; null iff status is "not_measurable". */
  value: number | null;
  unit: "days" | "czk" | "usd" | "hours" | "roles_per_recruiter" | "pct";
  status: MetricStatus;
  /** How many observations back it — the number a reader needs to judge the value. */
  sample: number;
  /** Plain-language statement of what was counted. Never omitted: a metric whose basis
   *  cannot be stated cannot be defended in a procurement conversation. */
  basis: string;
};

export type MetricPack = {
  metrics: Metric[];
  /** True only when every metric is "measured" — the pack is safe to publish as-is. */
  certifiable: boolean;
  /** Human-readable reasons it is not certifiable (empty when it is). */
  caveats: string[];
  windowDays: number | null;
  generatedAt: string;
};

// Structural inputs — the real Analytics payload satisfies these; we name only what is read.
export type MetricPackInput = {
  hired: number;
  medianTimeToHireDays: number | null;
  avgTimeToHireDays: number | null;
  costPerHireCzk: number | null;
  automationRoi: { hoursSaved: number; hoursSavedPerHire: number | null; pctOfManualBaseline: number | null; totalActions: number } | null;
  /** Open roles and the recruiters carrying them — the capacity ratio's two terms. */
  capacity?: { openRoles: number; recruiters: number } | null;
  windowDays: number | null;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

function metric(key: string, value: number | null, unit: Metric["unit"], sample: number, basis: string, minSample = MIN_SAMPLE): Metric {
  // Order matters: no value means not_measurable regardless of sample, and a value with
  // a thin sample is never silently promoted to measured.
  const status: MetricStatus = value == null ? "not_measurable" : sample >= minSample ? "measured" : "thin";
  return { key, value: value == null ? null : round1(value), unit, status, sample, basis };
}

/**
 * Assemble the pack. Deliberately does NOT compute a "% improvement vs before" — kp has no
 * pre-kp baseline for a customer's own process, and inventing one is exactly the move that
 * makes vendor metrics untrustworthy. The pack states what IS, with its sample; the
 * comparison is the customer's to make against their own prior numbers.
 */
export function buildMetricPack(input: MetricPackInput, generatedAt: string): MetricPack {
  const hires = Math.max(0, input.hired || 0);
  const roi = input.automationRoi;
  const cap = input.capacity;

  // Median over mean for time-to-hire: one stalled req drags a mean for months, and the
  // median is what a recruiter recognises as "how long this normally takes".
  const tth = input.medianTimeToHireDays ?? input.avgTimeToHireDays ?? null;

  const capacityRatio =
    cap && cap.recruiters > 0 && cap.openRoles > 0 ? cap.openRoles / cap.recruiters : null;

  const metrics: Metric[] = [
    metric(
      "time_to_hire",
      tth,
      "days",
      hires,
      input.medianTimeToHireDays != null
        ? `Median days from first contact to hire, over ${hires} hire(s).`
        : `Mean days from first contact to hire, over ${hires} hire(s) — no median available.`
    ),
    metric("cost_per_hire", input.costPerHireCzk, "czk", hires, `Recorded channel spend divided by ${hires} hire(s). Excludes salary and internal time.`),
    metric(
      "recruiter_hours_saved",
      roi ? roi.hoursSaved : null,
      "hours",
      roi?.totalActions ?? 0,
      roi
        ? `Recruiter hours not spent, from ${roi.totalActions} automated action(s) at the per-action minute rates in automation-roi.ts.`
        : "No automated actions recorded.",
      // Sampled in ACTIONS, not hires: the estimate firms up with automated volume, and a
      // team can accumulate hundreds of actions before its first hire closes.
      MIN_SAMPLE * 5
    ),
    metric(
      "recruiter_capacity",
      capacityRatio,
      "roles_per_recruiter",
      cap?.openRoles ?? 0,
      cap
        ? `${cap.openRoles} open role(s) carried by ${cap.recruiters} recruiter(s).`
        : "No open roles or no recruiter roster.",
      MIN_OPEN_ROLES
    ),
  ];

  const caveats: string[] = [];
  for (const m of metrics) {
    if (m.status === "not_measurable") caveats.push(`${m.key}: no data yet — ${m.basis}`);
    else if (m.status === "thin") caveats.push(`${m.key}: only ${m.sample} observation(s) — real, but too thin to publish.`);
  }

  return {
    metrics,
    certifiable: metrics.every((m) => m.status === "measured"),
    caveats,
    windowDays: input.windowDays,
    generatedAt,
  };
}

const UNIT_LABEL: Record<Metric["unit"], string> = {
  days: "days",
  czk: "CZK",
  usd: "USD",
  hours: "h",
  roles_per_recruiter: "roles/recruiter",
  pct: "%",
};

const STATUS_MARK: Record<MetricStatus, string> = {
  measured: "measured",
  thin: "THIN SAMPLE",
  not_measurable: "not measurable",
};

/** Render the pack as the one-page Markdown a recruiter can paste into a deck or a
 *  procurement answer. Every row carries its status and basis — the artifact argues for
 *  itself rather than needing a footnote someone will drop. */
export function renderMetricPack(pack: MetricPack, title = "Hiring metric pack"): string {
  const window = pack.windowDays ? `last ${pack.windowDays} days` : "all time";
  const lines = [
    `# ${title}`,
    "",
    `Window: ${window} · generated ${pack.generatedAt}`,
    "",
    "| Metric | Value | Status | Basis |",
    "| --- | --- | --- | --- |",
  ];
  for (const m of pack.metrics) {
    const value = m.value == null ? "—" : `${m.value} ${UNIT_LABEL[m.unit]}`;
    lines.push(`| ${m.key.replace(/_/g, " ")} | ${value} | ${STATUS_MARK[m.status]} | ${m.basis} |`);
  }
  lines.push("");
  if (pack.certifiable) {
    lines.push("Every metric above is measured over a sufficient sample.");
  } else {
    lines.push("**Not publication-ready.** The following metrics cannot yet be defended:");
    for (const c of pack.caveats) lines.push(`- ${c}`);
  }
  lines.push("");
  lines.push(
    "_Figures describe this workspace's own recorded activity. kp does not compute an improvement " +
      "percentage against a pre-kp baseline — that comparison belongs to whoever holds the prior numbers._"
  );
  return lines.join("\n");
}
