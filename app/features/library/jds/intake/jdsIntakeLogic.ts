"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RoleBrief } from "@/app/_lib/rolespec";
import type { AppMasterCompose } from "@/app/_lib/db/intakes";
import type { RepoDossier } from "@/app/_lib/schemas.generated";

// State + API client for the role-intake dialog surface (Phase 1 of
// docs/concepts/role-intake-dialog.md). Pure fetch/state — rendering lives in
// JdsIntakePanel/JdsIntakeChat/JdsIntakeBriefPanel (200-line rule).

export type IntakeTurn = { role: "interviewer" | "candidate" | "system"; text: string; at?: string };

export type IntakeShape = "power_unit" | "story" | "app_master" | null;

export type IntakeSummary = {
  id: string;
  title: string;
  status: "open" | "complete" | "promoted";
  shape: IntakeShape;
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
  /** The row version this session was read at (the store returns it on every
   *  session read). The brief edit form keys its sessionStorage draft on it, so
   *  a draft typed against a superseded row is discarded rather than replayed
   *  over whatever landed meanwhile — intakeBriefDraft.ts. */
  updatedAt: string | null;
  lang: string | null;
  transcript: IntakeTurn[];
  brief: RoleBrief | null;
  attachments: IntakeAttachment[];
  shape: IntakeShape;
  // App master (docs/features/app-master/README.md): the scan this session was
  // started from, what it read, and the composed spec + population fit.
  scanId: string | null;
  dossier: RepoDossier | null;
  appMaster: AppMasterCompose | null;
  jdSlug: string | null;
};

/** What the scan is doing right now, for the line the chat shows under the opener
 *  and the card shows under its title. `null` = this is not an App-master session
 *  (or the dossier landed with nothing left to disclose).
 *
 *  Every member is ALSO a message key under `library.tab.intake.appMaster.scan.*` —
 *  the panel renders it as `t(\`appMaster.scan.${state}\`)`, and next-intl keys are
 *  typed, so a state with no catalog entry is a `tsc` error rather than a blank
 *  line on somebody's screen.
 *
 *  The `failed*` and `fellBack*` members are why this is no longer a four-word
 *  enum. "Failed" was the only thing a four-minute scan could say when it died,
 *  and "complete" was the only thing it could say when the agent had fallen back
 *  to the file-walk — two outcomes the operator would act on very differently,
 *  rendered identically. */
export type ScanState =
  | "queued"
  | "running"
  | "complete"
  | "unreachable"
  // The failure classes (RepoScanErrorCode, app/_lib/db/repo-scans.ts). `failed` is
  // the generic: an unclassified failure, and every row written before the column
  // existed.
  | "failed"
  | "failedTargetRefused"
  | "failedOfflineRefused"
  | "failedGitMissing"
  | "failedCloneFailed"
  | "failedCloneTimeout"
  | "failedCancelled"
  | "failedTimeout"
  | "failedEngineFailed"
  // The dossier LANDED, but on the heuristic floor after the in-repo agent failed
  // (RepoScanFallbackClass — Python's FALLBACK_CLASSES, mirrored in TS).
  | "fellBackAgentNotInstalled"
  | "fellBackAgentTimeout"
  | "fellBackAgentUnparseable"
  | "fellBackAgentRefused"
  | "fellBackAgentOutputTooLarge"
  | "fellBackProviderError"
  | "fellBackUnknown"
  | null;

/** One repo scan as `GET /api/repo-scan/[id]` serves it (P2's contract). */
export type RepoScanView = {
  id: string;
  status: "queued" | "running" | "complete" | "failed";
  source: "llm" | "heuristic" | null;
  dossier: RepoDossier | null;
  /** The row's resolved `rootPath` is withheld; this is the projection of it. */
  isLocal?: boolean;
  /** The failure CLASS, and the ONLY thing the panel is told about a failure. The
   *  row's `error` is the server's English diagnostic — for a clone failure it
   *  quotes git's stderr — so the route does not serve it at all and this type does
   *  not declare it (repo-scan-detail-route.test.ts enumerates the wire shape). */
  errorCode?: string | null;
  /** Set on a COMPLETE scan whose dossier came off the heuristic floor because the
   *  agent failed. Absent on a keyless install — the floor is not a fallback there,
   *  it is the design, and saying "the agent fell back" would invent a failure. */
  fallbackClass?: string | null;
};

