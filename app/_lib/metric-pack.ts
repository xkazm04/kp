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
import { accrualHorizon, type AccrualReason } from "./accrual-horizon";

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
  /** For a row that blocks publication: how far it is from its floor and, at the
   *  recent pace, roughly when it clears (accrual-horizon.ts). null on a measured
   *  row, and on a not-measurable row whose sample already clears the floor (the
   *  missing thing is not observations, and `basis` says what it is). Optional
   *  only so a Metric built elsewhere keeps compiling; buildMetricPack always sets it. */
  need?: MetricNeed | null;
};

/** The sampling unit a row's floor is counted in. */
export type NeedUnit = "hires" | "actions" | "roles" | "responses";

export type MetricNeed = {
  more: number;
  /** The floor itself (MIN_SAMPLE, MIN_SAMPLE * 5 actions, MIN_OPEN_ROLES, NPS_MIN_SAMPLE). */
  floor: number;
  unit: NeedUnit;
  etaWeeks: number | null;
  /** Epoch ms; null with a reason. */
  etaDate: number | null;
  reason: AccrualReason | null;
  /** The sentence, resolved at build time in the reader's language — the SAME text
   *  the Markdown caveat carries, so the preview and the file cannot disagree. */
  note: string;
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
  /** How many hires the time-to-hire statistic was actually measured over. It is
   *  NARROWER than `hired`: db/analytics.ts computes the median/mean only over
   *  terminal rows that also carry `created_at`, `stage_changed_at` and a
   *  non-negative duration. Sampling that metric with `hired` published a
   *  `certifiable` pack off a sample the pack's own contract calls thin (on the
   *  shipped corpus: 9 hires, 5 measurable, MIN_SAMPLE 8 — so 9 cleared the floor
   *  and 5 did not). Optional so an existing caller keeps compiling; absent, it
   *  falls back to `hired` and the old behaviour. */
  timeToHireSamples?: number | null;
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
  /** The workspace's recent accrual pace, for the thin rows' horizon. Hires per week
   *  comes from the analytics momentum series (paceFromMomentum). Absent, every
   *  hire-accrued shortfall reports `no-pace` rather than inventing a date. Actions
   *  and NPS responses carry no measured pace today, so they always do. */
  pace?: { hiresPerWeek: number | null } | null;
};

/** Hires per week over the analytics momentum series (the weekly buckets the payload
 *  already computes, sized to the window). An empty or hire-less series is 0 — no pace,
 *  which the horizon turns into "no date" rather than a guess. */
export function paceFromMomentum(weeks: readonly { hired: number }[]): number {
  if (weeks.length === 0) return 0;
  const hired = weeks.reduce((sum, w) => sum + Math.max(0, w.hired || 0), 0);
  return hired / weeks.length;
}

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
  /** Windowed pack: capacity is a current snapshot, so the basis must refuse
   *  to look like the other rows (which ARE about last N days). */
  basisCapacityNow: (roles: number, recruiters: number, days: number) => string;
  basisCapacityNone: string;
  basisNps: (responses: number) => string;
  caveatNotMeasurable: (metric: string, basis: string) => string;
  caveatThin: (metric: string, sample: number) => string;
  /** The accrual-horizon sentence for a blocking row (need.* keys). */
  needNote: (need: Omit<MetricNeed, "note">, windowDays: number | null) => string;
  certifiableNote: string;
  notPublishable: string;
  disclaimer: string;
};

/** Resolve the pack's copy from a translator pinned to the reader's language.
 *  Numbers go in RAW so ICU does the plural agreement Czech needs (a pre-formatted
 *  string renders the literal word NaN). */
