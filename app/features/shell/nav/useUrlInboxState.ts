"use client";

// View state that lives in APP STATE, with the URL demoted to a one-shot inbox.
//
// The studio is one route (`/`) plus query params, and the view-selecting ones
// (`?tab=`, `?sec=`) used to BE the state: every click rewrote the URL and every
// render read it back. That works, but it means the address bar churns on every
// interaction and the render path is coupled to the router.
//
// This inverts it. React state is the source of truth; the URL is read only when
// something ARRIVES in it, and cleared immediately after — so:
//
//   • an incoming deep link (`/?tab=decisions`, a comms email, TasksIndicator,
//     CompletionCta, a shared link) still lands on the right view, because
//     arriving IS the param appearing;
//   • clicking around writes nothing — no query churn, no history spam;
//   • the param cannot go stale, because it never outlives its own arrival. That
//     also fixes a bug the naive version has: leave the URL saying `?tab=x`, and
//     a second in-app link to the SAME `?tab=x` is not a change, so nothing
//     happens and the link looks broken.
//
// THE OBLIGATION THIS PUTS ON LINK BUILDERS (UAT TOM-ANA-1): an in-shell link that
// changes the view must NAME it, including when the destination is the default. An
// ABSENT param is not an arrival and never can be — this hook empties its own inbox,
// so `?tab=decisions` becomes no param one render later; treating that absence as
// "the default arrived" would bounce every deep link straight back to Overview a
// frame after it landed, and would do the same to `?sec=`. That is why the fix for
// the dead Analytics→board links lives in `buildUrl` (which used to delete an
// explicitly requested `tab=pipeline`) and not here.
//
// KNOWN TRADE-OFF, chosen deliberately: with no URL write there is no history
// entry per switch, so Back no longer steps back through tabs — it leaves the
// workspace, which is what `replace` used to do before the code switched to
// `push`. Restoring it means tracking the tab in history STATE rather than the
// query; not done here because the point of this change was to stop touching the
// URL on interaction.

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { buildUrl } from "@/app/features/shell/tabs";
import { useShellNavigate } from "./shallow-nav";

/**
 * @param param  the query key to watch (`"tab"`, `"sec"`).
 * @param parse  raw param → a valid value, or null to ignore it. Owns the
 *               vocabulary (legacy aliases, feature gates) so this stays generic.
 * @param fallback  the value when nothing has ever arrived.
 */
export function useUrlInboxState<T extends string>(
  param: string,
  parse: (raw: string | null) => T | null,
  fallback: T
): [T, (next: T) => void] {
  const search = useSearchParams();
  const nav = useShellNavigate();
  const incoming = search.get(param);

  // Lazy initializer: a COLD load with the param already present must render the
  // right view on the first frame, not flash the fallback and correct itself.
  const [value, setValue] = useState<T>(() => parse(incoming) ?? fallback);

  // Adopt an arrival DURING RENDER, not in an effect — React's documented
  // "adjusting state when a prop changes" pattern. Doing it in an effect would
  // render the stale view once and correct it on the next commit (a visible
  // flash of the wrong tab), and it is what react-hooks/set-state-in-effect
  // exists to catch. Tracking the previous param is what makes this fire once
  // per ARRIVAL rather than on every render.
  const [seen, setSeen] = useState<string | null>(incoming);
  if (incoming !== seen) {
    setSeen(incoming);
    const parsed = parse(incoming);
    if (parsed != null) setValue(parsed);
  }

  useEffect(() => {
    if (incoming == null) return;
    // The effect now does only the genuine side effect: emptying the inbox. An
    // unparseable value is cleared too — leaving `?tab=nonsense` in the bar would
    // make a later valid link to the same key look like a no-op, and the reader
    // has no use for it either way.
    //
    // `replace`, not `push`: the arrival already has its own history entry, and
    // this is a cleanup of that entry rather than a new place to go back to.
    nav.replace(buildUrl({ [param]: null }, search.toString()));
  }, [incoming, param, nav, search]);

  // State only. The one exception a caller may still need (clearing sibling
  // params on a switch) is theirs to do, not this hook's.
  const set = useCallback((next: T) => setValue(next), []);

  return [value, set];
}
