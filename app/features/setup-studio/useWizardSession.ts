"use client";

/*
 * The studio's one connection to the wizard server, and the one place its
 * events become state.
 *
 * Everything here is CROSS-ORIGIN by design (docs/concepts/onboarding-in-app.md,
 * "keep the engine outside the app"): the installer keeps running while the app
 * it is configuring restarts, so the page talks to `http://localhost:<port>`
 * over EventSource + fetch rather than through a route of our own. Two
 * consequences shape this file:
 *
 *  - EventSource cannot send a header, so the token rides the query string of
 *    the WIZARD's URL. That is the installer's own contract (PROTOCOL.md, "HTTP
 *    surface") and it never reaches this app: the token arrives in the URL
 *    fragment, is parsed in the browser, and is held in memory here.
 *  - Every failure mode is a real one. The server may not be running, may have
 *    been stopped, may answer 401 through its app proxy. None of them may render
 *    as a broken page — the connection state is part of the UI.
 *
 * The reducer is deliberately the whole state machine: one `event` action fed by
 * the stream, plus the few optimistic actions the page takes on the operator's
 * click (a card settles the moment they answer, not when the next event lands).
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  assessmentHeadline,
  coerceNoticeKind,
  coerceProbeStatus,
  isJourneyCard,
  isRecord,
  normalizePlan,
  parseMatrix,
  parseWizardTarget,
  readCard,
  readHello,
  readResolved,
  wizardOrigin,
  type Card,
  type Enforcement,
  type Matrix,
  type NoticeKind,
  type PlanStep,
  type ProbeRow,
  type Resolved,
  type WireEvent,
  type WizardTarget,
} from "./protocol";
import { COPY } from "./copy";

/* ── state ──────────────────────────────────────────────────────────────── */

export type ConnectionState = "idle" | "connecting" | "open" | "retrying" | "lost";

/**
 * Why a connection that never greeted us failed. CORS is transport and the
 * token is auth, and they fail differently on purpose: a loopback origin with a
 * bad or missing token gets a readable `403` (carrying CORS headers, so the
 * browser can actually see it) while a server that is simply gone produces a
 * network error. "Wrong or expired link" and "the installer stopped answering"
 * ask the operator for two completely different things, so the page finds out
 * which it is instead of writing one message that covers both.
 */
export type Failure = "absent" | "denied" | null;

export type ActivityEntry = {
  seq: number;
  kind: "narration" | "notice" | "you";
  noticeKind: NoticeKind | null;
  text: string;
};

export type Receipt = { seq: number; label: string; value: string };

export type Terminal = { kind: "done" | "stopped" | "error"; text: string };

export type SessionState = {
  connection: ConnectionState;
  failure: Failure;
  /** True once a `hello` has landed — the proof the port really is a wizard. */
  greeted: boolean;
  /**
   * The highest `seq` this page has processed. `seq` is strictly increasing
   * across the whole SESSION (a new run does not reset it), which makes it the
   * de-duplication identity: an EventSource that auto-reconnects delivers a
   * second `hello` with a replay block covering ground already rendered, and
   * this is what makes that a no-op instead of a double render.
   */
  highestSeq: number;
  repo: string | null;
  envFileExists: boolean | null;
  enforcement: Enforcement | null;
  running: boolean;
  stopPending: boolean;
  finished: Terminal | null;

  phase: string | null;
  phaseSeen: string[];
  plan: PlanStep[] | null;
  lastStep: number | null;

  status: string;
  statusIsError: boolean;

  probes: ProbeRow[];
  probePanelOpen: boolean;
  assessing: boolean;
  assessSummary: { headline: string; rows: ProbeRow[] } | null;

  cards: Card[];
  /** Resolved cards, oldest first — the receipt list. */
  receipts: Receipt[];
  /** How each settled card ended, keyed by id. Also the idempotence guard for
   *  `resolved`: a card already settled here is not settled twice. */
  resolutions: Record<string, string>;
  /** The most recent settle, shown briefly on the stage. `foreign` means it was
   *  answered somewhere else — the other face — which is worth saying out loud
   *  rather than letting a card silently vanish under the operator's cursor. */
  lastResolved: { id: string; text: string; foreign: boolean } | null;

  activity: ActivityEntry[];
  unread: number;
  warnings: string[];

  appPort: number | null;
  matrix: Matrix | null;
  /** The raw markdown the current matrix was parsed from. The replay block ships
   *  the matrix as markdown rather than as an event, so it has no `seq` and this
   *  is what guards it against being re-applied on a reconnect. */
  matrixSource: string | null;
  /** A run that never asked anything: the matrix IS the deliverable. */
  sawWork: boolean;
  /** Sticky: once the voice phase has been reached its panel stays for the rest
   *  of the run. A choice the operator already made must not vanish because the
   *  next phase arrived. */
  voiceReached: boolean;
};

