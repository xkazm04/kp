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

export type IntakeAttachment = { kind: "note" | "jd"; title: string; text: string; jdSlug?: string };

export type IntakeSession = {
  id: string;
  title: string;
  status: "open" | "complete" | "promoted";
  lang: string | null;
  transcript: IntakeTurn[];
  brief: RoleBrief | null;
  attachments: IntakeAttachment[];
  shape: "power_unit" | "story" | null;
  jdSlug: string | null;
};

export type VoiceSweepResult = {
  transcript: IntakeTurn[];
  brief: RoleBrief;
  shape: IntakeSession["shape"];
  extracted: boolean;
  source: "llm" | "deterministic";
};

export type VoiceExchangeResult = { userText: string; reply: string; done: boolean; brief?: RoleBrief };

// Both voice threads resolve LONG after they were fired (an extraction sweep is
// a model call; the hang-up sweep runs while the requestor is already reading
// something else). The panel that fired them may be showing a DIFFERENT session
// by then — Back → open another intake — so, exactly like the text plane's
// `activeIdRef` guard, a voice result must name the session it belongs to and
// be dropped when it no longer matches. Without the check the sweep's payload
// (session A's whole transcript AND brief) overwrote whatever was open, and the
// next Save persisted A's requirements onto B. Pure — jdsIntakeLogic.test.ts.

/** Fold a completed extraction sweep into the open session (identity-checked). */
export function foldVoiceSweep(session: IntakeSession | null, intakeId: string, payload: VoiceSweepResult): IntakeSession | null {
  if (!session || session.id !== intakeId) return session;
  return {
    ...session,
    transcript: payload.transcript,
    brief: payload.brief,
    shape: payload.shape,
    title: (payload.extracted && payload.brief?.title) || session.title,
  };
}