// Explicit maps, not template-built keys: next-intl keys are typed, so a state
// assembled at runtime is a key TypeScript cannot check. An unrecognised code falls
// to the generic member — the operator is told the scan failed, which is true,
// instead of being shown a key that does not resolve.
const FAILURE_STATE: Record<string, ScanState> = {
  target_refused: "failedTargetRefused",
  offline_refused: "failedOfflineRefused",
  git_missing: "failedGitMissing",
  clone_failed: "failedCloneFailed",
  clone_timeout: "failedCloneTimeout",
  cancelled: "failedCancelled",
  timeout: "failedTimeout",
  engine_failed: "failedEngineFailed",
};

const FALLBACK_STATE: Record<string, ScanState> = {
  agent_not_installed: "fellBackAgentNotInstalled",
  agent_timeout: "fellBackAgentTimeout",
  agent_unparseable: "fellBackAgentUnparseable",
  agent_refused: "fellBackAgentRefused",
  agent_output_too_large: "fellBackAgentOutputTooLarge",
  provider_error: "fellBackProviderError",
  unknown: "fellBackUnknown",
};

/**
 * The one line the surfaces show for a scan, derived from the row.
 *
 * `null` for a clean completion: there is nothing left to say, and the card's own
 * provenance chip already says which path read the repository. A completion WITH a
 * fallback class is not clean — the dossier is real but thinner than it looks, and
 * that is the one moment the operator can still decide to fix their agent and
 * re-scan. Pure, so jdsIntakeLogic.test.ts pins it without React.
 */
/** The scan's second, INDEPENDENT disclosure: what it can claim about the fence
 *  that keeps the in-repo agent out of `.env` and its friends.
 *
 *  Independent of `ScanState` on purpose. "The agent timed out" and "the agent read
 *  your repo behind deny rules nobody has verified for the CLI it ran on" are two
 *  different facts about the same run, and folding the second into the first enum
 *  would mean one of them was always dropped. `null` = nothing to say: the fence was
 *  verified, or no in-repo agent read the files at all (a keyless walk has no fence
 *  to verify, and warning there would cry wolf on every keyless install).
 *
 *  Both members are ALSO message keys under `library.tab.intake.appMaster.scan.*`. */
export type ScanFenceWarning = "fenceUnverified" | "fenceVersionUnknown" | null;

const FENCE_WARNING: Record<string, ScanFenceWarning> = {
  unverified_version: "fenceUnverified",
  version_unknown: "fenceVersionUnknown",
};

/**
 * Read that disclosure off a scan row. Defensive by construction: the block is
 * stamped by Python onto the dossier as `scanFence`, which is outside
 * `repoDossierSchema` (it is a fact about the SCAN, not about the repo), so a row
 * written before the field existed — or by a build that strips it — must read as
 * "no claim" rather than as a warning nobody can act on.
 *
 * Pure, so jdsIntakeLogic.test.ts pins it without React.
 */
export function scanFenceWarningFor(scan: RepoScanView): ScanFenceWarning {
  if (scan.status !== "complete") return null;
  const fence = (scan.dossier as { scanFence?: unknown } | null)?.scanFence;
  if (!fence || typeof fence !== "object" || Array.isArray(fence)) return null;
  const state = (fence as { state?: unknown }).state;
  return typeof state === "string" ? FENCE_WARNING[state] ?? null : null;
}

export function scanStateFor(scan: RepoScanView): ScanState {
  if (scan.status === "failed") return FAILURE_STATE[scan.errorCode ?? ""] ?? "failed";
  if (scan.status === "complete") return scan.fallbackClass ? FALLBACK_STATE[scan.fallbackClass] ?? "fellBackUnknown" : null;
  return scan.status;
}

/**
 * Read that response. The row is WRAPPED — the route answers `{ scan }`
 * (app/api/repo-scan/[id]/route.ts) — and reading it FLAT is how the App-master
 * dossier silently never reached its intake: `body.status` was `undefined`, so
 * the watcher's "has it completed?" test was false forever, and the card sat on
 * "the scan is still reading the codebase" for a walk that had finished in about
 * a second. Nothing errored; the whole App-master flow simply stopped.
 * (Found by e2e/app-master-hire.spec.ts.)
 *
 * Pure and exported so the P2↔P3 seam is pinned by a unit test rather than by an
 * e2e run — and STRICT: an unrecognised body returns null, which the caller
 * surfaces as "can't reach the scan, retrying". Tolerating both shapes here
 * would just hide the next shape change the same way.
 */