const EMPTY: SessionState = {
  connection: "idle",
  failure: null,
  greeted: false,
  highestSeq: -1,
  repo: null,
  envFileExists: null,
  enforcement: null,
  running: false,
  stopPending: false,
  finished: null,
  phase: null,
  phaseSeen: [],
  plan: null,
  lastStep: null,
  status: COPY.ready,
  statusIsError: false,
  probes: [],
  probePanelOpen: false,
  assessing: false,
  assessSummary: null,
  cards: [],
  receipts: [],
  resolutions: {},
  lastResolved: null,
  activity: [],
  unread: 0,
  warnings: [],
  appPort: null,
  matrix: null,
  matrixSource: null,
  sawWork: false,
  voiceReached: false,
};

type Action =
  | { type: "connection"; value: ConnectionState }
  | { type: "failure"; value: Failure }
  | { type: "event"; ev: WireEvent }
  | { type: "settle"; id: string; resolution: string; receipt: { label: string; value: string } | null }
  | { type: "say"; text: string }
  | { type: "receipt"; label: string; value: string }
  | { type: "status"; text: string; isError?: boolean }
  | { type: "read" }
  | { type: "starting" }
  | { type: "stopping" };

let activitySeq = 0;
const nextSeq = () => ++activitySeq;

/**
 * Everything a new run resets, keeping only what describes the HOST — and the
 * seq high-water mark, because `seq` belongs to the SESSION, not the run: the
 * host does not reset it on `POST /start`, so neither may this.
 */
function freshRun(state: SessionState): SessionState {
  return {
    ...EMPTY,
    connection: state.connection,
    failure: state.failure,
    greeted: state.greeted,
    highestSeq: state.highestSeq,
    repo: state.repo,
    envFileExists: state.envFileExists,
    enforcement: state.enforcement,
    running: true,
    status: COPY.connConnecting,
  };
}

function pushActivity(state: SessionState, entry: Omit<ActivityEntry, "seq">): SessionState {
  return {
    ...state,
    activity: [...state.activity, { seq: nextSeq(), ...entry }],
    // Anything appended counts against the badge — narration and notices alike.
    // A notice the operator never saw a count for is a policy decision made
    // silently, which is the whole reason notices exist.
    unread: state.unread + 1,
  };
}

function applyPlan(state: SessionState, steps: PlanStep[]): SessionState {
  if (!steps.length) return state; // an empty plan is not a plan; keep the rail
  const idx = steps.findIndex((s) => s.id === state.phase);
  const lastStep = idx >= 0 ? idx : state.lastStep != null ? Math.min(state.lastStep, steps.length - 1) : null;
  return { ...state, plan: steps, lastStep };
}

function applyPhase(state: SessionState, id: string): SessionState {
  if (!id) return state;
  const list = state.plan ?? [];
  const idx = list.findIndex((s) => s.id === id);
  const seen = new Set(state.phaseSeen);
  seen.add(id);
  // An ordered rail means an out-of-order phase still lights everything before it.
  if (idx >= 0) list.slice(0, idx).forEach((s) => seen.add(s.id));
  const next: SessionState = {
    ...state,
    phase: id,
    phaseSeen: [...seen],
    lastStep: idx >= 0 ? idx : state.lastStep,
    voiceReached: state.voiceReached || id === "voice",
  };
  if (id === "assess") return { ...next, assessing: true, probePanelOpen: true };
  return next;
}

