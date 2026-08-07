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
//
// WHOSE LANGUAGE (F15, docs/architecture/localization.md "Two readers"): the pack is
// computed on demand for whoever pressed Download and is handed straight back on that
// request — there is no stored artifact and no language field to pin to. The reader IS
// the UI user, so the language is the REQUEST's (`getServerLocale()` in the route).
// The builder itself stays pure and takes its copy as a parameter (the shape rule); the
// catalog loader is metric-pack-strings.ts.

import { NPS_MIN_SAMPLE } from "./candidate-nps";

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
  /** Candidate NPS over the same window. Pass candidate-nps.ts's `rawScore` (the
   *  unwithheld figure), not `score`: the pack applies its own sample policy and labels a
   *  thin metric rather than hiding it, which keeps the invariant that a null value always
   *  means "no data" and never "we chose not to say". */
  candidateNps?: { score: number | null; responses: number } | null;
  windowDays: number | null;
};

/** Minimal translator shape the loader satisfies — the same contract
 *  `PostingLookup` states for the job posting (catalog-translator.ts's
 *  CatalogTranslator, or a wrapped `useTranslations()`). Declared structurally so
 *  this module keeps its no-catalog, `node --test`-loadable promise. */
export type MetricPackLookup = {
  (key: string, values?: Record<string, string | number>): string;
  has: (key: string) => boolean;
};

/** Every word the pack can emit, resolved for one reader. Passed into both the
 *  builder (the `basis` / `caveats` prose travels inside the pack, including on the
 *  JSON response) and the renderer, so a pack is never half-translated. */
export type MetricPackStrings = {
  title: string;
  windowAll: string;
  windowLast: (days: number) => string;
  windowLine: (window: string, generatedAt: string) => string;
  colMetric: string;
  colValue: string;
  colStatus: string;
  colBasis: string;
  /** Display name for a metric key, falling back to the de-underscored key. */
  metricLabel: (key: string) => string;
  unitLabel: (unit: Metric["unit"]) => string;
  statusLabel: (status: MetricStatus) => string;
  basisTimeToHireMedian: (hires: number) => string;
  basisTimeToHireMean: (hires: number) => string;
  basisCostPerHire: (hires: number) => string;
  basisHoursSaved: (actions: number) => string;
  basisHoursSavedNone: string;
  basisCapacity: (roles: number, recruiters: number) => string;
  basisCapacityNone: string;
  basisNps: (responses: number) => string;
  caveatNotMeasurable: (metric: string, basis: string) => string;
  caveatThin: (metric: string, sample: number) => string;
  certifiableNote: string;
  notPublishable: string;
  disclaimer: string;
};

/** Resolve the pack's copy from a translator pinned to the reader's language.
 *  Numbers go in RAW so ICU does the plural agreement Czech needs (a pre-formatted
 *  string renders the literal word NaN). */