export function readRepoScanResponse(body: unknown): RepoScanView | null {
  const scan = (body as { scan?: unknown } | null)?.scan;
  if (!scan || typeof scan !== "object") return null;
  const view = scan as RepoScanView;
  return typeof view.status === "string" ? view : null;
}

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

/** The two facts a degraded turn carries: WHY the engine fell back (a raw
 *  diagnostic line, classified for display - never rendered verbatim) and, when
 *  the scripted path could not answer in the session's language, WHICH language
 *  it answered in instead. Both come straight off /message and /voice-turn. */
export type IntakeDegradation = { reason: string | null; lang: string | null };

/** What went wrong, and the machine CODE the server gave for it.
 *
 *  `kind` is which affordance failed (the panel decides where the line goes and
 *  what its fallback sentence is); `code` is the server's refusal code, which the
 *  panel resolves through `useErrorMessage` in the reader's language. Every one of
 *  these used to be a bare `setError("send")` and a single English "send failed",
 *  so "you already have five attachments", "that JD is not in your library" and
 *  "slow down" were the same red line (docs/architecture/api-contracts.md §1.1). */
export type IntakeError = {
  kind: "list" | "open" | "create" | "appMaster" | "send" | "promote" | "saveBrief" | "reopen" | "attachment";
  code: string | null;
};

/** The refusal code off a non-OK response, or null when the body carries none
 *  (an offline fetch, a proxy's HTML error page). Never the server's `error`
 *  string: the client renders codes, not English. */
async function refusalCode(res: Response): Promise<string | null> {
  const body = (await res.json().catch(() => null)) as { code?: string } | null;
  return typeof body?.code === "string" ? body.code : null;
}

/** The write refused because the row moved under an in-flight spawn. Not a
 *  failure to retry: the truth is on the server, so the session is re-read. */
const MOVED = "INTAKE_BRIEF_MOVED";

