// The write actions (run lifecycle / approve lifecycle / publish / source) + their
// shared error surfacing, split out of DevTab.tsx.
import { useState } from "react";

export function useDevTabActions(args: {
  buildNeed: () => Record<string, unknown>;
  loadLifecycles: () => void;
  loadPostings: () => void;
}) {
  const { buildNeed, loadLifecycles, loadPostings } = args;

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
    label: string,
    fetcher: () => Promise<Response>,
    onOk?: (body: unknown) => void
  ): Promise<boolean> => {
    setActionError(null);
    try {
      const r = await fetcher();
      const body = await r.json().catch(() => null);
      if (!r.ok) {
        const msg = body && typeof body === "object" && "error" in body ? String((body as { error: unknown }).error) : null;
        setActionError(msg ?? `${label} failed. Please try again.`);
        return false;
      }
      onOk?.(body);
      return true;
    } catch {
      setActionError(`${label} failed — the request could not be completed.`);
      return false;
    }
  };

  const runLifecycle = async () => {
    if (runningLifecycle) return; // single-flight: no double-launch in the pre-poll gap
    setRunningLifecycle(true);
    try {
      const ok = await runAction("Run lifecycle", () =>
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
    const ok = await runAction("Approve", () => fetch(`/api/devcase/lifecycle/${id}/approve`, { method: "POST" }));
    if (ok) loadLifecycles();
  };

  const publish = async (caseId: string) => {
    if (publishingCase) return; // single-flight: a double-click can't mint duplicate postings
    setPublishingCase(caseId);
    try {
      const ok = await runAction("Publish", () =>
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
    setSourcing(caseId);
    try {
      await runAction(
        "Source candidates",
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