/** Append one completed spoken exchange to the open session (identity-checked). */
export function foldVoiceExchange(
  session: IntakeSession | null,
  intakeId: string,
  payload: VoiceExchangeResult
): IntakeSession | null {
  if (!session || session.id !== intakeId) return session;
  return {
    ...session,
    transcript: [
      ...session.transcript,
      { role: "candidate", text: payload.userText },
      { role: "interviewer", text: payload.reply },
    ],
    ...(payload.brief ? { brief: payload.brief, title: payload.brief.title || session.title } : {}),
    ...(payload.done ? { status: "complete" as const } : {}),
  };
}

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

  // Returns whether the exchange actually landed, so the composer can hand the
  // requestor their typed text back when it didn't (429/409/offline) instead of
  // silently destroying a paragraph they'd have to retype.
  const send = useCallback(
    async (message: string): Promise<boolean> => {
      if (!active || sending || !message.trim()) return false;
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
        // Landed server-side, just not on screen any more (the requestor moved
        // to another session) — a success, so the composer must NOT re-offer
        // this text into the session now open.
        if (activeIdRef.current !== id) return true;
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
        return true;
      } catch {
        setError("send");
        // Roll back the optimistic line so a retry doesn't double it server-side.
        setActive((s) => (s && s.id === id ? { ...s, transcript: s.transcript.slice(0, -1) } : s));
        return false;
      } finally {
        setSending(false);
      }
    },
    [active, sending, loadList]
  );

  const promote = useCallback(async (opts?: { caseDesign?: boolean; marketResearch?: boolean }) => {
    if (!active || promoting) return;
    const id = active.id;
    setPromoting(true);
    setError(null);
    try {
      const res = await fetch(`/api/intake/${encodeURIComponent(id)}/promote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // caseDesign (UAT L1-EVA-3): the requestor can have the work-sample case
        // designed from the same brief in the same backgrounded build.
        // marketResearch (UAT L1-HRBP-11): the opt-out shipped at the route
        // (promote/route.ts honours `marketResearch !== false`) and the UI never
        // sent it — "fix landed != fix reachable". Omitting the field keeps the
        // server default (on), so the pre-existing behaviour is preserved.
        body: JSON.stringify({
          caseDesign: opts?.caseDesign === true,
          marketResearch: opts?.marketResearch !== false,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { slug: string };
      // Identity-checked like every other late response: without it, going Back
      // and opening another intake before this resolved stamped THAT session
      // "promoted" with this one's JD slug.
      setActive((s) => (s && s.id === id ? { ...s, status: "promoted", jdSlug: data.slug } : s));
      void loadList();
      onPromoted?.();
    } catch {
      setError("promote");
    } finally {
      setPromoting(false);
    }
  }, [active, promoting, loadList, onPromoted]);

  // A finished voice session posts its transcript server-side (voice-complete)
  // and hands the authoritative result back here — fold it into the open
  // session. `voiceDegraded` mirrors the text plane's source note: keyless the
  // transcript is stored but the brief stays untouched (extracted: false).
  const [voiceNote, setVoiceNote] = useState<"extracted" | "stored" | null>(null);
  const applyVoiceResult = useCallback((intakeId: string, payload: VoiceSweepResult) => {
    // Same stale-response guard as the text plane: a sweep that lands after the
    // requestor switched sessions belongs to nobody.
    if (activeIdRef.current !== intakeId) return;
    setVoiceNote(payload.extracted ? "extracted" : "stored");
    setActive((s) => foldVoiceSweep(s, intakeId, payload));
  }, []);

  // One completed VOICE exchange (fast thread): append the spoken pair to the
  // open session; a deterministic fast turn carries its inline-extracted brief.
  // A spoken confirmed close flips the status exactly like the text plane.
  const applyVoiceExchange = useCallback(
    (intakeId: string, payload: VoiceExchangeResult) => {
      if (activeIdRef.current !== intakeId) return;
      setActive((s) => foldVoiceExchange(s, intakeId, payload));
      if (payload.done) void loadList();
    },
    [loadList]
  );

  // Human brief edit (UAT drain §2.1): PATCH the full edited brief; the server
  // clamps shape and the store refuses promoted sessions. On success the
  // session's brief swaps to the server-confirmed copy.
  const [savingBrief, setSavingBrief] = useState(false);
  const saveBrief = useCallback(
    async (brief: RoleBrief): Promise<boolean> => {
      if (!active || savingBrief) return false;
      const id = active.id;
      setSavingBrief(true);
      setError(null);
      try {
        const res = await fetch(`/api/intake/${encodeURIComponent(id)}/brief`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ brief }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { brief: RoleBrief };
        if (activeIdRef.current !== id) return true;
        setActive((s) => (s && s.id === id ? { ...s, brief: data.brief, title: data.brief?.title || s.title } : s));
        return true;
      } catch {
        setError("saveBrief");
        return false;
      } finally {
        setSavingBrief(false);
      }
    },
    [active, savingBrief]
  );

  // Re-open a completed session (UAT drain §2.1): the server appends a system
  // turn and flips status; the returned session is authoritative.
  const [reopening, setReopening] = useState(false);
  const reopen = useCallback(
    async (note: string) => {
      if (!active || reopening) return;
      const id = active.id;
      setReopening(true);
      setError(null);
      try {
        const res = await fetch(`/api/intake/${encodeURIComponent(id)}/reopen`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as IntakeSession;
        if (activeIdRef.current !== id) return;
        setActive(data);
        void loadList();
      } catch {
        setError("reopen");
      } finally {
        setReopening(false);
      }
    },
    [active, reopening, loadList]
  );

  // Click-to-turn (UAT drain §2.2, the defensibility moment): a source-turn
  // chip scrolls + flashes the transcript bubble it cites.
  // Reference material (attachments): add a pasted note or a library JD; the
  // server resolves JD bodies and enforces the caps. State swaps to the
  // server-confirmed list on success.
  const [savingAttachment, setSavingAttachment] = useState(false);
  // Returns whether the server accepted the mutation — the pane may only clear
  // a pasted note once it did (the route refuses past 5 attachments and on a
  // frozen session, and that 400/409 used to take the typed text with it).
  const mutateAttachments = useCallback(
    async (body: Record<string, unknown>): Promise<boolean> => {
      if (!active || savingAttachment) return false;
      const id = active.id;
      setSavingAttachment(true);
      setError(null);
      try {
        const res = await fetch(`/api/intake/${encodeURIComponent(id)}/attachments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { attachments: IntakeAttachment[] };
        setActive((s) => (s && s.id === id ? { ...s, attachments: data.attachments } : s));
        return true;
      } catch {
        setError("attachment");
        return false;
      } finally {
        setSavingAttachment(false);
      }
    },
    [active, savingAttachment]
  );
  const addAttachment = useCallback(
    (input: { kind: "note"; title: string; text: string } | { kind: "jd"; jdSlug: string }) =>
      mutateAttachments({ action: "add", ...input }),
    [mutateAttachments]
  );
  const removeAttachment = useCallback((index: number) => mutateAttachments({ action: "remove", index }), [mutateAttachments]);

  const [highlightTurn, setHighlightTurn] = useState<number | null>(null);
  const jumpToTurn = useCallback((turn: number) => {
    setHighlightTurn(turn);
  }, []);
  const clearHighlight = useCallback(() => setHighlightTurn(null), []);

  const closeSession = useCallback(() => {
    activeIdRef.current = null;
    setActive(null);
    setHighlightTurn(null);
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
    voiceNote,
    applyVoiceResult,
    applyVoiceExchange,
    saveBrief,
    savingBrief,
    reopen,
    reopening,
    highlightTurn,
    jumpToTurn,
    clearHighlight,
    addAttachment,
    removeAttachment,
    savingAttachment,
  };
}
