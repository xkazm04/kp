"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { PartState, RowTone } from "./types";
import { Measure } from "./Measure";
import { Mark } from "./Mark";
import { Button } from "./Button";
import "./kit.css";

/**
 * @catalog A section: serif head with a numeral count, one state line and actions, bounded by ONE rule (hairline ink in Studio Light, a sticker panel in Spark Dark). Loading is a quiet line after 400ms; error is a critical note with a retry.
 */
export function Section({
  title, count, state, stateMark, tone = "default", actions, status = "ready", loadingText, errorText, onRetry, id, children,
}: {
  title: string;
  count?: ReactNode;
  /** One line; its full text is also the tip, so an ellipsis never hides it. */
  state?: string;
  /** Drawn on the state line before `state`; renders on its own too (a legend needs no sentence). */
  stateMark?: ReactNode;
  tone?: RowTone;
  actions?: ReactNode;
  status?: PartState;
  loadingText?: string;
  errorText?: string;
  onRetry?: () => void;
  id?: string;
  children?: ReactNode;
}) {
  const tc = useTranslations("common");
  const toneCls = tone === "default" ? "" : ` k-section--${tone}`;
  return (
    <section className={`k-section${toneCls}`} id={id} data-part="section">
      <Measure className="k-section__head" data-role="kit-section-head">
        <div className="k-section__title">
          <h3 data-role="kit-section-title">{title}</h3>
          {count != null ? <span className="k-section__count" data-role="kit-section-count">{count}</span> : null}
        </div>
        {state || stateMark ? (
          <div className="k-section__state">
            {stateMark}
            {state ? <span data-tip={state} tabIndex={0}>{state}</span> : null}
          </div>
        ) : null}
        <div className="k-section__acts">{actions}</div>
      </Measure>
      <div className="k-section__body">
        {status === "loading" ? (
          <div className="k-section__placeholder" role="status">{loadingText ?? tc("loading")}</div>
        ) : status === "error" ? (
          <Note tone="critical" action={onRetry ? <Button label={tc("retry")} variant="ghost" size="sm" onClick={onRetry} /> : null}>
            {errorText}
          </Note>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

/**
 * @catalog A full-width notice line inside a section (critical or caution), its mark hung in the mark track.
 */
export function Note({ tone, children, action }: { tone: "critical" | "caution"; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={`k-note k-note--${tone}`} role={tone === "critical" ? "alert" : "status"}>
      <Mark kind={tone === "critical" ? "fail" : "caution"} />
      <span>{children}</span>
      {action}
    </div>
  );
}
