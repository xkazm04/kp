"use client";

import { useCallback, useMemo, useState } from "react";
import { AlertTriangle, Send } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { LoadStatus } from "@/app/_components/LoadStatus";
import { clampPage, pageSlice, TablePager } from "@/app/_components/table/TablePager";
import { CHIP_TOGGLE } from "@/app/_components/ui/recipes";
import type { LoadState } from "@/app/_lib/useLoader";
import { OutboxRows } from "./OutboxRows";
import { outboxRows, type OutboxFilters } from "./outboxView";
import type { OutboxItem } from "./DevTypes";

/**
 * The Outbox tab: every message the pipeline sent.
 *
 * It used to render `outbox.slice(0, 50)` — no filters, no sort, no pager, and no
 * mention anywhere on screen that rows 51+ existed. On a workspace past its first
 * fifty messages that silently hid the thing this table is FOR: a dead-lettered
 * rejection or offer that never reached the candidate. Now it is the same register
 * as the Channels comms ledger — dead letters sorted to the top, per-column filters
 * in the headers, a one-click "chase dead letters" chip, and a real 20-row pager
 * (_components/table/TablePager) that says how many rows there are.
 */
export function OutboxTable({ outbox, state, onResent }: { outbox: OutboxItem[]; state: LoadState; onResent?: () => void }) {
  const t = useTranslations("devcase.outbox");
  const tc = useTranslations("channels.comms");
  const tk = useTranslations("devcase.outboxKind");
  const locale = useLocale();
  const [filters, setFilters] = useState<OutboxFilters>({ q: "", kind: "", status: "" });
  const [failedOnly, setFailedOnly] = useState(false);
  const [page, setPage] = useState(0);

  // Any filter change re-cuts the result set, so it also returns to the first page.
  const patchFilters = useCallback((patch: Partial<OutboxFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(0);
  }, []);

  // Message kind + delivery status are enum codes from the store. Render the catalog
  // label when we know the code, else fall back to the raw value (the pipeline may mint
  // a kind before its string lands) — never a blank cell.
  const kindLabel = useCallback(
    (kind: string) => {
      const key = kind as Parameters<typeof tk>[0];
      return tk.has(key) ? tk(key) : kind.replace(/_/g, " ");
    },
    [tk]
  );
  const statusLabel = useCallback(
    (status: OutboxItem["status"]) => {
      const KEY = { queued: "statusQueued", sent: "statusSent", failed: "statusFailed", bounced: "statusBounced" } as const;
      return tc(KEY[status] ?? "statusQueued");
    },
    [tc]
  );

  const view = useMemo(
    () => outboxRows(outbox, { filters, failedOnly, locale, kindLabel, statusLabel }),
    [outbox, filters, failedOnly, locale, kindLabel, statusLabel]
  );
  const safePage = clampPage(page, view.rows.length);
  const shown = pageSlice(view.rows, safePage);

  if (outbox.length === 0) {
    return (
      <div className="space-y-3">
        <LoadStatus state={state} label="the comms outbox" />
        <div className="rounded-lg border border-dashed border-stone-300 bg-white p-10 text-center">
          <Send size={22} className="mx-auto text-steel" aria-hidden />
          <p className="mt-2 text-base font-semibold text-ink">{t("emptyTitle")}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-steel">{t("emptyBody")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-micro text-steel">
        {t.rich("relayHint", {
          code: (chunks) => <span className="font-mono">{chunks}</span>,
          sent: (chunks) => <span className="text-moss">{chunks}</span>,
          failed: (chunks) => <span className="font-semibold text-red-700">{chunks}</span>,
        })}
      </p>

      {/* Total + a one-click "chase dead letters", exactly as the comms ledger. The
          count reads off the FILTERED set with the total beside it, so a narrowed
          view never looks like an outbox that lost rows. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-steel">
          {view.rows.length === outbox.length
            ? t("count", { count: outbox.length })
            : t("countFiltered", { shown: view.rows.length, total: outbox.length })}
        </p>
        {view.failedCount > 0 ? (
          <button
            type="button"
            aria-pressed={failedOnly}
            onClick={() => {
              setFailedOnly((f) => !f);
              setPage(0);
            }}
            className={CHIP_TOGGLE(failedOnly)}
          >
            <AlertTriangle size={12} aria-hidden /> {t("deadLetters", { count: view.failedCount })}
          </button>
        ) : null}
      </div>

      <OutboxRows
        shown={shown}
        emptyFiltered={view.rows.length === 0}
        onClearFilters={() => {
          patchFilters({ q: "", kind: "", status: "" });
          setFailedOnly(false);
        }}
        filters={filters}
        onFilters={patchFilters}
        facets={view.facets}
        kindLabel={kindLabel}
        statusLabel={statusLabel}
        onResent={onResent}
      />

      <TablePager page={safePage} total={view.rows.length} onPage={setPage} />
    </div>
  );
}
