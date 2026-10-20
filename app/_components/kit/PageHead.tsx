"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { Figure, PartState } from "./types";
import { FigureView } from "./FigureView";
import { Button } from "./Button";
import "./kit.css";

/**
 * @catalog The page head: coral eyebrow, display-serif title, one context line, 0-4 figures whose right edge is the time track, actions in the act track (at most one primary). Error turns the context line critical with a retry.
 */
export function PageHead({
  eyebrow, title, context, figures = [], actions, state = "ready", errorText, onRetry, rollingFigure,
}: {
  eyebrow?: string;
  title: string;
  /** One line. */
  context?: ReactNode;
  figures?: Figure[];
  actions?: ReactNode;
  /** loading keeps the chrome and prints every figure as "—"; error replaces the context line. */
  state?: PartState;
  errorText?: string;
  onRetry?: () => void;
  /** Index of a figure that just changed (it rolls in once). */
  rollingFigure?: number;
}) {
  const tc = useTranslations("common");
  const shown = state === "ready" ? figures : figures.map((f) => ({ ...f, value: null }));
  return (
    <header className="k-head" data-part="page-head">
      <div className="k-head__lead">
        {eyebrow ? <div className="k-eyebrow" data-role="kit-eyebrow">{eyebrow}</div> : null}
        <h2 className="k-title" data-role="kit-title">{title}</h2>
        {state === "error" ? (
          <p className="k-context is-critical" role="alert">
            {errorText}
            {onRetry ? <Button label={tc("retry")} variant="secondary" size="sm" onClick={onRetry} /> : null}
          </p>
        ) : context ? (
          <p className="k-context" data-role="kit-context">{context}</p>
        ) : null}
      </div>
      <div className="k-head__figs">
        {shown.map((f, i) => <FigureView key={f.label} figure={f} rolling={i === rollingFigure} />)}
      </div>
      <div className="k-head__acts">{actions}</div>
    </header>
  );
}