/**
 * The journey card is where a silent assessment turns into a proposal, so
 * everything found so far stops being the subject and becomes evidence for the
 * decision above it: the live probe list collapses into one line plus the rows
 * that are NOT fine, with the full list one click away.
 */
function collapseAssessment(state: SessionState, summary: string | null): SessionState {
  if (state.assessSummary || !state.probes.length) return { ...state, assessing: false, probePanelOpen: false };
  return {
    ...state,
    assessing: false,
    probePanelOpen: false,
    assessSummary: { headline: summary ?? assessmentHeadline(state.probes), rows: state.probes },
  };
}

function terminal(state: SessionState, kind: Terminal["kind"], text: string): SessionState {
  return {
    ...state,
    running: false,
    stopPending: false,
    finished: { kind, text },
    // The host denies every open card as it stops, so an unanswered card is a
    // dead control — settle them rather than leave buttons nothing will hear.
    cards: [],
    resolutions:
      kind === "stopped"
        ? { ...state.resolutions, ...Object.fromEntries(state.cards.map((c) => [c.id, COPY.resWithdrawn])) }
        : state.resolutions,
  };
}

/**
 * How a `resolved` outcome reads on the stage, and whether it earns a receipt.
 *
 * The receipt list is "what you answered", so it takes the decisions that
 * carried information — a question's pick, a secret's fate — and not the
 * allow/deny of a single command, which is already on the ledger in the drawer
 * and would otherwise bury the answers under a wall of "Allowed.".
 */
function describeResolution(
  resolved: Resolved,
  card: Card | null,
): { text: string; receipt: { label: string; value: string } | null } {
  const name = card?.kind === "secret" ? card.name : card?.kind === "question" ? card.header : (card?.id ?? resolved.id);
  switch (resolved.outcome) {
    case "answered": {
      const value = resolved.answer ?? COPY.resAnswered;
      const label = card?.kind === "question" ? card.header || card.question : name;
      return { text: value, receipt: { label, value } };
    }
    case "saved":
      return { text: `${name}${COPY.resSavedSuffix}`, receipt: { label: name, value: COPY.receiptSet } };
    case "kept":
      return { text: `${name}${COPY.resKeptSuffix}`, receipt: { label: name, value: COPY.receiptKept } };
    case "skipped":
      return { text: `${name}${COPY.resSkippedSuffix}`, receipt: { label: name, value: COPY.receiptSkipped } };
    case "allowed":
      return { text: COPY.resAllowed, receipt: null };
    case "declined":
      return { text: COPY.resDenied, receipt: null };
    case "withdrawn":
      return { text: COPY.resWithdrawn, receipt: null };
    default:
      return { text: COPY.resSettled, receipt: null };
  }
}

/**
 * One event in, one state out — with the `seq` guard that makes the whole thing
 * idempotent. Used for BOTH the live stream and every replayed event, which is
 * the point: an event that has already been rendered is dropped no matter which
 * of the two doors it came through.
 *
 * `hello` itself carries no `seq` (it is the only event that does not), so it
 * always runs, and the replay inside it is guarded event by event.
 */
function applyEvent(state: SessionState, ev: WireEvent): SessionState {
  const seq = typeof ev.seq === "number" && Number.isFinite(ev.seq) ? ev.seq : null;
  if (seq !== null && seq <= state.highestSeq) return state;
  const next = handleEvent(state, ev);
  return seq !== null ? { ...next, highestSeq: seq } : next;
}

