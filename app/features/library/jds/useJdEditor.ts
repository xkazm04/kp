"use client";

import { useCallback, useEffect, useState } from "react";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import {
  classifyJdWriteResponse,
  jdEditPayload,
  jdRevertPayload,
  type JdRevision,
} from "./jdsEditClient";

// The localized strings the hook needs for its error / gate / conflict states.
// Each surface supplies them from its OWN i18n namespace (the public page's
// `jdPublic.*`, the ledger's `library.tab.*`) so the copy reads native to where
// the editor lives — the hook stays namespace-agnostic.
export type JdEditorCopy = {
  gateReason: string;
  conflict: string;
  saveError: string;
  revertError: string;
};

// The ONE edit client behind both JD editors: fetch + baseBody CAS + the 401
// operator gate latch + the 409 conflict path + the /revisions load & revert.
// Owns the async/state machinery; each caller renders its own markup + i18n and
// wires the post-success side effect (the ledger closes the modal & refreshes;
// the public page stays in place, reloads revisions, and router.refresh()es).
export function useJdEditor({
  slug,
  baseBody,
  copy,
  initialHistoryOpen = false,
  onSaved,
  onReverted,
}: {
  slug: string;
  // The body the editor loaded — the CAS base for every write from this session.
  baseBody: string;
  copy: JdEditorCopy;
  // Start with the revision history open (and fetch it on mount). Default false —
  // only the ledger's held-build deep link opens straight into it.
  initialHistoryOpen?: boolean;
  // Called after a save the server accepted.
  onSaved: () => void;
  // Called after a revert the server accepted (the caller decides whether to
  // reload the revision list — the ledger unmounts the editor, the public page
  // reloads it in place).
  onReverted: () => void;
}) {
  // The caller supplies the localized copy; the SERVER's failures resolve from the
  // machine `code` through the shared `errors` catalog — never from the English
  // `error` string the routes keep for API consumers.
  const errMsg = useErrorMessage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  // Latched by a 401 — the honest operator gate. Once true the controls stay
  // disabled carrying the reason, never a silently-refailing button.
  const [gateBlocked, setGateBlocked] = useState(false);

  const [historyOpen, setHistoryOpen] = useState(initialHistoryOpen);
  const [revisions, setRevisions] = useState<JdRevision[] | null>(null);
  const [revLoading, setRevLoading] = useState(false);
  const [reverting, setReverting] = useState<number | null>(null);

  const loadRevisions = useCallback(async () => {
    setRevLoading(true);
    try {
      const p = (await fetch(`/api/jds/${encodeURIComponent(slug)}/revisions`).then((r) => r.json())) as {
        revisions?: JdRevision[];
      };
      setRevisions(p.revisions ?? []);
    } catch {
      setRevisions([]);
    } finally {
      setRevLoading(false);
    }
  }, [slug]);

  // Deep-opened history still has to FETCH — toggleHistory is what normally
  // triggers the load, and it is never called on this path. Deferred kickoff (no
  // synchronous setState in an effect body), the same shape jdsHooks uses.
  useEffect(() => {
    if (!initialHistoryOpen) return;
    const timer = window.setTimeout(() => void loadRevisions(), 0);
    return () => window.clearTimeout(timer);
  }, [initialHistoryOpen, loadRevisions]);

  const toggleHistory = useCallback(() => {
    setHistoryOpen((open) => {
      const next = !open;
      if (next && revisions === null && !revLoading) void loadRevisions();
      return next;
    });
  }, [revisions, revLoading, loadRevisions]);

  const save = useCallback(
    async (title: string, body: string) => {
      setBusy(true);
      setError(null);
      setConflict(false);
      try {
        const r = await fetch(`/api/jds/${encodeURIComponent(slug)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          // Content-CAS: send the body we loaded so a concurrent edit 409s rather
          // than being silently clobbered.
          body: JSON.stringify(jdEditPayload(title, body, baseBody)),
        });
        const p = (await r.json().catch(() => null)) as { error?: string; code?: string } | null;
        switch (classifyJdWriteResponse(r.status, p)) {
          case "gate":
            setGateBlocked(true);
            setError(copy.gateReason);
            return;
          case "conflict":
            setConflict(true);
            setError(copy.conflict);
            return;
          case "error":
            throw new Error(errMsg(p, copy.saveError));
          default:
            onSaved();
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : copy.saveError);
      } finally {
        setBusy(false);
      }
    },
    [slug, baseBody, copy, onSaved]
  );

  const revert = useCallback(
    async (id: number) => {
      setReverting(id);
      setError(null);
      setConflict(false);
      try {
        const r = await fetch(`/api/jds/${encodeURIComponent(slug)}/revisions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Send the body we loaded so a revert can't bury an edit made meanwhile.
          body: JSON.stringify(jdRevertPayload(id, baseBody)),
        });
        const p = (await r.json().catch(() => null)) as { error?: string; code?: string } | null;
        switch (classifyJdWriteResponse(r.status, p)) {
          case "gate":
            setGateBlocked(true);
            setError(copy.gateReason);
            return;
          case "conflict":
            setConflict(true);
            setError(copy.conflict);
            return;
          case "error":
            throw new Error(errMsg(p, copy.revertError));
          default:
            onReverted();
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : copy.revertError);
      } finally {
        setReverting(null);
      }
    },
    [slug, baseBody, copy, onReverted]
  );

  return {
    busy,
    error,
    conflict,
    gateBlocked,
    historyOpen,
    revisions,
    revLoading,
    reverting,
    setError,
    loadRevisions,
    toggleHistory,
    save,
    revert,
  };
}
