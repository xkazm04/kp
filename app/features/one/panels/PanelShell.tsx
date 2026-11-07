"use client";

// The frame every /one panel renders in: a kit Section (serif head, numeral count, one
// state line, the quiet loading line, the critical note with a retry) wrapped in ONE
// element that carries the layout hooks (`data-look`, `className`) and the panel's
// identity (`data-one-panel`, `data-panel-id`) for the variants and for tests.
//
// The error text is resolved from the read's CODE through useErrorMessage(), falling back
// to the localized "could not load" line — the server's English `error` never renders.
import Link from "next/link";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Section } from "@/app/_components/kit";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { buildUrl, clearedTabScopedParams, type WorkspaceTabId } from "@/app/features/shell/tabs";
import type { Read } from "./read";
import type { PanelProps } from "./types";

/** A Console deep link: the tab plus its scoped params, from a clean query (/one's own
 *  `?v=` must never leak into the workspace). */
export function consoleHref(tab: WorkspaceTabId, params: Record<string, string> = {}): string {
  return buildUrl({ ...clearedTabScopedParams(), tab, ...params }, "");
}

export function ConsoleLink({ tab, params, label }: { tab: WorkspaceTabId; params?: Record<string, string>; label?: string }) {
  const t = useTranslations("one.core.panels");
  return (
    <Link className="k-btn k-btn--link k-btn--sm" href={consoleHref(tab, params)} data-role="one-console-link">
      {label ?? t("openInConsole")}
    </Link>
  );
}

export function PanelShell<T>({
  props,
  title,
  count,
  state,
  read,
  console: consoleTarget,
  children,
}: {
  props: PanelProps;
  title: string;
  count?: ReactNode;
  state?: string;
  read: Read<T> & { retry: () => void };
  console?: { tab: WorkspaceTabId; params?: Record<string, string> };
  children?: ReactNode;
}) {
  const t = useTranslations("one.core.panels");
  const errMsg = useErrorMessage();
  const { panel, look = "default", className, chrome } = props;
  return (
    <div
      className={className}
      data-one-panel={panel.kind}
      data-panel-id={panel.id}
      data-look={look}
      data-pinned={panel.pinned ? "true" : undefined}
    >
      <Section
        title={title}
        count={count}
        state={state}
        status={read.state === "loading" ? "loading" : read.state === "error" ? "error" : "ready"}
        errorText={read.state === "error" ? errMsg(read.payload, t("loadFailed")) : undefined}
        onRetry={read.retry}
        actions={
          <>
            {consoleTarget ? <ConsoleLink tab={consoleTarget.tab} params={consoleTarget.params} /> : null}
            {chrome}
          </>
        }
      >
        {children}
      </Section>
    </div>
  );
}

/** The stated empty state: a real sentence on the measure, never a blank body. */
export function EmptyLine({ children }: { children: ReactNode }) {
  return (
    <p className="k-section__placeholder" data-role="one-empty">
      {children}
    </p>
  );
}