function handleEvent(state: SessionState, ev: WireEvent): SessionState {
  const type = typeof ev.type === "string" ? ev.type : "";
  switch (type) {
    case "hello": {
      const hello = readHello(ev);
      let next: SessionState = {
        ...state,
        greeted: true,
        failure: null,
        repo: hello.repo ?? state.repo,
        envFileExists: hello.envFileExists ?? state.envFileExists,
        enforcement: hello.enforcement ?? state.enforcement,
        running: hello.running,
        appPort: hello.appPort ?? state.appPort,
      };
      // The rail FIRST: `phase` and `plan` sit at the top level as well as
      // driving the replay precisely because a face needs somewhere to render
      // into before it renders anything.
      if (hello.plan.length) next = applyPlan(next, hello.plan);
      if (hello.phase) next = applyPhase(next, hello.phase);
      // Then the history, merged and seq-sorted by readHello, through the SAME
      // handler the live stream uses — there is no second renderer for rejoin,
      // which is what stops the two paths drifting apart. `applyEvent` carries
      // the seq guard, so a reconnect's second hello replays into a no-op.
      for (const replayed of hello.replay) next = applyEvent(next, replayed);
      // Neither of these is an event: the status line carries no seq, and the
      // matrix is markdown. Guard the matrix on its own content so a reconnect
      // does not re-animate a panel that is already on screen.
      if (hello.replayStatus) next = { ...next, status: hello.replayStatus, statusIsError: false };
      else if (hello.running && !next.status) next = { ...next, status: COPY.rejoined };
      if (hello.replayMatrix && hello.replayMatrix !== next.matrixSource) {
        next = { ...next, matrix: parseMatrix(hello.replayMatrix), matrixSource: hello.replayMatrix };
      }
      return next;
    }
    case "resolved": {
      const resolved = readResolved(ev);
      if (!resolved) return state;
      // Idempotent by contract: the face that answered gets this event too, and
      // so does every reconnect that replays it. A card already settled here is
      // left exactly as it was.
      if (state.resolutions[resolved.id] !== undefined) return state;
      const card = state.cards.find((c) => c.id === resolved.id) ?? null;
      const { text, receipt } = describeResolution(resolved, card);
      return {
        ...state,
        cards: state.cards.filter((c) => c.id !== resolved.id),
        receipts: receipt ? [...state.receipts, { seq: nextSeq(), ...receipt }] : state.receipts,
        resolutions: { ...state.resolutions, [resolved.id]: text },
        // Reaching here at all means nothing on THIS page settled it — a local
        // answer writes its resolution optimistically and returns above.
        lastResolved: { id: resolved.id, text, foreign: true },
      };
    }
    case "plan":
      return applyPlan(state, normalizePlan(ev.steps));
    case "phase":
      return applyPhase(state, typeof ev.id === "string" ? ev.id : "");
    case "status":
      return { ...state, status: typeof ev.text === "string" ? ev.text : "", statusIsError: false };
    case "narration":
      return pushActivity(state, {
        kind: "narration",
        noticeKind: null,
        text: typeof ev.md === "string" ? ev.md : "",
      });
    case "notice": {
      const kind = coerceNoticeKind(ev.kind);
      const text = typeof ev.text === "string" ? ev.text : "";
      const next = pushActivity(state, { kind: "notice", noticeKind: kind, text });
      // A command that ran without being offered is the one notice the operator
      // must not have to open a drawer to find. Amber, on the stage, once per
      // occurrence — visible, but not red: nothing is broken, the asking
      // contract simply did not hold for that command.
      return kind === "unrequested-run" ? { ...next, warnings: [...next.warnings, text] } : next;
    }
    case "probe": {
      const name = typeof ev.name === "string" ? ev.name : "";
      if (!name) return state;
      const row: ProbeRow = {
        name,
        status: coerceProbeStatus(ev.status),
        detail: typeof ev.detail === "string" ? ev.detail : "",
      };
      const at = state.probes.findIndex((p) => p.name === name);
      const probes = at >= 0 ? state.probes.map((p, i) => (i === at ? row : p)) : [...state.probes, row];
      // A probe arriving after the assessment collapsed means the run is
      // checking again — reopen the panel rather than hide new evidence behind
      // a summary written before it existed.
      return { ...state, probes, probePanelOpen: true };
    }
    case "question":
    case "secret":
    case "permission": {
      const card = readCard(ev);
      if (!card) return state;
      let next = state;
      if (card.kind === "question" && isJourneyCard(card)) next = collapseAssessment(next, card.summary);
      if (card.kind !== "question") next = { ...next, sawWork: true };
      // Addressed by server id: a secret whose save loses a race is RE-EMITTED
      // with the same id and `alreadySet:true`. That must land as the same card
      // changing its mind, not as a second card below the first.
      const at = next.cards.findIndex((c) => c.id === card.id);
      const cards = at >= 0 ? next.cards.map((c, i) => (i === at ? card : c)) : [...next.cards, card];
      const resolutions = { ...next.resolutions };
      delete resolutions[card.id];
      return { ...next, cards, resolutions };
    }
    case "app": {
      const port = typeof ev.port === "number" ? ev.port : null;
      return port ? { ...state, appPort: port } : state;
    }
    case "matrix": {
      const md = typeof ev.md === "string" ? ev.md : "";
      return { ...state, matrix: parseMatrix(md), matrixSource: md };
    }
    case "done": {
      const code = typeof ev.exitCode === "number" ? ev.exitCode : null;
      return code
        ? terminal(state, "error", `${COPY.endedErrorPrefix} ${code}.`)
        : terminal(state, "done", COPY.endedDone);
    }
    case "stopped":
      return terminal(state, "stopped", COPY.endedStopped);
    case "error": {
      const message = typeof ev.message === "string" ? ev.message : "Something went wrong.";
      return terminal({ ...state, status: message, statusIsError: true }, "error", message);
    }
    default:
      // Unknown event types are ignored, never rendered raw. The wizard server is
      // still growing its vocabulary; a page that guesses at a shape it has not
      // read is how a future field becomes a rendering bug.
      return state;
  }
}

