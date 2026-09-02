// The write actions (run lifecycle / approve lifecycle / publish / source) + their
// shared error surfacing, split out of DevTab.tsx.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useErrorMessage } from "@/app/_lib/use-error-message";

/** The write actions this hook can run. An ID, not a label: the banner it lands in
 *  is read by a recruiter in one of four languages, so the name of the action is
 *  looked up in `devcase.studio.action.*` at render time rather than being an
 *  English string threaded through the call. */
export type DevAction = "runLifecycle" | "approve" | "publish" | "source";

export function useDevTabActions(args: {
  buildNeed: () => Record<string, unknown>;
  loadLifecycles: () => void;
  loadPostings: () => void;
}) {
  const { buildNeed, loadLifecycles, loadPostings } = args;
  const t = useTranslations("devcase.studio");
  const errorMessage = useErrorMessage();

  // In-flight publish guard: `published` only becomes true after the postings reload,
  // so without this the Publish button stays clickable mid-request and a double-click
  // mints duplicate postings + apply tokens.
  const [publishingCase, setPublishingCase] = useState<string | null>(null);
  // In-flight guard for "Run automated lifecycle": lifecycleActive only flips true once
  // the task appears in the tasks poll, so without this a double-click in the gap fires
  // two lifecycle runs.
  const [runningLifecycle, setRunningLifecycle] = useState(false);
  const [sourcedCounts, setSourcedCounts] = useState<Record<string, number>>({});
  const [sourcing, setSourcing] = useState<string | null>(null);
  // The write actions below previously swallowed every error, so a failed publish /
  // approve / source / lifecycle-run looked identical to a click that did nothing.
  const [actionError, setActionError] = useState<string | null>(null);

  // Shared error surfacing for the write actions: surface a failed/non-OK POST as a
  // banner instead of silently no-op'ing. Returns true on success so callers can chain.
  const runAction = async (
    action: DevAction,
    fetcher: () => Promise<Response>,
    onOk?: (body: unknown) => void
  ): Promise<boolean> => {
    setActionError(null);
    const name = t(`action.${action}`);
    try {
      const r = await fetcher();
      const body = await r.json().catch(() => null);
      if (!r.ok) {
        // The server's `error` string is canonical English written for the log; the
        // reader gets the machine `code` resolved in their own language, and the
        // localized action sentence when the code is unknown (use-error-message.ts).
        setActionError(errorMessage(body as { code?: string | null } | null, t("actionFailed", { action: name })));
        return false;
      }
      onOk?.(body);
      return true;
    } catch {
      setActionError(t("actionUnreachable", { action: name }));
      return false;
    }
  };

  const runLifecycle = async () => {
    if (runningLifecycle) return; // single-flight: no double-launch in the pre-poll gap
    setRunningLifecycle(true);
    try {
      const ok = await runAction("runLifecycle", () =>
        fetch("/api/devcase/lifecycle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ need: buildNeed(), auto: true }),
        })
      );
      if (ok) loadLifecycles();
    } finally {
      setRunningLifecycle(false);
    }
  };

  const approveLifecycle = async (id: string) => {
    const ok = await runAction("approve", () => fetch(`/api/devcase/lifecycle/${id}/approve`, { method: "POST" }));
    if (ok) loadLifecycles();
  };

  const publish = async (caseId: string) => {
    if (publishingCase) return; // single-flight: a double-click can't mint duplicate postings
    setPublishingCase(caseId);
    try {
      const ok = await runAction("publish", () =>
        fetch("/api/devcase/publish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ caseId }),
        })
      );
      if (ok) loadPostings();
    } finally {
      setPublishingCase(null);
    }
  };

  const source = async (caseId: string) => {
    // single-flight, the same reason publish has one: sourcing ranks the candidate DB
    // and WRITES pipeline entries, and `sourcing` only pins the button for the id it
    // was clicked on — so a second click on a different row (or the same one, before
    // the fetch settles) seeded the pipeline twice. This was the one write action on
    // the tab without the guard.
    if (sourcing) return;
    setSourcing(caseId);
    try {
      await runAction(
        "source",
        () =>
          fetch("/api/devcase/source", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ caseId }),
          }),
        (body) => {
          const added = body && typeof body === "object" && "added" in body ? Number((body as { added: unknown }).added) : 0;
          setSourcedCounts((s) => ({ ...s, [caseId]: added }));
        }
      );
    } finally {
      setSourcing(null);
    }
  };

  return {
    runAction,
    runLifecycle, runningLifecycle,
    approveLifecycle,
    publish, publishingCase,
    source, sourcing, sourcedCounts,
    actionError, setActionError,
  };
}
