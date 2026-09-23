// Live Work Surface — the session protocol as a framework-free client.
//
// Everything that decides WHAT goes on the wire lives here: the lazy mint, the 8s
// flush, the re-buffer on failure, the dirty-tree rule, the 403/404/409 handling and
// the submit that only seals after a landed flush. LiveWorkSurface.tsx holds one of
// these and renders its snapshot; fetch, the clock and the local-draft writes are
// injected, so node:test drives the protocol with a fake fetch and a manual clock
// (liveWorkSync.test.ts) instead of reading the component's source as text.
//
// Error classification lives in ONE place (`isCodedRefusal`, below): a coded 4xx mint
// refusal ("this link is not taking work", "this link has spent its day of
// sessions") is not retried on every edit and every tick — it backs off until an
// explicit user action or the window elapses. A thrown fetch (offline, DNS) is a
// suspension, not a refusal, and stays retryable on the next tick.
//
// Public candidate surface: the only ids this client ever sends are the apply token
// from the URL and the session id the mint returned for it. Nothing else crosses.
//
// THE SESSION KEY (challenge-r06 devcase-session-api/A). The mint also hands THIS device a
// per-attempt secret; it lives beside the session id (in state and in the local draft) and
// rides every mutating call (flush, chat, submit) as the SESSION_KEY_HEADER header, never
// in the URL, which is the channel a session id already leaks through. A restored draft
// with an id but no key (written before the key existed) flushes KEYLESS: the legacy row
// it names still accepts the apply token, and re-minting would abandon the candidate's
// server-side attempt and its elapsed clock. Only a 403 on such a keyless call (the row IS
// keyed and this device lost the key) re-mints, and only once.
import type { ProcessEvent, SeedFile } from "@/app/features/tools/devcases/DevTypes";
import { foldMintRefusal, type MintRefusal } from "./liveWorkMint";

export const DECISIONS_FILE = "DECISIONS.md";
/** First backoff after a coded mint refusal; doubles per repeat refusal, capped. */
export const MINT_REFUSAL_BACKOFF_MS = 60_000;
export const MINT_REFUSAL_BACKOFF_MAX_MS = 15 * 60_000;
/** The header the per-attempt key travels in. Mirrors SESSION_KEY_HEADER in
 *  app/_lib/devcase-session-auth.ts (a node:crypto module this client cannot import);
 *  devcase-session-auth.test.ts pins that the two literals agree. */
export const SESSION_KEY_HEADER = "x-devcase-session-key";

/** The slice of `Response` this client reads — a fake in tests, `window.fetch` in the page. */
export type SyncResponse = { ok: boolean; status: number; json(): Promise<unknown> };
export type SyncFetch = (
  url: string,
  init: { method: "POST"; headers: Record<string, string>; body: string }
) => Promise<SyncResponse>;

export type LiveWorkSyncState = {
  sessionId: string | null;
  /** The per-attempt key the mint gave this device (null: a pre-key draft, or not minted). */
  sessionKey: string | null;
  files: SeedFile[];
  pending: ProcessEvent[];
  /** Something changed since the server last acknowledged the tree. */
  filesDirty: boolean;
  /** The server refused this session id for this link (403). Flushing stops; a reload reconnects. */
  syncBlocked: boolean;
  /** Why the server refused (mint or submit), as a code the page resolves in the reader's language. */
  refusal: MintRefusal | null;
  /** While set and in the future, no automatic mint is attempted. */
  mintBlockedUntil: number | null;
  perturbation: string | null;
  elapsedMinutes: number | null;
  status: "idle" | "submitting" | "submitted" | "error";
  errorKind: "closed" | "generic";
  /** The opaque, quotable handle the server derives for a submission — never the internal id. */
  reference: string | null;
};

export type LiveWorkSyncOptions = {
  token: string;
  seedFiles: SeedFile[];
  fetch: SyncFetch;
  now: () => number;
  /** Write the local draft (best-effort; the component owns localStorage). */
  persist: () => void;
  /** Remove the local draft once a submission is sealed. */
  clearDraft: () => void;
};

