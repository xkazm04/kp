// Reliability diagram as a file.
//
// The Quality headline's evidence is predicted vs observed per bin, and unlike
// funnel, roles, economics, ROI and the decision log it had no way off the
// screen. A DPO/TA defending "this score may decide" needs those bins, n, the
// floor, and which source/outcome produced the curve.
//
// Same em-dash / provenance pattern as analyticsFunnelCsv.ts. Empty bins are
// omitted: a row of zeros is not a measurement.
import type { CalibrationResult } from "@/app/_lib/calibration";
import { withExportProvenance } from "./analyticsDecisionLogTypes";

export type ReliabilityCsvLabels = {
  bin: string;
  lo: string;
  hi: string;
  n: string;
  predicted: string;
  observed: string;
};

export type ReliabilityCsvMeta = {
  source: string;
  outcome: string;
  threshold?: number | null;
  autoRejectEnabled?: boolean | null;
  generatedAt?: string;
};

export type ReliabilityCsvProvLabels = {
  export: string;
  generated: string;
  source: string;
  outcome: string;
  threshold: string;
  enforced: string;
};

export function reliabilityCsvProvenance(
  exportName: string,
  meta: ReliabilityCsvMeta,
  labels: ReliabilityCsvProvLabels
): [string, string | number][] {
  const rows: [string, string | number][] = [
    [labels.export, exportName],
    [labels.generated, meta.generatedAt ?? new Date().toISOString()],
    [labels.source, meta.source],
    [labels.outcome, meta.outcome],
  ];
  if (typeof meta.threshold === "number") rows.push([labels.threshold, meta.threshold]);
  if (meta.autoRejectEnabled != null) rows.push([labels.enforced, meta.autoRejectEnabled ? "yes" : "no"]);
  return rows;
}

export function reliabilityCsvRows(
  result: Pick<CalibrationResult, "bins">,
  labels: ReliabilityCsvLabels,
  scope?: { provenance: [string, string | number][] }
): (string | number | null)[][] {
  const filled = result.bins.filter((b) => b.count > 0);
  const header = [labels.bin, labels.lo, labels.hi, labels.n, labels.predicted, labels.observed];
  const body = filled.map((b, i) => [i + 1, b.lo, b.hi, b.count, b.predicted, b.observed]);
  if (!scope) return [header, ...body];
  return withExportProvenance(scope.provenance, header, body);
}