function reduce(state: SessionState, action: Action): SessionState {
  switch (action.type) {
    case "connection":
      return { ...state, connection: action.value };
    case "failure":
      return { ...state, failure: action.value };
    case "event":
      return applyEvent(state, action.ev);
    case "settle": {
      const cards = state.cards.filter((c) => c.id !== action.id);
      const receipts = action.receipt
        ? [...state.receipts, { seq: nextSeq(), ...action.receipt }]
        : state.receipts;
      return {
        ...state,
        cards,
        receipts,
        resolutions: { ...state.resolutions, [action.id]: action.resolution },
        // Written BEFORE the server's `resolved` arrives, which is what makes
        // that event a no-op here and keeps the click feeling instant.
        lastResolved: { id: action.id, text: action.resolution, foreign: false },
      };
    }
    case "receipt":
      return { ...state, receipts: [...state.receipts, { seq: nextSeq(), label: action.label, value: action.value }] };
    case "say":
      return pushActivity(state, { kind: "you", noticeKind: null, text: action.text });
    case "status":
      return { ...state, status: action.text, statusIsError: !!action.isError };
    case "read":
      return { ...state, unread: 0 };
    case "starting":
      return freshRun(state);
    case "stopping":
      return { ...state, stopPending: true, status: COPY.stopping };
    default:
      return state;
  }
}

/* ── the client ─────────────────────────────────────────────────────────── */

export type WizardClient = {
  /** `status` rides along because a `403` is a DIFFERENT failure from an error
   *  body — it means the token in the link is wrong or expired, and the page
   *  says so rather than showing the host's message on a dead run. */
  post: (path: string, body: unknown) => Promise<{ status: number; json: Record<string, unknown> }>;
  getJSON: (path: string) => Promise<{ ok: boolean; status: number; json: unknown }>;
  postBlob: (path: string, body: unknown) => Promise<Response>;
};

function makeClient(target: WizardTarget): WizardClient {
  const base = wizardOrigin(target.port);
  const withToken = (path: string) =>
    `${base}${path}${path.includes("?") ? "&" : "?"}t=${encodeURIComponent(target.token)}`;
  // The header is sent as well as the query parameter: the host accepts either,
  // and a header is the one that does not end up in the wizard's own access log.
  // A `content-type` of application/json plus a custom header means every POST
  // is preflighted — which the host answers BEFORE its token check, precisely
  // because a browser never attaches the token to a preflight.
  const headers = { "content-type": "application/json", "x-onboard-token": target.token };
  return {
    async post(path, body) {
      const res = await fetch(withToken(path), {
        method: "POST",
        headers,
        body: JSON.stringify(body ?? {}),
      });
      const json: unknown = await res.json().catch(() => ({}));
      return { status: res.status, json: isRecord(json) ? json : {} };
    },
    async getJSON(path) {
      const res = await fetch(withToken(path), { headers: { "x-onboard-token": target.token } });
      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        /* non-JSON body (an HTML error page from the proxied app) — the caller
           reads `status` instead, which is the fact that matters there. */
      }
      return { ok: res.ok, status: res.status, json };
    },
    postBlob(path, body) {
      return fetch(withToken(path), { method: "POST", headers, body: JSON.stringify(body ?? {}) });
    },
  };
}