export type SubmitInput = { candidate: string; contact: string; locale: string; activePath: string };
export type ChatInput = {
  channel: "assistant" | "stakeholder";
  message: string;
  currentFile: { path: string; contents: string } | null;
};

export type LiveWorkSync = ReturnType<typeof createLiveWorkSync>;

const JSON_HEADERS = { "Content-Type": "application/json" };
const WATERMARK_RE = /\n?Session ref: wm-[0-9a-f]{10}\n?/g;

/** A mint answer the client must NOT retry blind: a 4xx the server explained with a code. */
function isCodedRefusal(status: number, code: string | null): boolean {
  return status >= 400 && status < 500 && !!code;
}

/** Stamp the session watermark into DECISIONS.md, REPLACING any prior mark: a restored
 *  draft that self-healed onto a fresh session would otherwise carry the dead session's
 *  mark and read as circulated work. */
export function stampWatermark(files: SeedFile[], watermark: string): SeedFile[] {
  return files.map((f) => {
    if (!f.path.endsWith(DECISIONS_FILE) || f.contents.includes(watermark)) return f;
    const stripped = f.contents.replace(WATERMARK_RE, "\n");
    return { ...f, contents: `${stripped.trimEnd()}\n\nSession ref: ${watermark}\n` };
  });
}

