"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RoleBrief } from "@/app/_lib/rolespec";

// State + API client for the role-intake dialog surface (Phase 1 of
// docs/concepts/role-intake-dialog.md). Pure fetch/state — rendering lives in
// JdsIntakePanel/JdsIntakeChat/JdsIntakeBriefPanel (200-line rule).

export type IntakeTurn = { role: "interviewer" | "candidate" | "system"; text: string; at?: string };

export type IntakeSummary = {
  id: string;
  title: string;
  status: "open" | "complete" | "promoted";
  shape: "power_unit" | "story" | null;
  jdSlug: string | null;
  jobId: string | null;
  createdAt: string;
  updatedAt: string | null;
  turnCount: number;
};

export type IntakeSession = {
  id: string;
  title: string;
  status: "open" | "complete" | "promoted";
  lang: string | null;
  transcript: IntakeTurn[];
  brief: RoleBrief | null;
  shape: "power_unit" | "story" | null;
  jdSlug: string | null;
};

export function useIntakeLogic(onPromoted?: () => void) {
  const [sessions, setSessions] = useState<IntakeSummary[] | null>(null);
  const [active, setActive] = useState<IntakeSession | null>(null);
  const [sending, setSending] = useState(false);
  const [creating, setCreating] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards a stale exchange response from landing after the user switched sessions.
  const activeIdRef = useRef<string | null>(null);

  const loadList = useCallback(async () => {
    try {
      const res = await fetch("/api/intake");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { intakes: IntakeSummary[] };
      setSessions(data.intakes);
    } catch {
      setSessions([]);
      setError("list");
    }
  }, []);

  useEffect(() => {
    // Deferred a tick (the jdsHooks.ts pattern) so the mount fetch can never
    // set state synchronously inside the effect.
    const timer = window.setTimeout(() => void loadList(), 0);
    return () => window.clearTimeout(timer);
  }, [loadList]);

  const openSession = useCallback(async (id: string) => {
    setError(null);
    activeIdRef.current = id;
    try {
      const res = await fetch(`/api/intake/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as IntakeSession;
      if (activeIdRef.current === id) setActive(data);
    } catch {
      setError("open");
    }
  }, []);

  const startNew = useCallback(async (lang: string) => {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as IntakeSession;
      activeIdRef.current = data.id;
      setActive(data);
      setDegraded(false);
    } catch {
      setError("create");
    } finally {
      setCreating(false);
    }
  }, []);

  const send = useCallback(
    async (message: string) => {
      if (!active || sending || !message.trim()) return;
      const id = active.id;
      setSending(true);
      setError(null);
      // Optimistic: the requestor's line lands immediately; the agent's reply follows.
      setActive((s) => (s && s.id === id ? { ...s, transcript: [...s.transcript, { role: "candidate", text: message }] } : s));
      try {
        const res = await fetch(`/api/intake/${encodeURIComponent(id)}/message`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as {
          reply: string;
          brief: RoleBrief;
          shape: IntakeSession["shape"];
          done: boolean;
          source: "llm" | "deterministic";
        };
        setDegraded(data.source === "deterministic");
        if (activeIdRef.current !== id) return;
        setActive((s) =>
          s && s.id === id
            ? {
                ...s,
                transcript: [...s.transcript, { role: "interviewer", text: data.reply }],
                brief: data.brief,
                shape: data.shape,
                status: data.done ? "complete" : s.status,
                title: data.brief?.title || s.title,
              }
            : s
        );
        if (data.done) void loadList();
      } catch {
        setError("send");
        // Roll back the optimistic line so a retry doesn't double it server-side.
        setActive((s) => (s && s.id === id ? { ...s, transcript: s.transcript.slice(0, -1) } : s));
      } finally {
        setSending(false);
      }
    },
    [active, sending, loadList]
  );

  const promote = useCallback(async (opts?: { caseDesign?: boolean }) => {
    if (!active || promoting) return;
    setPromoting(true);
    setError(null);
    try {
      const res = await fetch(`/api/intake/${encodeURIComponent(active.id)}/promote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // caseDesign (UAT L1-EVA-3): the requestor can have the work-sample case
        // designed from the same brief in the same backgrounded build.
        body: JSON.stringify({ caseDesign: opts?.caseDesign === true }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { slug: string };
      setActive((s) => (s ? { ...s, status: "promoted", jdSlug: data.slug } : s));
      void loadList();
      onPromoted?.();
    } catch {
      setError("promote");
    } finally {
      setPromoting(false);
    }
  }, [active, promoting, loadList, onPromoted]);

  const closeSession = useCallback(() => {
    activeIdRef.current = null;
    setActive(null);
    void loadList();
  }, [loadList]);

  return {
    sessions,
    active,
    sending,
    creating,
    promoting,
    degraded,
    error,
    startNew,
    openSession,
    closeSession,
    send,
    promote,
  };
}
