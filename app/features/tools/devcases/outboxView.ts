// Pure view model for the Assignments outbox: which rows survive the column
// filters, in what order, and which options each filter offers.
//
// React- and next-intl-free so the ordering guarantee that matters — dead letters
// first, ALWAYS, whatever else is on screen — unit-tests directly. The old table
// had no ordering at all and cut the list at 50 rows, so a failed rejection could
// sit forever at row 63 with nothing on screen admitting it existed.
//
// DELIVERY TRUTH IS DERIVED, NEVER PROJECTED. dev_outbox is an APPEND-ONLY log: a
// row is never mutated, so a later same-(ref,kind) row supersedes an earlier one.
// This table used to render the raw `status` column, which made it the third surface
// to disagree with the other two about the same message — the exact divergence
// `commsVerdict` was written to kill (comms-view.ts): a bounced offer showed a green
// "Sent" here while the Comms Center showed red "Bounced", the relay's bounce RECEIPT
// appeared beside it as a phantom message, and a dead letter a resend had already
// recovered stayed red in the "needs attention" chip forever — still offering a
// one-click Resend the server answers with 409. So the rows go through the same
// `deriveCommsView` + `commsVerdict` pair every other comms surface reads; this module
// only decides ordering, filtering and facets over the verdict it is handed.
//
// Window caveat: supersession is computed over the rows the API returned (currently
// the newest 50, GET /api/devcase/comms). A receipt whose send falls outside that
// window folds onto nothing and reads `orphaned` — still a dead letter, still first
// on screen, so the direction of the error is "needs a human", never "delivered".

import { commsVerdict, deriveCommsView, type CommsVerdict } from "@/app/_lib/comms-view";
import type { OutboxItem } from "./DevTypes";

export type OutboxFilters = {
  /** Free text over recipient and subject. */
  q: string;
  /** Message-kind wire code — "" means all. */
  kind: string;
  /** CommsVerdict — "" means all. */
  status: string;
};

/** An outbox row carrying the delivery verdict the library derived for it. */
export type OutboxRowView = OutboxItem & { verdict: CommsVerdict };

export type Facet = { value: string; label: string };
export type OutboxFacets = { kinds: Facet[]; statuses: Facet[] };

// Severity order for the status filter, worst first (a closed vocabulary, so it is
// never alphabetized). `recovered` sits with the benign half deliberately: a dead
// letter whose resend landed is audit, not an alarm.
const VERDICT_ORDER = ["orphaned", "bounced", "failed", "recovered", "sent", "queued"] as const;

/** A message that needs a human: the relay refused it, reported it undeliverable, or
 *  reported one for a send we never made — and nothing later put it right.
 *  `queued` is NOT actionable — it's the terminal local-dev state, not a failure;
 *  `recovered` is NOT actionable either — a later resend of it reached the relay. */
export function isDeadLetter(m: { verdict: CommsVerdict }): boolean {
  return m.verdict === "failed" || m.verdict === "bounced" || m.verdict === "orphaned";
}

/** Raw append-only rows → the derived delivery view, one verdict per row, with each
 *  bounce receipt folded onto the send it concerns (a receipt is relay signal, not a
 *  message the pipeline sent, so it must not sit in this ledger as its own row). */
export function outboxVerdicts(outbox: readonly OutboxItem[]): OutboxRowView[] {
  const derived = deriveCommsView(
    outbox.map((m) => ({
      id: m.id,
      recipient: m.recipient,
      subject: m.subject,
      body: m.body ?? null,
      kind: m.kind,
      channel: m.channel,
      status: m.status,
      ref: m.ref ?? null,
      createdAt: m.createdAt,
      failureDetail: m.failureDetail ?? null,
    }))
  );
  return derived.map((m) => ({ ...m, verdict: commsVerdict(m) }));
}

export function outboxRows(
  outbox: readonly OutboxItem[],
  opts: {
    filters: OutboxFilters;
    failedOnly: boolean;
    locale: string;
    kindLabel: (kind: string) => string;
    statusLabel: (verdict: CommsVerdict) => string;
  }
): { rows: OutboxRowView[]; facets: OutboxFacets; failedCount: number; total: number } {
  const { filters, failedOnly, locale, kindLabel, statusLabel } = opts;
  const collator = new Intl.Collator(locale);
  const needle = filters.q.trim().toLowerCase();

  // The population is the DERIVED one — folded receipts are not messages, so they
  // are not in the total the header reports either.
  const all = outboxVerdicts(outbox);
  const failedCount = all.filter(isDeadLetter).length;

  // Facets list only what is PRESENT, labelled and collated for the active locale
  // (a plain .sort() puts Č/Ř/Š/Ž after Z, which reads as broken in cs).
  const kinds = [...new Set(all.map((m) => m.kind).filter((k): k is string => Boolean(k)))]
    .map((value) => ({ value, label: kindLabel(value) }))
    .sort((a, b) => collator.compare(a.label, b.label));
  // Status is a closed vocabulary, so it keeps severity order (worst first) rather
  // than being alphabetized — but still lists only what is present.
  const present = new Set(all.map((m) => m.verdict));
  const statuses = VERDICT_ORDER.filter((s) => present.has(s)).map((value) => ({ value, label: statusLabel(value) }));

  const rows = all
    .filter((m) => {
      if (failedOnly && !isDeadLetter(m)) return false;
      if (filters.kind && m.kind !== filters.kind) return false;
      if (filters.status && m.verdict !== filters.status) return false;
      if (needle) {
        const hay = `${m.recipient ?? ""} ${m.subject ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    })
    // Dead letters first, then newest-first within each group. This ordering is the
    // point of the table: a dropped offer or rejection is the only row here that
    // needs a human, so it can never be pushed off the first page by volume.
    .sort((a, b) => {
      const aa = isDeadLetter(a);
      const bb = isDeadLetter(b);
      if (aa !== bb) return aa ? -1 : 1;
      return Date.parse(b.createdAt) - Date.parse(a.createdAt);
    });

  return { rows, facets: { kinds, statuses }, failedCount, total: all.length };
}
