"use client";

import type { ReactNode } from "react";
import { useLocale } from "next-intl";
import { formatCount } from "./figure";
import { Measure } from "./Measure";
import "./kit.css";
import "./menu.css";

/**
 * @catalog The bulk bar of a select mode: in flow directly above the list it acts on, sticky while that list scrolls; the selection count sits in the mark track, one status line says what is selected (and how many the filter hides), the actions wrap on the line under it, and an optional detail line carries a dependent action row or the last result.
 */
export function BulkBar({ count, label, status, actions, detail }: {
  count: number;
  /** The bar's accessible name (a region). */
  label: string;
  /** One line; announced politely when it changes. */
  status: ReactNode;
  actions?: ReactNode;
  detail?: ReactNode;
}) {
  const locale = useLocale();
  return (
    <Measure className="k-bulkbar" role="region" aria-label={label} data-part="bulk-bar" data-role="kit-bulk-bar">
      <span className="k-bulkbar__n" aria-hidden>{formatCount(count, locale)}</span>
      <div className="k-bulkbar__status" aria-live="polite" data-role="kit-bulk-status">{status}</div>
      {actions ? <div className="k-bulkbar__acts">{actions}</div> : null}
      {detail ? <div className="k-bulkbar__detail">{detail}</div> : null}
    </Measure>
  );
}
