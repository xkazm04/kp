"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { RoleRunGateBatch, RoleRunView } from "@/app/api/role-runs/[id]/view";
import {
  advanceRoleRun,
  commitGateBatch,
  loadRoleRunForJob,
  previewGateBatch,
  startRoleRun,
  type BatchPreview,
  type PanelRefusal,
  type PanelResult,
} from "./roleRunPanelClient";

// State for the job page's role-run panel. Every call is a function of roleRunPanelClient.ts;
// this hook only holds the answer, the one in-flight action and the refusal CODE it resolves
// into the reader's language (useErrorMessage), never the server's message.

type Busy = "start" | "advance" | `preview:${string}` | `commit:${string}` | null;

// `window.fetch` called bare would lose its receiver; the panel always talks to its own origin.
const browserFetch = (input: string, init?: RequestInit) => fetch(input, init);

export function useRoleRunPanel(jobId: string) {
  const t = useTranslations("roleRun");
  const errorMessage = useErrorMessage();
  const [view, setView] = useState<RoleRunView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Busy>(null);
  const [refusal, setRefusal] = useState<PanelRefusal | null>(null);
  const [previews, setPreviews] = useState<Partial<Record<RoleRunGateBatch["gate"], BatchPreview[]>>>({});

  const settle = useCallback((res: PanelResult<RoleRunView | null>) => {
    if (res.ok) {
      setView(res.value);
      setRefusal(null);
    } else {
      setRefusal(res.refusal);
    }
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    settle(await loadRoleRunForJob(browserFetch, jobId));
    setLoading(false);
  }, [jobId, settle]);

  // The first read: `loading` starts true, so the effect only settles state after the await.
  useEffect(() => {
    let live = true;
    void loadRoleRunForJob(browserFetch, jobId).then((res) => {
      if (!live) return;
      settle(res);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [jobId, settle]);

  const start = useCallback(async () => {
    setBusy("start");
    settle(await startRoleRun(browserFetch, jobId));
    setPreviews({});
    setBusy(null);
  }, [jobId, settle]);

  const advance = useCallback(async () => {
    if (!view) return;
    setBusy("advance");
    settle(await advanceRoleRun(browserFetch, view.run.id));
    setBusy(null);
  }, [view, settle]);

  const preview = useCallback(
    async (batch: RoleRunGateBatch) => {
      if (!view) return;
      setBusy(`preview:${batch.gate}`);
      const res = await previewGateBatch(browserFetch, view.run.id, batch);
      if (res.ok) {
        setPreviews((p) => ({ ...p, [batch.gate]: res.value }));
        setRefusal(null);
      } else {
        setRefusal(res.refusal);
      }
      setBusy(null);
    },
    [view]
  );

  /** Resolve the batch, then re-read the run: the commit already took the next pass. */
  const decide = useCallback(
    async (batch: RoleRunGateBatch, decision: "approved" | "declined") => {
      if (!view) return;
      setBusy(`commit:${batch.gate}`);
      const out = await commitGateBatch(browserFetch, view.run.id, batch, decision);
      const fresh = await loadRoleRunForJob(browserFetch, jobId);
      settle(fresh);
      // A refusal outranks the reload's success: it is the thing the recruiter must act on.
      if (out.refusal) setRefusal(out.refusal);
      setPreviews((p) => ({ ...p, [batch.gate]: undefined }));
      setBusy(null);
    },
    [view, jobId, settle]
  );

  const refusalText = refusal ? errorMessage({ code: refusal.code }, t("failed")) : null;

  return { t, view, loading, busy, refusalText, previews, reload, start, advance, preview, decide };
}