/* ── the hook ───────────────────────────────────────────────────────────── */

export type WizardSession = {
  /** null until the fragment is read on the client — the SSR render has none. */
  target: WizardTarget | null;
  /** True once the first client effect has run, so "no fragment" is a verdict. */
  resolved: boolean;
  state: SessionState;
  client: WizardClient | null;
  start: (run?: string) => Promise<void>;
  stop: () => Promise<void>;
  answer: (card: Card & { kind: "question" }, picked: string[]) => Promise<void>;
  decide: (id: string, allow: boolean) => Promise<void>;
  saveSecret: (id: string, name: string, action: "save" | "keep" | "skip", value?: string) => Promise<void>;
  message: (text: string, echo?: boolean) => Promise<void>;
  markActivityRead: () => void;
  note: (label: string, value: string) => void;
  setStatus: (text: string, isError?: boolean) => void;
  reconnect: () => void;
};

export function useWizardSession(): WizardSession {
  const [target, setTarget] = useState<WizardTarget | null>(null);
  const [resolved, setResolved] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [state, dispatch] = useReducer(reduce, EMPTY);
  const sourceRef = useRef<EventSource | null>(null);

  // The fragment is read in an effect, never during render: the server has no
  // location, so a render-time read would hydrate mismatched. Also re-read on
  // `hashchange`, because the standalone page hands off by REPLACING the
  // fragment on an already-open tab.
  useEffect(() => {
    const read = () => {
      setTarget((prev) => {
        const next = parseWizardTarget(window.location.hash);
        if (prev && next && prev.port === next.port && prev.token === next.token) return prev;
        return next;
      });
      setResolved(true);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  const client = useMemo(() => (target ? makeClient(target) : null), [target]);

  useEffect(() => {
    if (!target) return;
    dispatch({ type: "connection", value: "connecting" });
    dispatch({ type: "failure", value: null });
    // One diagnosis per connection attempt — `onerror` can fire repeatedly.
    let probed = false;
    const url = `${wizardOrigin(target.port)}/events?t=${encodeURIComponent(target.token)}`;
    const es = new EventSource(url);
    sourceRef.current = es;
    es.onopen = () => dispatch({ type: "connection", value: "open" });
    es.onmessage = (e: MessageEvent<string>) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(e.data);
      } catch {
        return; // a frame we cannot read is a frame we do not act on
      }
      if (isRecord(parsed)) dispatch({ type: "event", ev: parsed });
    };
    es.onerror = () => {
      // CLOSED means the browser gave up (an HTTP error — the token was refused,
      // or CORS declined the origin); CONNECTING means it is retrying on its own.
      dispatch({ type: "connection", value: es.readyState === EventSource.CLOSED ? "lost" : "retrying" });
      // Diagnose on EVERY first error, not just the CLOSED ones. A REFUSED
      // connection (nothing listening on the port) leaves the stream in
      // CONNECTING and Chromium retries it forever — so keying the empty state
      // on CLOSED alone rendered a live-looking shell, with a Start button and a
      // full step rail, over a session that does not exist. That is the "never
      // look broken" rule failing in the direction that matters more: looking
      // FINE while being dead.
      //
      // EventSource exposes no status code, so one ordinary fetch asks the
      // question it cannot. A readable 403 (which the host deliberately sends
      // with CORS headers attached) means the link is wrong or expired; a thrown
      // fetch means nothing is listening. Two different sentences for the
      // operator, and only one of them is worth retrying.
      if (probed) return;
      probed = true;
      void fetch(`${wizardOrigin(target.port)}/app/health?t=${encodeURIComponent(target.token)}`)
        .then((res) => dispatch({ type: "failure", value: res.status === 403 ? "denied" : null }))
        .catch(() => dispatch({ type: "failure", value: "absent" }));
    };
    return () => {
      es.close();
      if (sourceRef.current === es) sourceRef.current = null;
    };
  }, [target, attempt]);

  const post = useCallback(
    async (path: string, body: unknown): Promise<Record<string, unknown>> => {
      if (!client) return {};
      try {
        const { status, json } = await client.post(path, body);
        // CORS is transport, the token is auth, and they fail independently: a
        // 403 from a perfectly good loopback origin means the link's token is
        // wrong or expired, which no amount of retrying will fix.
        if (status === 403) dispatch({ type: "failure", value: "denied" });
        if (typeof json.error === "string") dispatch({ type: "status", text: json.error, isError: true });
        return json;
      } catch (err) {
        // A transport failure here is the installer being gone, not a bug —
        // say which, in the operator's terms, and leave the page usable.
        dispatch({
          type: "status",
          text: `Could not reach the installer: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        });
        return {};
      }
    },
    [client],
  );

  const start = useCallback(
    async (run = "start") => {
      dispatch({ type: "starting" });
      dispatch({ type: "status", text: "Starting the setup assistant…" });
      await post("/start", { run });
    },
    [post],
  );

  const stop = useCallback(async () => {
    dispatch({ type: "stopping" });
    // The terminal state waits for {type:"stopped"} — the server confirms, the
    // page does not assume.
    await post("/stop", {});
  }, [post]);

  const answer = useCallback(
    async (card: Card & { kind: "question" }, picked: string[]) => {
      const value = picked.join(", ");
      dispatch({
        type: "settle",
        id: card.id,
        resolution: value,
        receipt: { label: card.header || card.question, value },
      });
      await post("/answer", { id: card.id, answer: value });
    },
    [post],
  );

  const decide = useCallback(
    async (id: string, allow: boolean) => {
      dispatch({
        type: "settle",
        id,
        resolution: allow ? COPY.resAllowed : COPY.resDenied,
        receipt: null,
      });
      // `always` is deliberately not sent: the affordance was removed in the
      // host's v0.4 and the field is accepted-and-ignored (PROTOCOL.md).
      await post("/decision", { id, allow });
    },
    [post],
  );

  const saveSecret = useCallback(
    async (id: string, name: string, action: "save" | "keep" | "skip", value?: string) => {
      const resolution =
        action === "keep" ? `${name} left as it is.` : action === "skip" ? `${name} skipped.` : `${name} saved to .env.local.`;
      dispatch({
        type: "settle",
        id,
        resolution,
        receipt: { label: name, value: action === "keep" ? "kept current" : action === "skip" ? "skipped" : "set" },
      });
      const out = await post("/secret", { id, action, value: action === "save" ? (value ?? "") : "" });
      // The one answer that is not the end of the story: the value turned up in
      // the file after this card was drawn, so the host refused the overwrite and
      // re-emits the card as a three-way. The incoming `secret` event reopens it.
      if (out.state === "exists") {
        dispatch({
          type: "status",
          text: `${name} already had a value — asking again below.`,
        });
      }
    },
    [post],
  );

  const message = useCallback(
    async (text: string, echo = true) => {
      if (echo) dispatch({ type: "say", text });
      await post("/message", { text });
    },
    [post],
  );

  const markActivityRead = useCallback(() => dispatch({ type: "read" }), []);
  const note = useCallback((label: string, value: string) => dispatch({ type: "receipt", label, value }), []);
  const setStatus = useCallback((text: string, isError?: boolean) => dispatch({ type: "status", text, isError }), []);
  const reconnect = useCallback(() => setAttempt((n) => n + 1), []);

  return {
    target,
    resolved,
    state,
    client,
    start,
    stop,
    answer,
    decide,
    saveSecret,
    message,
    markActivityRead,
    note,
    setStatus,
    reconnect,
  };
}
