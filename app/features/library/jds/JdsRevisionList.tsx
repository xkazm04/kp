"use client";

import { useState } from "react";
import { useLocale } from "next-intl";
import { RotateCcw } from "lucide-react";
import type { JdRevision } from "./jdsEditClient";

// The JD edit-history list — the view/revert rows shared by BOTH editors (the
// ledger's in-modal JdModalEditor and the public page's JdActions). The row
// markup + the local view/expand state live here once; each surface passes its
// own localized labels so the copy stays native to its i18n namespace
// (library.tab.* in the ledger, jdPublic.* on the public page). `onRevert` runs
// the shared useJdEditor revert (baseBody CAS), so the revert path is identical
// on both surfaces.
export function JdRevisionList({
  revisions,
  reverting,
  gateBlocked = false,
  onRevert,
  gateReason,
  viewLabel,
  hideLabel,
  revertLabel,
  revertingLabel,
}: {
  revisions: JdRevision[];
  reverting: number | null;
  gateBlocked?: boolean;
  onRevert: (id: number) => void;
  gateReason?: string;
  viewLabel: string;
  hideLabel: string;
  revertLabel: string;
  revertingLabel: string;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);
  // The stamp is the ONLY thing that tells two revisions of the same JD apart
  // (their titles are usually identical), and it decides which snapshot the
  // recruiter reverts to — so it must read in the APP's locale, not the OS's.
  // A bare `toLocaleString()` follows the browser/OS: a cs workspace opened in an
  // en-US browser stamped this list "3/4/2026, 5:12:00 PM", which a Czech reader
  // parses as 3 April while it means 4 March — the wrong snapshot restored. Same
  // contract, same fix as `shortDate(iso, locale)` in jdsLibrary.ts and
  // `useRelativeTime`: the module stays locale-dumb, the client threads useLocale().
  const locale = useLocale();
  return (
    <ul className="space-y-2">
      {revisions.map((rev) => (
        <li key={rev.id} className="rounded-md border border-stone-100 bg-white px-3 py-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-ink">{rev.title}</span>
            <span className="text-steel">· {new Date(rev.created_at).toLocaleString(locale)}</span>
            <button
              type="button"
              onClick={() => setExpanded(expanded === rev.id ? null : rev.id)}
              className="focus-ring font-semibold text-coral hover:underline"
            >
              {expanded === rev.id ? hideLabel : viewLabel}
            </button>
            <button
              type="button"
              onClick={() => onRevert(rev.id)}
              disabled={reverting !== null || gateBlocked}
              title={gateBlocked ? gateReason : undefined}
              className="focus-ring ml-auto inline-flex items-center gap-1 rounded-md border border-coral/40 bg-white px-2 py-0.5 font-semibold text-coral hover:bg-coral/5 disabled:opacity-50"
            >
              <RotateCcw size={12} aria-hidden /> {reverting === rev.id ? revertingLabel : revertLabel}
            </button>
          </div>
          {expanded === rev.id ? (
            <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded bg-stone-50 p-2 font-mono text-xs text-ink">
              {rev.body}
            </pre>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
