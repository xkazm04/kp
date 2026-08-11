// Pure view model for the Assignments outbox: which rows survive the column
// filters, in what order, and which options each filter offers.
//
// React- and next-intl-free so the ordering guarantee that matters — dead letters
// first, ALWAYS, whatever else is on screen — unit-tests directly. The old table
// had no ordering at all and cut the list at 50 rows, so a failed rejection could
// sit forever at row 63 with nothing on screen admitting it existed.

import type { OutboxStatus } from "@/app/_lib/comms-status";
import type { OutboxItem } from "./DevTypes";

export type OutboxFilters = {
  /** Free text over recipient and subject. */
  q: string;
  /** Message-kind wire code — "" means all. */
  kind: string;
  /** OutboxStatus — "" means all. */
  status: string;
};

export type Facet = { value: string; label: string };
export type OutboxFacets = { kinds: Facet[]; statuses: Facet[] };

/** A message that needs a human: the relay refused it and nothing was re-sent.
 *  `queued` is NOT actionable — it's the terminal local-dev state, not a failure. */
export function isDeadLetter(m: OutboxItem): boolean {
  return m.status === "failed" || m.status === "bounced";
}

export function outboxRows(
  outbox: readonly OutboxItem[],
  opts: {
    filters: OutboxFilters;
    failedOnly: boolean;
    locale: string;
    kindLabel: (kind: string) => string;
    statusLabel: (status: OutboxStatus) => string;
  }
): { rows: OutboxItem[]; facets: OutboxFacets; failedCount: number } {
  const { filters, failedOnly, locale, kindLabel, statusLabel } = opts;
  const collator = new Intl.Collator(locale);
  const needle = filters.q.trim().toLowerCase();

  const failedCount = outbox.filter(isDeadLetter).length;

  // Facets list only what is PRESENT, labelled and collated for the active locale
  // (a plain .sort() puts Č/Ř/Š/Ž after Z, which reads as broken in cs).
  const kinds = [...new Set(outbox.map((m) => m.kind).filter((k): k is string => Boolean(k)))]
    .map((value) => ({ value, label: kindLabel(value) }))
    .sort((a, b) => collator.compare(a.label, b.label));
  // Status is a closed vocabulary, so it keeps severity order (worst first) rather
  // than being alphabetized — but still lists only what is present.
  const present = new Set(outbox.map((m) => m.status));
  const statuses = (["bounced", "failed", "queued", "sent"] as const)
    .filter((s) => present.has(s))
    .map((value) => ({ value, label: statusLabel(value) }));

  const rows = outbox
    .filter((m) => {
      if (failedOnly && !isDeadLetter(m)) return false;
      if (filters.kind && m.kind !== filters.kind) return false;
      if (filters.status && m.status !== filters.status) return false;
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

  return { rows, facets: { kinds, statuses }, failedCount };
}