export function createLiveWorkSync(opts: LiveWorkSyncOptions) {
  const { token, fetch, now, clearDraft } = opts;
  // Late-bindable: the page swaps in a writer that closes over its latest chat and
  // identity after mount, without re-creating the client.
  let persist = opts.persist;
  let state: LiveWorkSyncState = {
    sessionId: null,
    sessionKey: null,
    files: opts.seedFiles.map((f) => ({ ...f })),
    pending: [],
    filesDirty: false,
    syncBlocked: false,
    refusal: null,
    mintBlockedUntil: null,
    perturbation: null,
    elapsedMinutes: null,
    status: "idle",
    errorKind: "generic",
    reference: null,
  };
  // The IN-FLIGHT mint, not a boolean: a bare "already starting" flag answered `null`
  // to everyone who asked while the first POST was on the wire, and `null` reads as
  // "minting failed". Sharing the promise keeps one mint per session.
  let minting: Promise<string | null> | null = null;
  let submitting = false;
  let refusalStreak = 0;
  // A keyless 403 re-mints ONCE per client: past that it is a real refusal, and a loop of
  // mints would spin the per-token/day session quota.
  let remintedAfterRefusal = false;
  const listeners = new Set<() => void>();

  function set(patch: Partial<LiveWorkSyncState>) {
    state = { ...state, ...patch };
    for (const l of listeners) l();
  }

  /** The headers of a mutating call: the key when this device holds one. */
  function doorHeaders(): Record<string, string> {
    return state.sessionKey ? { ...JSON_HEADERS, [SESSION_KEY_HEADER]: state.sessionKey } : JSON_HEADERS;
  }

  function rebuffer(batch: ProcessEvent[]) {
    set({ pending: batch.concat(state.pending) });
    persist();
  }

  async function mint(): Promise<string | null> {
    try {
      const r = await fetch("/api/devcase/session", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ token }),
      });
      if (!r.ok) {
        const payload = (await r.json().catch(() => null)) as { code?: string | null; error?: string | null } | null;
        const refusal = foldMintRefusal({ ok: false, payload });
        if (isCodedRefusal(r.status, refusal?.code ?? null)) {
          // A refusal, not a fault: remember it, so the next edit and the next tick do
          // not walk into the same wall. Each repeat doubles the window.
          const wait = Math.min(MINT_REFUSAL_BACKOFF_MS * 2 ** refusalStreak, MINT_REFUSAL_BACKOFF_MAX_MS);
          refusalStreak++;
          set({ refusal, mintBlockedUntil: now() + wait });
        } else {
          set({ refusal });
        }
        return null;
      }
      const data = (await r.json().catch(() => null)) as { sessionId?: string; sessionKey?: unknown; watermark?: string } | null;
      const sessionId = data?.sessionId ?? null;
      refusalStreak = 0;
      set({
        sessionId,
        sessionKey: typeof data?.sessionKey === "string" && data.sessionKey ? data.sessionKey : null,
        refusal: null,
        mintBlockedUntil: null,
        // Session watermark (LLM-era controls #4): the stamped tree must reach the server.
        ...(data?.watermark ? { files: stampWatermark(state.files, data.watermark), filesDirty: true } : {}),
      });
      if (data?.watermark) persist();
      return sessionId;
    } catch {
      // Offline / DNS / CORS: paint the generic line (null code) so the candidate is not
      // typing into an unrecorded session, and stay retryable next tick.
      set({ refusal: foldMintRefusal({ networkError: true }) });
      return null;
    }
  }

  /** Lazily mint the session on first interaction — never for a visitor who only reads
   *  the brief. `explicit` is a user's own click (submit, chat, retry): it may cross a
   *  refusal backoff once; the automatic callers (record, the tick) may not. */
  async function ensureSession(ensureOpts: { explicit?: boolean } = {}): Promise<string | null> {
    if (state.sessionId) return state.sessionId;
    if (minting) return minting;
    if (!ensureOpts.explicit && state.mintBlockedUntil != null && now() < state.mintBlockedUntil) return null;
    const inflight = mint();
    minting = inflight;
    try {
      return await inflight;
    } finally {
      minting = null;
    }
  }

  function retryMint(): Promise<string | null> {
    return ensureSession({ explicit: true });
  }

  function record(kind: ProcessEvent["kind"], path?: string, size?: number) {
    set({ pending: [...state.pending, { t: now(), kind, path, size }] });
    persist();
    void ensureSession();
  }

  function edit(path: string, contents: string) {
    set({ files: state.files.map((f) => (f.path === path ? { ...f, contents } : f)), filesDirty: true });
    persist();
  }

  /** Resume from a local draft. A restored tree may be newer than the server's copy. A key
   *  is only ever restored WITH the id it belongs to; an id with no key (a pre-key draft)
   *  is kept and flushed keyless, never re-minted on sight. */
  function hydrate(draft: { sessionId: string | null; sessionKey?: string | null; files: SeedFile[]; pending: ProcessEvent[] }) {
    set({
      ...(draft.files.length > 0 ? { files: draft.files, filesDirty: true } : {}),
      ...(draft.sessionId ? { sessionId: draft.sessionId, sessionKey: draft.sessionKey ?? null } : {}),
      pending: draft.pending,
    });
  }

  /** Advance the displayed clock by a minute between flushes (the server's value wins on the next one). */
  function tickClock() {
    if (state.elapsedMinutes != null) set({ elapsedMinutes: state.elapsedMinutes + 1 });
  }

  /** Whether this flush LANDED (the server acknowledged the batch, and the tree with it
   *  when one rode along). The tick ignores the answer; submit() depends on it. */
  async function flush(flushOpts: { submit?: boolean } = {}): Promise<boolean> {
    // Idle-visitor guard: no session and nothing to send means nothing to do.
    if (!state.sessionId && state.pending.length === 0) return false;
    // The server refused this session for this link; retrying the same refusal every
    // 8 seconds is the loop the banner exists to replace. A reload reconnects.
    if (state.syncBlocked) return false;
    const sid = await ensureSession({ explicit: flushOpts.submit });
    if (!sid) return false;
    const batch = state.pending;
    set({ pending: [] });
    // Files ride only when dirty (or on submit, which must capture the final tree); an
    // idle tick still POSTs the empty batch so the server can deliver the mid-flight update.
    const sendFiles = state.filesDirty || !!flushOpts.submit;
    const sentFiles = state.files;
    try {
      // The session key (a header) and the apply token (the body) ride every mutating
      // call: a session id alone is not authority.
      // NO `keepalive` — it caps the body at 64KB, and this request must carry the
      // complete final tree (50 files x 256KB).
      const keyless = !state.sessionKey;
      const r = await fetch(`/api/devcase/session/${sid}`, {
        method: "POST",
        headers: doorHeaders(),
        body: JSON.stringify({ token, events: batch, ...(sendFiles ? { files: sentFiles } : {}) }),
      });
      if (r.status === 403) {
        rebuffer(batch);
        if (keyless && !remintedAfterRefusal) {
          // The row is keyed and this device never had (or lost) its key, so it cannot
          // prove this attempt again. Drop the id like a 404/409 and re-mint ONCE; the
          // local tree and the buffered batch stay, so the work moves to the new attempt.
          remintedAfterRefusal = true;
          set({ sessionId: null, sessionKey: null });
          return false;
        }
        set({ syncBlocked: true });
        return false;
      }
      if (r.status === 404 || r.status === 409) {
        // This session id is dead (gone, or another tab sealed it). Drop it, and its key
        // with it, so the next flush mints a fresh one, which also re-stamps the watermark.
        set({ sessionId: null, sessionKey: null });
        rebuffer(batch);
        return false;
      }
      if (!r.ok) throw new Error("flush failed");
      // Clean only if nothing was edited while the request was on the wire.
      if (sendFiles && state.files === sentFiles) set({ filesDirty: false });
      persist();
      const data = (await r.json().catch(() => null)) as { perturbation?: string | null; elapsedMinutes?: number | null } | null;
      set({
        ...(data?.perturbation ? { perturbation: data.perturbation } : {}),
        ...(typeof data?.elapsedMinutes === "number" ? { elapsedMinutes: data.elapsedMinutes } : {}),
      });
      return true;
    } catch {
      // Network failure: re-buffer so the batch is not lost; the tree stays dirty.
      rebuffer(batch);
      return false;
    }
  }

  /** Seal the attempt. An unlanded final flush is a retryable error that leaves the
   *  session active, the tree dirty and the draft on disk. */
  async function submit(input: SubmitInput): Promise<void> {
    if (submitting) return;
    submitting = true;
    set({ status: "submitting" });
    record("submit", input.activePath);
    try {
      const landed = await flush({ submit: true });
      const sid = state.sessionId;
      if (!landed || !sid) {
        set({ status: "error", errorKind: "generic" });
        return;
      }
      const r = await fetch(`/api/devcase/session/${sid}/submit`, {
        method: "POST",
        headers: doorHeaders(),
        body: JSON.stringify({ token, candidate: input.candidate, contact: input.contact, locale: input.locale }),
      }).catch(() => null);
      if (r && r.ok) {
        const payload = (await r.json().catch(() => null)) as { reference?: unknown } | null;
        set({ status: "submitted", reference: typeof payload?.reference === "string" ? payload.reference : null });
        // A submitted draft is done: a later visit on this device never resurrects it.
        clearDraft();
        return;
      }
      // A 410 (intake closed) is TERMINAL; anything else stays retryable.
      const payload = (await r?.json().catch(() => null)) as { code?: string | null } | null;
      set({
        status: "error",
        errorKind: r?.status === 410 ? "closed" : "generic",
        refusal: payload?.code ? { code: payload.code, error: null } : null,
      });
    } finally {
      submitting = false;
    }
  }

  /** Send one chat turn on this attempt, minting it first if needed (a chat message is the
   *  candidate's own click, so it may cross a mint-refusal backoff once). Null when no
   *  session could be minted; otherwise the raw answer, which the page folds (429, codes). */
  async function chat(input: ChatInput): Promise<SyncResponse | null> {
    const sid = await ensureSession({ explicit: true });
    if (!sid) return null;
    return fetch(`/api/devcase/session/${sid}/chat`, {
      method: "POST",
      headers: doorHeaders(),
      body: JSON.stringify({ token, channel: input.channel, message: input.message, currentFile: input.currentFile }),
    });
  }

  return {
    getSnapshot: (): LiveWorkSyncState => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    setPersist(next: () => void) {
      persist = next;
    },
    ensureSession,
    retryMint,
    record,
    edit,
    hydrate,
    tickClock,
    flush,
    submit,
    chat,
  };
}
