import type { ReactNode } from "react";

// The shell every proof tab's section shares: a white panel with a serif title, an optional
// quiet line under it, and the section's actions on the right (proof/panels/*).

/** A section's white panel: a serif title, an optional quiet line, actions on the right. */
export function Panel({ title, sub, actions, children }: { title: string; sub?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="panel" aria-label={title}>
      <header className="panel-head">
        <div className="panel-title-wrap">
          <h3 className="panel-title">{title}</h3>
          {sub ? <div className="panel-sub">{sub}</div> : null}
        </div>
        {actions ? <div className="panel-acts">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}
