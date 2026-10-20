"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { NextAction } from "./agentsWorkforceLogic";

export type HireNote = { tone: "ok" | "quiet" | "bad"; text: string };

/**
 * The two controls a hire's move can put on its card, with the answers the roster has always given them.
 * `refresh` polls Personas (the pull fallback): the route answers with a TYPED non-continuation, never a
 * bare 200 (`refreshed:false` plus either a `reason`, or the unchanged `personasStatus`), and an error
 * resolves from its machine `code`, never from the server's English prose (use-error-message.ts).
 * `redispatch` mints a NEW hire from the dead one's origin through POST /api/agents/dispatch, which owns
 * idempotency (a live hire for the same job or intake comes back `existing`) and every refusal.
 *
 * One instance per surface: the busy flags and the notes outlive a level (a note written on a card must
 * still be there when the reader walks back to the drawer).
 */
export function useHireControl(onChanged: () => void) {
  const t = useTranslations("agentsWorkforce");
  const errorMessage = useErrorMessage();
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [notes, setNotes] = useState<Readonly<Record<string, HireNote>>>({});

  const mark = useCallback((id: string, on: boolean) => {
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const note = useCallback((id: string, n: HireNote | null) => {
    setNotes((prev) => {
      const next = { ...prev };
      if (n) next[id] = n;
      else delete next[id];
      return next;
    });
  }, []);

  const refresh = useCallback(
    async (id: string) => {
      mark(id, true);
      note(id, null);
      try {
        const r = await fetch(`/api/agents/${encodeURIComponent(id)}/refresh`, { method: "POST" });
        const body = (await r.json().catch(() => null)) as
          | { refreshed?: boolean; reason?: string; personasStatus?: string; error?: string; code?: string }
          | null;
        if (!r.ok) {
          note(id, { tone: "bad", text: errorMessage(body, t("detail.refreshFailed")) });
          return;
        }
        if (body?.refreshed) {
          note(id, { tone: "ok", text: t("detail.refreshUpdated", { status: body.personasStatus ?? "" }) });
          // Only a real transition is worth a roster refetch: the route writes nothing on the other branches.
          onChanged();
          return;
        }
        note(
          id,
          body?.reason
            ? { tone: "bad", text: errorMessage(body, t("detail.refreshUnpollable")) }
            : { tone: "quiet", text: t("detail.refreshUnchanged", { status: body?.personasStatus ?? "" }) },
        );
      } catch {
        // A rejected fetch (offline, server restarting) is a failed refresh, said so.
        note(id, { tone: "bad", text: t("detail.refreshFailed") });
      } finally {
        mark(id, false);
      }
    },
    [errorMessage, mark, note, onChanged, t],
  );

  const redispatch = useCallback(
    async (id: string, move: Extract<NextAction, { kind: "redispatch" }>) => {
      mark(id, true);
      note(id, null);
      try {
        const r = await fetch("/api/agents/dispatch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(move.target),
        });
        const body = (await r.json().catch(() => null)) as { existing?: boolean; error?: string; code?: string } | null;
        if (!r.ok) {
          note(id, { tone: "bad", text: errorMessage(body, t("nextAction.redispatchFailed")) });
          return;
        }
        note(id, body?.existing ? { tone: "quiet", text: t("nextAction.redispatchExisting") } : { tone: "ok", text: t("nextAction.redispatchDone") });
        onChanged();
      } catch {
        note(id, { tone: "bad", text: t("nextAction.redispatchFailed") });
      } finally {
        mark(id, false);
      }
    },
    [errorMessage, mark, note, onChanged, t],
  );

  return { busy, notes, refresh, redispatch };
}

export type HireControl = ReturnType<typeof useHireControl>;