export function useIntakeLogic(onPromoted?: () => void) {
  const [sessions, setSessions] = useState<IntakeSummary[] | null>(null);
  const [active, setActive] = useState<IntakeSession | null>(null);
  const [sending, setSending] = useState(false);
  const [creating, setCreating] = useState(false);
  const [promoting, setPromoting] = useState(false);
  // WHAT degraded, not just THAT it did. The engine has always answered both
  // facts and this hook kept a bare boolean, so the pane could only ever say
  // "AI is offline" - identical for a keyless install (a settings trip) and for
  // a provider that fell over (worth one retry). `lang` is the OTHER discarded
  // fact: the scripted path exists in four locales and serves a stand-in when
  // the session asks for one it does not carry.
  const [degradation, setDegradation] = useState<IntakeDegradation | null>(null);
  const degraded = degradation !== null;
  const [error, setError] = useState<IntakeError | null>(null);
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
      setError({ kind: "list", code: null });
    }
  }, []);

  useEffect(() => {
    // Deferred a tick (the jdsHooks.ts pattern) so the mount fetch can never
    // set state synchronously inside the effect.
    const timer = window.setTimeout(() => void loadList(), 0);
    return () => window.clearTimeout(timer);
  }, [loadList]);

  // Re-read the session from the server WITHOUT touching the error line: this is
  // also what a `moved` refusal runs, and there the reader must keep seeing why
  // their write was not applied while the panel quietly catches up to the truth.
  const reloadSession = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/intake/${encodeURIComponent(id)}`);
      if (!res.ok) return false;
      const data = (await res.json()) as IntakeSession;
      if (activeIdRef.current === id) setActive(data);
      return true;
    } catch {
      /* the caller already has an error line up; a failed re-read adds nothing to it */
      return false;
    }
  }, []);

  const openSession = useCallback(
    async (id: string) => {
      setError(null);
      activeIdRef.current = id;
      if (!(await reloadSession(id))) setError({ kind: "open", code: null });
    },
    [reloadSession]
  );

  const startNew = useCallback(async (lang: string) => {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang }),
      });
      if (!res.ok) {
        setError({ kind: "create", code: await refusalCode(res) });
        return;
      }
      const data = (await res.json()) as IntakeSession;
      activeIdRef.current = data.id;
      setActive(data);
      setDegradation(null);
    } catch {
      setError({ kind: "create", code: null });
    } finally {
      setCreating(false);
    }
  }, []);

  // App master (docs/features/app-master/README.md): point kp at an app, start
  // the repo scan FIRST, then open a session bound to it. The order matters —
  // the scan id is stamped on the row at creation, so a reload can resume a
  // scan that is still running instead of orphaning it.
  const startAppMaster = useCallback(async (lang: string, repo: { repoUrl?: string; rootPath?: string }) => {
    setCreating(true);
    setError(null);
    try {
      const scanRes = await fetch("/api/repo-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(repo),
      });
      if (!scanRes.ok) throw new Error(`HTTP ${scanRes.status}`);
      const scan = (await scanRes.json()) as { scanId?: string };
      if (!scan.scanId) throw new Error("no scanId");
      const res = await fetch("/api/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang, scanId: scan.scanId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as IntakeSession;
      activeIdRef.current = data.id;
      setActive(data);
      setDegradation(null);
    } catch {
      // The scan never started (bad repo, unreachable path, rate limit) — say
      // so instead of opening a session bound to a scan that does not exist.
      setError({ kind: "appMaster", code: null });
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
        if (!res.ok) {
          const code = await refusalCode(res);
          setError({ kind: "send", code });
          // Roll back the optimistic line so a retry doesn't double it server-side.
          setActive((s) => (s && s.id === id ? { ...s, transcript: s.transcript.slice(0, -1) } : s));
          // The turn was computed against a row a brief edit (or the voice plane)
          // has since replaced, and the server refused rather than reverting it.
          // Adopt the server's version instead of leaving the panel showing a
          // brief the store no longer holds.
          if (code === MOVED) void reloadSession(id);
          return false;
        }
        const data = (await res.json()) as {
          reply: string;
          brief: RoleBrief;
          shape: IntakeSession["shape"];
          done: boolean;
          source: "llm" | "deterministic";
          fallbackReason?: string;
          fallbackLang?: string;
        };
        setDegradation(
          data.source === "deterministic"
            ? { reason: data.fallbackReason ?? null, lang: data.fallbackLang ?? null }
            : null
        );
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
        setError({ kind: "send", code: null });
        // Roll back the optimistic line so a retry doesn't double it server-side.
        setActive((s) => (s && s.id === id ? { ...s, transcript: s.transcript.slice(0, -1) } : s));
        return false;
      } finally {
        setSending(false);
      }
    },
    [active, sending, loadList, reloadSession]
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
      if (!res.ok) {
        setError({ kind: "promote", code: await refusalCode(res) });
        return;
      }
      const data = (await res.json()) as { slug: string };
      // Identity-checked like every other late response: without it, going Back
      // and opening another intake before this resolved stamped THAT session
      // "promoted" with this one's JD slug.
      setActive((s) => (s && s.id === id ? { ...s, status: "promoted", jdSlug: data.slug } : s));
      void loadList();
      onPromoted?.();
    } catch {
      setError({ kind: "promote", code: null });
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
        if (!res.ok) {
          const code = await refusalCode(res);
          setError({ kind: "saveBrief", code });
          if (code === MOVED) void reloadSession(id);
          return false;
        }
        const data = (await res.json()) as { brief: RoleBrief };
        if (activeIdRef.current !== id) return true;
        setActive((s) => (s && s.id === id ? { ...s, brief: data.brief, title: data.brief?.title || s.title } : s));
        return true;
      } catch {
        setError({ kind: "saveBrief", code: null });
        return false;
      } finally {
        setSavingBrief(false);
      }
    },
    [active, savingBrief, reloadSession]
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
        if (!res.ok) {
          setError({ kind: "reopen", code: await refusalCode(res) });
          return;
        }
        const data = (await res.json()) as IntakeSession;
        if (activeIdRef.current !== id) return;
        setActive(data);
        void loadList();
      } catch {
        setError({ kind: "reopen", code: null });
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
        if (!res.ok) {
          setError({ kind: "attachment", code: await refusalCode(res) });
          return false;
        }
        const data = (await res.json()) as { attachments: IntakeAttachment[] };
        setActive((s) => (s && s.id === id ? { ...s, attachments: data.attachments } : s));
        return true;
      } catch {
        setError({ kind: "attachment", code: null });
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

  // The one seam an OUT-OF-BAND updater writes the open session through (today:
  // the App-master scan watcher in jdsIntakeAppMaster.ts). Identity-checked here
  // so the stale-response guard the whole surface depends on lives in exactly one
  // place — and so this module never has to import the tasks provider, which
  // would drag React/next-intl into its node:test unit run.
  const applySession = useCallback((intakeId: string, patch: Partial<IntakeSession>) => {
    if (activeIdRef.current !== intakeId) return;
    setActive((s) => (s && s.id === intakeId ? { ...s, ...patch } : s));
  }, []);

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
    degradation,
    error,
    startNew,
    startAppMaster,
    applySession,
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
