// Types + pure attribution helpers for the analytics decision log. Split out of
// DecisionLog.tsx (now AnalyticsDecisionLog.tsx) so the log's row/type plumbing
// has its own module — no JSX here, so it's a plain .ts file.
import { DECISION_META, type CohortProvenance, type SealedReason } from "@/app/_lib/decision-attribution";
import { formatRelativeTime } from "@/app/_lib/format";

export type Decision = {
  id: number;
  // The subject pipeline entry (ANA1 / Direction 2): present on entry-scoped
  // events, null on board-level ones (e.g. a role close). When present, the row
  // deep-links to the candidate on the board.
  entryId: string | null;
  candidateLabel: string | null;
  jobTitle: string | null;
  kind: string;
  fromStage: string | null;
  toStage: string | null;
  detail: string | null;
  createdAt: string;
  // log-tells-the-whole-story — the three sealed-record joins the route attaches per
  // page (each present only when a reliable match exists, never guessed):
  cohort?: CohortProvenance | null; // group-eval cohort provenance (advance rows)
  reason?: SealedReason | null; // sealed structured auto-reject reason (auto_rejected rows)
  counterpart?: { label: string } | null; // rematch counterpart, resolved to a live board label
};

export type DecisionPage = {
  decisions: Decision[];
  total: number;
  hasMore: boolean;
  nextOffset: number;
  error?: string;
};

export const PAGE_SIZE = 20;

// The auto/human decode + tone per event kind now lives in the shared
// decision-attribution module (ANA3) — the analytics automation rollup folds the
// SAME map server-side, so the per-row badge and the aggregate can never drift.
// The readable label still comes from the `analytics.log.kinds.<kind>` catalog,
// resolved at the render site.

// Attribution is three-state on purpose. In an auditable log, defaulting an
// unrecognized kind to AUTO would misattribute accountability to the machine —
// the most damaging default. An unmapped kind renders a neutral UNKNOWN badge
// and warns in dev, so adding a backend event kind forces a conscious entry in
// DECISION_META above (the kinds here must track recordAutomationEvent callers).
// `known` gates whether a catalog label exists; unknown falls back to the raw kind.
export function decisionMeta(kind: string): { known: boolean; attribution: "auto" | "human" | "unknown"; tone: string } {
  const meta = DECISION_META[kind];
  if (meta) return { known: true, attribution: meta.auto ? "auto" : "human", tone: meta.tone };
  if (process.env.NODE_ENV !== "production") {
    console.warn(`[analytics] unmapped decision kind "${kind}" — add it to DECISION_META (rendering as UNKNOWN, not AUTO).`);
  }
  return { known: false, attribution: "unknown", tone: "text-steel" };
}

export const ATTRIBUTION_BADGE = {
  auto: "bg-moss/10 text-moss",
  human: "bg-coral/10 text-coral",
  unknown: "bg-stone-100 text-steel",
} as const;

// Audit rows show "—" for a blank/malformed timestamp; otherwise the shared
// relative-time renderer (formatRelativeTime, which returns "" on invalid).
// `locale` is the active next-intl locale, threaded from the rendering row so
// the age reads in the same language as the rest of the log.
export function timeAgo(iso: string, locale: string): string {
  return formatRelativeTime(iso, locale) || "—";
}
