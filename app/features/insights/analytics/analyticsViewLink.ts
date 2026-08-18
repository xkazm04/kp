// UAT TOM-ANA-8 (convergent with KAT-ANA-9) — the MINTING half of a shareable
// analytics view.
//
// The reader opens this tab because someone asked them a question, and the last
// step of that job is sending the answer back. Today the address bar cannot be
// that artifact: `?tab=` and `?sec=` are an INBOX, not state — useUrlInboxState
// adopts an incoming value and then clears the param
// (shell/nav/useUrlInboxState.ts:66-76), which is exactly what stops a deep link
// bouncing back to Overview one render after it lands (2d02a388). So after
// arriving on /?tab=analytics&sec=quality the URL reads "/", and the only view
// state that survives is ?win=, which AnalyticsTab writes with router.replace.
// Net: the link handed to the VP is "/?win=30" — a window preference with no
// destination.
//
// The inbox is NOT changed here. The reading half already works; what was missing
// is a way to mint the link the inbox knows how to read. That is this one pure
// function (origin in, string out), so the URL contract is pinned by a test rather
// than by a click on a live host.
import { buildUrl } from "@/app/features/shell/tabs";
import type { AnalyticsSectionId } from "./sections/analyticsSections";

/** The absolute, pasteable URL that reopens the analytics view the reader is on.
 *
 *  `origin` is passed in (never read off `window` here) so the function stays pure
 *  and SSR-safe; the caller supplies `window.location.origin`. Deliberately the
 *  runtime origin and not `publicBaseUrl()`: that resolver exists for links sent to
 *  EXTERNAL candidates and rewrites to the deployment's public host, whereas this
 *  link goes to a colleague reaching the same workspace the sender is looking at. */
export function analyticsViewUrl({
  origin,
  section,
  days,
}: {
  origin: string;
  section: AnalyticsSectionId;
  /** The cohort window in force: 30, 90, or null for all time. */
  days: number | null;
}): string {
  // Composed against an EMPTY query string, not the current one — the sibling
  // idiom in usePipelineSavedViews.copyViewLink. A shared link carries the view and
  // nothing else: no candidate selection, no stale board filter the recipient would
  // inherit without anyone choosing to send it. `win` is omitted for the all-time
  // view (buildUrl drops a null), because an absent window IS all time and writing
  // it out would invent a state the switcher does not have.
  const href = buildUrl({ tab: "analytics", sec: section, win: days ? String(days) : null }, "");
  return `${origin.replace(/\/+$/, "")}${href}`;
}
