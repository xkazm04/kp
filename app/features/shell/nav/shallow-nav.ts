"use client";

// Same-document URL patching for the query state that drives the whole workspace.
//
// WHY THIS EXISTS. The studio is ONE route: `/` plus query params (?tab=, ?q=,
// ?quick=, ?profile=, ?job=…). Routing every one of those through
// router.push/replace makes each tab switch, quick-filter chip and drawer open a
// SERVER navigation — and `/` is `instant = false` (it awaits searchParams and
// reads cookies for the entry + first-run gates), so Next re-fetches and
// re-reconciles the entire RSC payload of a page whose SERVER output does not
// depend on any of those params. Measured against the dev server on 2026-08-05:
// ~358 KB per tab switch, byte-for-byte the same for `?tab=channels` and
// `?tab=decisions`, because the payload is dominated by the ~412 KB next-intl
// catalog `app/layout.tsx` hands to NextIntlClientProvider. The board's
// filter→URL write-back paid that toll again on every chip click and every
// debounced search keystroke.
//
// `window.history.pushState` / `replaceState` are PATCHED by the App Router
// (see the useEffect in next/dist/client/components/app-router.js): they dispatch
// ACTION_RESTORE, which updates the router's canonical URL — so `usePathname` and
// `useSearchParams` re-render with the new value — with NO RSC request, and they
// copy Next's internal history state onto the new entry so the router's own
// popstate handler still drives Back/Forward. `tabs.ts` used to claim the
// opposite; that was true of an earlier canary, not of 16.3.
//
// A URL that changes the pathname genuinely needs the server, so this falls back
// to the router automatically — call sites don't have to know which kind they hold.

import { useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * Can `url` be reached by patching the current document's URL, or does it need a
 * real navigation? True only for an in-app URL that keeps the current pathname:
 * a bare `?…`/`#…` patch, or an absolute-path URL whose path half already matches.
 *
 * Pure (no DOM, no router) so the rule is unit-testable — the whole safety of the
 * shallow path rests on it.
 */
export function isSameDocumentUrl(url: string, currentPathname: string): boolean {
  // A scheme (`https:`, `mailto:`) or a protocol-relative host leaves the app.
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(url) || url.startsWith("//")) return false;
  // A query- or hash-only patch is by definition the same document.
  if (url.startsWith("?") || url.startsWith("#")) return true;
  // Anything else must be an absolute in-app path; a relative one ("jobs?x=1")
  // resolves against the current directory, which we deliberately don't model.
  if (!url.startsWith("/")) return false;
  const path = url.split("?")[0].split("#")[0];
  return path === currentPathname;
}

export type ShellNavigate = {
  /** Adds a history entry — the in-shell move a user expects Back to undo. */
  push: (url: string) => void;
  /** Rewrites the current entry — view state (filters, sort) that shouldn't spam history. */
  replace: (url: string) => void;
};

/**
 * The in-shell navigator: same-document URLs are patched onto the history stack
 * directly, everything else falls through to the App Router.
 *
 * `scroll: false` on the fallback matches the shallow path (patching a URL never
 * scrolls). Tab switches still land at the top of the page because Workspace
 * moves focus to the `<main>` landmark on a real tab change, which scrolls it
 * into view — a11y and scroll restoration through the same door.
 */
export function useShellNavigate(): ShellNavigate {
  const router = useRouter();
  const pathname = usePathname();
  return useMemo(() => {
    const shallow = (url: string, kind: "push" | "replace"): boolean => {
      if (typeof window === "undefined" || !isSameDocumentUrl(url, pathname)) return false;
      // `null` state: the patch copies Next's internal history state for us.
      if (kind === "push") window.history.pushState(null, "", url);
      else window.history.replaceState(null, "", url);
      return true;
    };
    return {
      push: (url) => {
        if (!shallow(url, "push")) router.push(url, { scroll: false });
      },
      replace: (url) => {
        if (!shallow(url, "replace")) router.replace(url, { scroll: false });
      },
    };
  }, [router, pathname]);
}