export function buildMetricPackStrings(t: MetricPackLookup, locale = "en"): MetricPackStrings {
  const fallbackName = (key: string) => key.replace(/_/g, " ");
  // UTC, like every cutoff in db/analytics.ts: a week-granular estimate has no
  // business moving a day with the reader's offset.
  const day = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
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
    basisCapacityNow: (roles, recruiters, days) => t("basis.capacityNow", { roles, recruiters, days }),
    basisCapacityNone: t("basis.capacityNone"),
    basisNps: (responses) => t("basis.nps", { responses }),
    caveatNotMeasurable: (metric, basis) => t("caveatNotMeasurable", { metric, basis }),
    caveatThin: (metric, sample) => t("caveatThin", { metric, sample }),
    needNote: (need, windowDays) => {
      const base = { shortfall: t(`need.shortfall.${need.unit}`, { count: need.more }), floor: need.floor };
      if (need.reason === "not-accruing") return t("need.notAccruing", base);
      if (need.reason === "no-pace") return t("need.noPace", base);
      if (need.reason === "window-too-narrow") return t("need.windowTooNarrow", { ...base, days: windowDays ?? 0 });
      return t("need.eta", { ...base, weeks: need.etaWeeks ?? 0, date: need.etaDate == null ? "" : day.format(need.etaDate) });
    },
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

  // The sample the TIME-TO-HIRE statistic actually rests on, not the hire count.
  // `status: measured` has to mean measured.
  const tthSamples = Math.max(0, input.timeToHireSamples ?? hires);

  const metrics: Metric[] = [
    metric(
      "time_to_hire",
      tth,
      "days",
      tthSamples,
      // The basis says "over N hires", so N must be the measured N too — a basis
      // that names a bigger population than the statistic is the same lie one
      // sentence further down.
      input.medianTimeToHireDays != null ? s.basisTimeToHireMedian(tthSamples) : s.basisTimeToHireMean(tthSamples)
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
      cap
        ? input.windowDays != null
          ? s.basisCapacityNow(cap.openRoles, cap.recruiters, input.windowDays)
          : s.basisCapacity(cap.openRoles, cap.recruiters)
        : s.basisCapacityNone,
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

  // THE ACCRUAL HORIZON per blocking row, in the row's own sampling unit. Hires are
  // the only unit with a measured pace (the momentum series); actions and NPS
  // responses have none today, so they say `no-pace` rather than borrow one. Capacity
  // is a point-in-time ratio: waiting does not raise it, so it is `not-accruing`.
  const nowMs = Date.parse(generatedAt);
  const hiresPerWeek = input.pace?.hiresPerWeek ?? null;
  const accrual: Record<string, { floor: number; unit: NeedUnit; perWeek: number | null; accrues: boolean }> = {
    time_to_hire: { floor: MIN_SAMPLE, unit: "hires", perWeek: hiresPerWeek, accrues: true },
    cost_per_hire: { floor: MIN_SAMPLE, unit: "hires", perWeek: hiresPerWeek, accrues: true },
    recruiter_hours_saved: { floor: MIN_SAMPLE * 5, unit: "actions", perWeek: null, accrues: true },
    recruiter_capacity: { floor: MIN_OPEN_ROLES, unit: "roles", perWeek: null, accrues: false },
    candidate_nps: { floor: NPS_MIN_SAMPLE, unit: "responses", perWeek: null, accrues: true },
  };
  for (const m of metrics) {
    m.need = null;
    const a = accrual[m.key];
    if (m.status === "measured" || !a || m.sample >= a.floor) continue;
    const h = accrualHorizon({
      have: m.sample,
      need: a.floor,
      perWeek: a.perWeek,
      // Capacity is a snapshot, not a windowed count — the window cannot bound it.
      windowDays: m.key === "recruiter_capacity" ? null : input.windowDays,
      nowMs: Number.isFinite(nowMs) ? nowMs : 0,
      accrues: a.accrues,
    });
    // An unparseable generatedAt cannot anchor a date; say no-pace rather than 1970.
    const dated = Number.isFinite(nowMs) ? h : h.reason ? h : { ...h, etaWeeks: null, etaDate: null, reason: "no-pace" as const };
    const bare = { more: dated.more, floor: a.floor, unit: a.unit, etaWeeks: dated.etaWeeks, etaDate: dated.etaDate, reason: dated.reason };
    m.need = { ...bare, note: s.needNote(bare, input.windowDays) };
  }

  const caveats: string[] = [];
  for (const m of metrics) {
    // The metric NAME in a caveat is the reader-facing label, but the machine key
    // stays on the metric row itself — a caveat is prose, `Metric.key` is the id.
    // The need sentence is appended VERBATIM from the row, so the Markdown caveat and
    // the JSON row (which the in-app preview renders) say the same thing.
    const needNote = m.need ? ` ${m.need.note}` : "";
    if (m.status === "not_measurable") caveats.push(s.caveatNotMeasurable(s.metricLabel(m.key), m.basis) + needNote);
    else if (m.status === "thin") caveats.push(s.caveatThin(s.metricLabel(m.key), m.sample) + needNote);
  }

  // Capacity is open roles NOW and membership NOW. Under a "Window: last N days"
  // header that is the one row that is not a figure about the stated period.
  // A pack whose ONLY measured row is that snapshot is not certifiable as a
  // windowed artefact — the period header would be a lie about the one number
  // that cleared the floor.
  const measured = metrics.filter((m) => m.status === "measured");
  const onlyCapacitySnapshot =
    input.windowDays != null && measured.length > 0 && measured.every((m) => m.key === "recruiter_capacity");

  return {
    metrics,
    certifiable: metrics.every((m) => m.status === "measured") && !onlyCapacitySnapshot,
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
