"use client";

import { Component, createElement as h, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { reportBoundaryError } from "@/app/_lib/sentry-client";
import { useErrorMessage, type ErrorMessageResolver } from "@/app/_lib/use-error-message";

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
export type BoundaryMessages = {
  title: string;
  body: string;
  retry: string;
  report: string;
  reporting: string;
  reportSent: string;
  reportFailed: string;
};

type Props = {
  children: ReactNode;
  /** Localized copy for the fallback. Required — a default would be English, which
   *  is exactly the leak this closes. Use `TranslatedErrorBoundary` below unless the
   *  host already holds a translator. */
  messages: BoundaryMessages;
  label: BoundaryLabel;
  resolveReportError: ErrorMessageResolver;
  /**
   * When this value changes, any caught error is cleared and the children are
   * re-rendered. The workspace passes the active tab id so switching tabs gives
   * the destination a clean render instead of inheriting the prior tab's
   * fallback. Follows the `resetKeys` pattern from `react-error-boundary`.
   */
  resetKey?: unknown;
};

type State = { error: Error | null; report: "idle" | "busy" | "sent"; reportError: string | null };

// React only supports error boundaries through the class lifecycle
// (getDerivedStateFromError / componentDidCatch), so this stays a class
// component. It catches render-time exceptions in its subtree — e.g. a
// shape-drifted analytics payload or an empty coverage list — so the failure
// blanks just this panel with a recoverable fallback instead of taking down the
// whole workspace shell (sidebar nav, simulation bar, the lot).
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, report: "idle", reportError: null };
  private reportEpoch = 0;

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidUpdate(prev: Props): void {
    // A tab switch changes resetKey; drop the captured error so the new tab
    // renders fresh rather than showing the previous tab's fallback.
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.reportEpoch++;
      this.setState({ error: null, report: "idle", reportError: null });
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

  private reset = (): void => {
    this.reportEpoch++;
    this.setState({ error: null, report: "idle", reportError: null });
  };

  private sendReport = async (): Promise<void> => {
    if (this.state.report !== "idle") return;
    const reportEpoch = this.reportEpoch;
    this.setState({ report: "busy", reportError: null });
    // The thrown message may contain private data. A panel has no server digest,
    // so send only its location and the closed-vocabulary panel label.
    const digest = (this.state.error as Error & { digest?: string }).digest;
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `Workspace ${this.props.label} crash${digest ? ` digest=${digest}` : ""}`,
          route: window.location.pathname,
        }),
      });
      if (reportEpoch !== this.reportEpoch) return;
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { code?: string } | null;
        this.setState({ report: "idle", reportError: this.props.resolveReportError(payload, this.props.messages.reportFailed) });
        return;
      }
      this.setState({ report: "sent", reportError: null });
    } catch {
      if (reportEpoch !== this.reportEpoch) return;
      this.setState({ report: "idle", reportError: this.props.messages.reportFailed });
    }
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    const { title, body, retry, report, reporting, reportSent } = this.props.messages;
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
      h("div", { className: "mt-4 flex flex-wrap items-center justify-center gap-3" },
        h("button", {
          type: "button",
          onClick: this.reset,
          className: "focus-ring inline-flex h-9 items-center gap-2 rounded-md bg-coral px-4 text-sm font-semibold text-white hover:opacity-90",
        }, h(RotateCcw, { size: 14, "aria-hidden": true }), retry),
        h("button", {
          type: "button",
          onClick: () => void this.sendReport(),
          disabled: this.state.report !== "idle",
          className: "focus-ring inline-flex h-9 items-center rounded-md border border-steel/30 px-4 text-sm font-semibold text-ink disabled:opacity-50",
        }, this.state.report === "busy" ? reporting : report)
      ),
      this.state.reportError ? h("p", { role: "alert", className: "mt-3 text-sm text-coral" }, this.state.reportError) : null,
      this.state.report === "sent" ? h("p", { role: "status", className: "mt-3 text-sm text-ink" }, reportSent) : null
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
  const resilience = useTranslations("resilience");
  const resolveReportError = useErrorMessage();
  return h(ErrorBoundary, {
    resetKey,
    label,
    resolveReportError,
    messages: {
      title: t("title"), body: t("body", { what: t(LABEL_KEY[label]) }), retry: t("retry"),
      report: resilience("report"), reporting: resilience("reporting"),
      reportSent: resilience("reportSent"), reportFailed: resilience("reportFailed"),
    },
    children,
  });
}
