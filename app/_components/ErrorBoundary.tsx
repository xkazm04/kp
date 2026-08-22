"use client";

import { Component, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { reportBoundaryError } from "@/app/_lib/sentry-client";

type Props = {
  children: ReactNode;
  /**
   * When this value changes, any caught error is cleared and the children are
   * re-rendered. The workspace passes the active tab id so switching tabs gives
   * the destination a clean render instead of inheriting the prior tab's
   * fallback. Follows the `resetKeys` pattern from `react-error-boundary`.
   */
  resetKey?: unknown;
  /** What broke, phrased to drop into "… couldn't be displayed." */
  label?: string;
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
    if (this.state.error) {
      const what = this.props.label ?? "This panel";
      return (
        <div
          role="alert"
          className="rounded-lg border border-amber-200 bg-amber-50/70 p-6 text-center shadow-panel"
        >
          <AlertTriangle size={22} className="mx-auto text-amber-600" aria-hidden />
          <h2 className="mt-3 font-serif text-h2 text-ink">Something went wrong here</h2>
          <p className="mx-auto mt-1 max-w-md text-body text-steel">
            {what} couldn&apos;t be displayed — the data may be in an unexpected shape. The rest of
            the workspace is unaffected.
          </p>
          <button
            type="button"
            onClick={this.reset}
            className="focus-ring mt-4 inline-flex h-9 items-center gap-2 rounded-md bg-coral px-4 text-sm font-semibold text-white hover:opacity-90"
          >
            <RotateCcw size={14} aria-hidden /> Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
