"use client";

import { Component, createElement as h, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { reportBoundaryError } from "@/app/_lib/sentry-client";

// JSX-free (hence `.ts`, hence `createElement`) ON PURPOSE: `node --test` strips
// types but cannot compile JSX, so a `.tsx` boundary is a component the unit gate
// structurally cannot load — and this one had no test of any kind while being the
// surface a reader meets when a tab dies. The markup below is ~15 elements; paying
// `h(...)` for them buys a test that renders the real fallback and asserts the real
// strings. (The same trade the tasks dock made by splitting its reducer out.)

/** The three strings the fallback renders. Handed in rather than baked in: this is
 *  a CLASS component (React only supports error boundaries through the class
 *  lifecycle), so it cannot call useTranslations itself — and until it took them as
 *  a prop, the one surface a Czech recruiter meets when a tab fails was the only
 *  shell copy outside the catalogs. */
export type BoundaryMessages = { title: string; body: string; retry: string };

type Props = {
  children: ReactNode;
  /** Localized copy for the fallback. Required — a default would be English, which
   *  is exactly the leak this closes. Use `TranslatedErrorBoundary` below unless the
   *  host already holds a translator. */
  messages: BoundaryMessages;
  /**
   * When this value changes, any caught error is cleared and the children are
   * re-rendered. The workspace passes the active tab id so switching tabs gives
   * the destination a clean render instead of inheriting the prior tab's
   * fallback. Follows the `resetKeys` pattern from `react-error-boundary`.
   */
  resetKey?: unknown;
};

type State = { error: Error | null };

// React only supports error boundaries through the class lifecycle
// (getDerivedStateFromError / componentDidCatch), so this stays a class
// component. It catches render-time exceptions in its subtree — e.g. a
// shape-drifted analytics payload or an empty coverage list — so the failure
// blanks just this panel with a recoverable fallback instead of taking down the
// whole workspace shell (sidebar nav, simulation bar, the lot).
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: Props): void {
    // A tab switch changes resetKey; drop the captured error so the new tab
    // renders fresh rather than showing the previous tab's fallback.
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error): void {
    // The console keeps the stack for local diagnosis. The Sentry report is
    // DSN-gated and no-ops entirely on the default local-first deploy
    // (app/_lib/sentry-client.ts) — the SAME call the route-level fallback makes
    // (app/_components/RouteError.tsx). Without it a crash inside a workspace
    // panel reached only the operator's own browser console, so a deploy that HAS
    // a sink configured saw route crashes but never subtree ones — the boundary
    // was the quietest place in the app to fail.
    console.error("Panel render failed:", error);
    reportBoundaryError(error);
  }

  private reset = (): void => this.setState({ error: null });

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    const { title, body, retry } = this.props.messages;
    return h(
      "div",
      {
        role: "alert",
        className: "rounded-lg border border-amber-200 bg-amber-50/70 p-6 text-center shadow-panel",
      },
      h(AlertTriangle, { size: 22, className: "mx-auto text-amber-600", "aria-hidden": true }),
      h("h2", { className: "mt-3 font-serif text-h2 text-ink" }, title),
      // The thrown message never reaches the reader — it is a stack trace's first
      // line, not copy, and on a 4-locale product it would be English.
      h("p", { className: "mx-auto mt-1 max-w-md text-body text-steel" }, body),
      h(
        "button",
        {
          type: "button",
          onClick: this.reset,
          className:
            "focus-ring mt-4 inline-flex h-9 items-center gap-2 rounded-md bg-coral px-4 text-sm font-semibold text-white hover:opacity-90",
        },
        h(RotateCcw, { size: 14, "aria-hidden": true }),
        retry
      )
    );
  }
}

/** What broke, phrased to drop into "… couldn't be displayed." A closed vocabulary
 *  (literal array + derived union) so a caller names a CATALOG KEY, never a string. */
export const BOUNDARY_LABELS = ["tab", "panel"] as const;
export type BoundaryLabel = (typeof BOUNDARY_LABELS)[number];

// Mapped to full literal keys so next-intl's typed lookup stays exact.
const LABEL_KEY = { tab: "labels.tab", panel: "labels.panel" } as const;

/**
 * The boundary with its copy resolved from the `errorBoundary` catalog. A function
 * component wrapping the class is the cheapest seam that holds the rule "every
 * user-facing string goes through next-intl" without pretending a class can call a
 * hook — the alternative (threading a translator down from every host) would put
 * the same three lookups at every call site.
 */
export function TranslatedErrorBoundary({
  label = "panel",
  resetKey,
  children,
}: {
  label?: BoundaryLabel;
  resetKey?: unknown;
  children: ReactNode;
}) {
  const t = useTranslations("errorBoundary");
  return h(ErrorBoundary, {
    resetKey,
    messages: { title: t("title"), body: t("body", { what: t(LABEL_KEY[label]) }), retry: t("retry") },
    children,
  });
}