export function buildMetricPackStrings(t: MetricPackLookup): MetricPackStrings {
  const fallbackName = (key: string) => key.replace(/_/g, " ");
  return {
    title: t("title"),
    windowAll: t("windowAll"),
    windowLast: (days) => t("windowLast", { days }),
    windowLine: (window, generatedAt) => t("windowLine", { window, generatedAt }),
    colMetric: t("colMetric"),
    colValue: t("colValue"),
    colStatus: t("colStatus"),
    colBasis: t("colBasis"),
    // A metric key with no catalog entry degrades to the readable key, never to a
    // raw "metric.foo" path — the same has-fallback idiom jobsMarkdown's enumLabel uses.
    metricLabel: (key) => (t.has(`metric.${key}`) ? t(`metric.${key}`) : fallbackName(key)),
    unitLabel: (unit) => (t.has(`unit.${unit}`) ? t(`unit.${unit}`) : unit),
    statusLabel: (status) => t(`status.${status}`),
    basisTimeToHireMedian: (hires) => t("basis.timeToHireMedian", { hires }),
    basisTimeToHireMean: (hires) => t("basis.timeToHireMean", { hires }),
    basisCostPerHire: (hires) => t("basis.costPerHire", { hires }),
    basisHoursSaved: (actions) => t("basis.hoursSaved", { actions }),
    basisHoursSavedNone: t("basis.hoursSavedNone"),
    basisCapacity: (roles, recruiters) => t("basis.capacity", { roles, recruiters }),
    basisCapacityNone: t("basis.capacityNone"),
    basisNps: (responses) => t("basis.nps", { responses }),
    caveatNotMeasurable: (metric, basis) => t("caveatNotMeasurable", { metric, basis }),
    caveatThin: (metric, sample) => t("caveatThin", { metric, sample }),
    certifiableNote: t("certifiableNote"),
    notPublishable: t("notPublishable"),
    disclaimer: t("disclaimer"),
  };
}

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
export function buildMetricPack(input: MetricPackInput, generatedAt: string, s: MetricPackStrings): MetricPack {
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
      input.medianTimeToHireDays != null ? s.basisTimeToHireMedian(hires) : s.basisTimeToHireMean(hires)
    ),
    metric("cost_per_hire", input.costPerHireCzk, "czk", hires, s.basisCostPerHire(hires)),
    metric(
      "recruiter_hours_saved",
      roi ? roi.hoursSaved : null,
      "hours",
      roi?.totalActions ?? 0,
      roi ? s.basisHoursSaved(roi.totalActions) : s.basisHoursSavedNone,
      // Sampled in ACTIONS, not hires: the estimate firms up with automated volume, and a
      // team can accumulate hundreds of actions before its first hire closes.
      MIN_SAMPLE * 5
    ),
    metric(
      "recruiter_capacity",
      capacityRatio,
      "roles_per_recruiter",
      cap?.openRoles ?? 0,
      cap ? s.basisCapacity(cap.openRoles, cap.recruiters) : s.basisCapacityNone,
      MIN_OPEN_ROLES
    ),
  ];

  // Candidate NPS. Only appears when the workspace has collected any response at all —
  // a "candidate experience" row on a workspace that has never asked is noise, not a gap.
  const nps = input.candidateNps;
  if (nps && nps.responses > 0) {
    metrics.push(
      metric(
        "candidate_nps",
        nps.score,
        "pct",
        nps.responses,
        s.basisNps(nps.responses),
        // Same floor candidate-nps.ts uses for its own withholding, so one number is not
        // publishable in one place and not in the other.
        NPS_MIN_SAMPLE
      )
    );
  }

  const caveats: string[] = [];
  for (const m of metrics) {
    // The metric NAME in a caveat is the reader-facing label, but the machine key
    // stays on the metric row itself — a caveat is prose, `Metric.key` is the id.
    if (m.status === "not_measurable") caveats.push(s.caveatNotMeasurable(s.metricLabel(m.key), m.basis));
    else if (m.status === "thin") caveats.push(s.caveatThin(s.metricLabel(m.key), m.sample));
  }

  return {
    metrics,
    certifiable: metrics.every((m) => m.status === "measured"),
    caveats,
    windowDays: input.windowDays,
    generatedAt,
  };
}

/** Render the pack as the one-page Markdown a recruiter can paste into a deck or a
 *  procurement answer. Every row carries its status and basis — the artifact argues for
 *  itself rather than needing a footnote someone will drop.
 *
 *  Pure: the strings table is passed in (metricPackStrings(locale)) so the same
 *  function renders any of the four languages. `title` still overrides the table's
 *  default for a caller that names the pack itself. */
export function renderMetricPack(pack: MetricPack, s: MetricPackStrings, title = s.title): string {
  const window = pack.windowDays ? s.windowLast(pack.windowDays) : s.windowAll;
  const lines = [
    `# ${title}`,
    "",
    s.windowLine(window, pack.generatedAt),
    "",
    `| ${s.colMetric} | ${s.colValue} | ${s.colStatus} | ${s.colBasis} |`,
    "| --- | --- | --- | --- |",
  ];
  for (const m of pack.metrics) {
    const value = m.value == null ? "—" : `${m.value} ${s.unitLabel(m.unit)}`;
    lines.push(`| ${s.metricLabel(m.key)} | ${value} | ${s.statusLabel(m.status)} | ${m.basis} |`);
  }
  lines.push("");
  if (pack.certifiable) {
    lines.push(s.certifiableNote);
  } else {
    lines.push(s.notPublishable);
    for (const c of pack.caveats) lines.push(`- ${c}`);
  }
  lines.push("");
  lines.push(s.disclaimer);
  return lines.join("\n");
}
