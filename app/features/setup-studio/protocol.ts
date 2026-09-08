/*
 * The wire, as this page understands it.
 *
 * Every shape here is DECLARED by scripts/onboard-ui/PROTOCOL.md and produced by
 * a process this page does not own — a different origin, a different lifetime, a
 * version that may be older or newer than this file. So nothing is `as`-cast off
 * the wire: each event is read field by field through the small readers below,
 * an unrecognised `type` is ignored rather than rendered, and an added field is
 * simply not looked at. That is the tolerance the protocol asks for in writing
 * ("unknown event types are ignored"), and it is what lets the wizard server grow
 * `hello.self`, `hello.studio` and a richer rejoin payload without this page
 * needing to ship first.
 *
 * Pure by construction — no React, no DOM, no fetch. The session hook owns the
 * effects; this module owns the meaning.
 */

/* ── the fragment hand-off ──────────────────────────────────────────────── */

export type WizardTarget = { port: number; token: string };

/**
 * `#wizard=<port>&t=<token>` — a FRAGMENT, never a query string.
 *
 * The fragment is the whole reason this is safe: it is not sent to the server,
 * so the wizard token never enters this app's access log, its referrers, or a
 * cookie. It is parsed here, held in memory, and spent only against the wizard
 * server's own origin.
 *
 * Both halves are validated rather than trusted: a port outside 1–65535 or a
 * token outside the opaque-token charset yields `null`, which the page renders
 * as its calm empty state. A bad fragment must look like "no wizard", never like
 * a broken page.
 */
export function parseWizardTarget(hash: string): WizardTarget | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  const port = Number(params.get("wizard"));
  const token = params.get("t") ?? "";
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (!/^[A-Za-z0-9._~-]{1,256}$/.test(token)) return null;
  return { port, token };
}

/** The wizard server's origin. Loopback only — a fragment cannot name a host. */
export function wizardOrigin(port: number): string {
  return `http://localhost:${port}`;
}

/* ── field readers ──────────────────────────────────────────────────────── */

/** One frame off the wire, before it has been given a meaning. */
export type WireEvent = Record<string, unknown>;
type Json = WireEvent;

export function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}
function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/* ── the plan rail ──────────────────────────────────────────────────────── */

export type PlanStep = { id: string; label: string };

/** `/^[a-z0-9][a-z0-9-]{0,31}$/`, the id shape the host promises. */
const STEP_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

/**
 * `{type:"plan", steps:[{id,label}]}` → a rail, or `[]` for "not a plan".
 *
 * Mirrors the host's own parser: ids lowercased and shape-checked, duplicates
 * and malformed ids DROPPED rather than failing the whole rail, a missing label
 * falling back to the id, and the rail capped at 12. A plan that survives to
 * zero steps is not a plan, and the caller keeps the rail it already had.
 */
export function normalizePlan(raw: unknown): PlanStep[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: PlanStep[] = [];
  for (const entry of raw) {
    const record = typeof entry === "string" ? { id: entry, label: entry } : entry;
    if (!isRecord(record)) continue;
    const id = str(record.id).trim().toLowerCase();
    if (!STEP_ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: str(record.label).trim() || id });
    if (out.length >= 12) break;
  }
  return out;
}

/**
 * The rail a run gets before the agent declares one.
 *
 * Recon-first means the rail must not promise a pipeline nobody has decided on
 * yet: while `assess` is live and no plan has landed, the honest rail is "I am
 * looking, and a plan follows". The fixed list below is only for the runs that
 * move PAST assess without ever declaring a plan (a doctor pass, a single-group
 * run), which the protocol still guarantees emit the legacy fixed phase ids.
 */
export const FALLBACK_PHASES: readonly string[] = [
  "assess",
  "welcome",
  "mode",
  "checks",
  "capabilities",
  "boot",
  "voice",
  "done",
];

/* ── probes ─────────────────────────────────────────────────────────────── */

export type ProbeStatus = "ok" | "fail" | "warn" | "running";
export type ProbeRow = { name: string; status: ProbeStatus; detail: string };

export function coerceProbeStatus(value: unknown): ProbeStatus {
  const v = str(value).trim().toLowerCase();
  if (v === "ok" || v === "fail" || v === "warn" || v === "running") return v;
  // The host degrades an unknown status to `warn`; so does the page, rather than
  // inventing a green for a word it does not know.
  return "warn";
}

/** The one honest line the collapsed assessment leads with. */
export function assessmentHeadline(rows: readonly ProbeRow[]): string {
  const ok = rows.filter((r) => r.status === "ok").length;
  const bad = rows.filter((r) => r.status === "fail").length;
  const warn = rows.filter((r) => r.status === "warn").length;
  const parts = [`${ok} of ${rows.length} checks already good`];
  if (bad) parts.push(`${bad} not working`);
  if (warn) parts.push(`${warn} worth a look`);
  return `Found: ${parts.join(" · ")}`;
}

/* ── cards ──────────────────────────────────────────────────────────────── */

export type QuestionOption = { label: string; description: string | null };

export type Card =
  | {
      kind: "question";
      id: string;
      header: string;
      question: string;
      options: QuestionOption[];
      multiSelect: boolean;
      /** The agent's own wording for what the assessment found, when it sent one. */
      summary: string | null;
    }
  | { kind: "secret"; id: string; name: string; note: string | null; alreadySet: boolean }
  | { kind: "permission"; id: string; tool: string; command: string; description: string | null };

/** The journey card is the pivot of a run; it is identified by its header. */
export function isJourneyCard(card: Card): boolean {
  return card.kind === "question" && card.header.trim().toLowerCase() === "journey";
}

function readQuestion(ev: Json): Card | null {
  const id = str(ev.id);
  if (!id) return null;
  const rawOptions = Array.isArray(ev.options) ? ev.options : [];
  return {
    kind: "question",
    id,
    header: str(ev.header) || "Choice",
    question: str(ev.question),
    options: rawOptions.filter(isRecord).map((o) => ({
      label: str(o.label),
      description: str(o.description) || null,
    })),
    multiSelect: ev.multiSelect === true,
    summary: str(ev.summary) || null,
  };
}

function readSecret(ev: Json): Card | null {
  const id = str(ev.id);
  if (!id) return null;
  return {
    kind: "secret",
    id,
    name: str(ev.name) || id,
    note: str(ev.note) || null,
    alreadySet: ev.alreadySet === true,
  };
}

function readPermission(ev: Json): Card | null {
  const id = str(ev.id);
  if (!id) return null;
  return {
    kind: "permission",
    id,
    tool: str(ev.tool) || "Command",
    command: str(ev.command),
    description: str(ev.description) || null,
  };
}

/** One card off any of the three card events, or null when it is not one. */
export function readCard(ev: Json): Card | null {
  const type = str(ev.type);
  if (type === "question") return readQuestion(ev);
  if (type === "secret") return readSecret(ev);
  if (type === "permission") return readPermission(ev);
  return null;
}

/* ── notices ────────────────────────────────────────────────────────────── */

export type NoticeKind = "auto-allowed" | "repeat-allowed" | "unrequested-run" | "other";

export function coerceNoticeKind(value: unknown): NoticeKind {
  const v = str(value).trim();
  if (v === "auto-allowed" || v === "repeat-allowed" || v === "unrequested-run") return v;
  return "other";
}

/* ── enforcement ────────────────────────────────────────────────────────── */

export type Enforcement = { mode: string | null; skipFlagBlocked: boolean; autoAllowPolicy: string | null };

/**
 * Read only. The reassurance line is shown ONLY when the host affirms
 * `skipFlagBlocked` — an absent field is an older host, and a promise this page
 * cannot verify is worse than silence on a screen whose whole pitch is that
 * commands ask first.
 */
export function readEnforcement(raw: unknown): Enforcement | null {
  if (!isRecord(raw)) return null;
  return {
    mode: str(raw.mode) || null,
    skipFlagBlocked: raw.skipFlagBlocked === true,
    autoAllowPolicy: str(raw.autoAllowPolicy) || null,
  };
}

/* ── the capability matrix ──────────────────────────────────────────────── */

export type MatrixState = "on" | "degraded" | "hidden" | "off";
export type MatrixRow = {
  name: string;
  stateText: string;
  state: MatrixState;
  extra: { key: string; value: string }[];
};
export type Matrix = { rows: MatrixRow[]; prose: string | null };

const STATE_WORDS: readonly (readonly [MatrixState, RegExp])[] = [
  ["on", /^(on|works|ready|sending|enabled|configured|yes)\b/i],
  // "open (dev)" is DEGRADED, not off: auth genuinely works, with a caveat the
  // operator must see. Painting a documented dev-mode default coral would call
  // it a failure.
  ["degraded", /^(degraded|limited|deterministic|queued|fallback|link-based|partial|queued-only|open)\b/i],
  ["hidden", /^(hidden|not shown)\b/i],
  ["off", /^(off|none|not configured|skipped|later|no|absent|disabled)\b/i],
];

export function classifyMatrixState(text: string): MatrixState {
  const t = text.trim();
  for (const [kind, re] of STATE_WORDS) if (re.test(t)) return kind;
  return "off";
}

function tableCells(row: string): string[] {
  return row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
}

/**
 * The `matrix` event is markdown written by the agent, so the state column is
 * DETECTED rather than assumed: whichever column past the first most often opens
 * with a state word wins. (`config.md`'s own matrix puts it at 1, but the table
 * is the model's prose, not a fixed schema.) A payload with no table at all
 * keeps its prose instead of losing it.
 */
export function parseMatrix(md: string): Matrix {
  const lines = md.replace(/\r/g, "").split("\n");
  let headIndex = -1;
  for (let i = 0; i < lines.length - 1; i++) {
    if (/^\s*\|/.test(lines[i]) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      headIndex = i;
      break;
    }
  }
  if (headIndex < 0) return { rows: [], prose: md.trim() || null };

  const head = tableCells(lines[headIndex]);
  const body: string[][] = [];
  for (let j = headIndex + 2; j < lines.length && /^\s*\|/.test(lines[j]); j++) body.push(tableCells(lines[j]));

  let stateCol = 1;
  let best = -1;
  for (let c = 1; c < head.length; c++) {
    const hits = body.filter((r) => STATE_WORDS.some(([, re]) => re.test((r[c] ?? "").trim()))).length;
    if (hits > best) {
      best = hits;
      stateCol = c;
    }
  }

  const rows: MatrixRow[] = [];
  for (const r of body) {
    const name = (r[0] ?? "").trim();
    if (!name) continue;
    const stateText = (r[stateCol] ?? "").trim();
    const extra: { key: string; value: string }[] = [];
    for (let c = 1; c < head.length; c++) {
      if (c === stateCol) continue;
      const value = (r[c] ?? "").trim();
      if (value && value !== "—" && value !== "-") extra.push({ key: head[c] ?? "", value });
    }
    rows.push({ name, stateText: stateText || "off", state: classifyMatrixState(stateText), extra });
  }
  return { rows, prose: null };
}

/** Strip the emphasis markers a matrix cell may carry, for a button label. */
export function plainName(name: string): string {
  return name.replace(/[*`]/g, "").trim();
}

/* ── the voice panel ────────────────────────────────────────────────────── */

export type TtsVoice = { id: string; name: string; language: string | null };
export type TtsProvider = {
  id: string;
  name: string;
  state: string;
  reason: string | null;
  ready: boolean;
  voices: TtsVoice[];
  languages: string | null;
};
export type TtsPayload = { providers: TtsProvider[]; preferred: string | null; allowed: string[] | null };

function pick(source: Json | null, keys: readonly string[]): string | null {
  if (!source) return null;
  for (const k of keys) {
    const v = source[k];
    if (typeof v === "string" && v !== "") return v;
    if (typeof v === "number") return String(v);
  }
  return null;
}

/**
 * `GET /app/tts` is a PASSTHROUGH of the app's own `/api/tts`, relayed by a host
 * that does not interpret it — so every field is probed at runtime, never
 * assumed. A provider whose shape is not understood is still listed, with
 * whatever state word it did carry: an honest "we don't know" beats a
 * fabricated green on a screen the operator is about to trust.
 */
export function normalizeTts(payload: unknown): TtsPayload {
  if (!isRecord(payload)) return { providers: [], preferred: null, allowed: null };
  let raw: unknown = payload.providers ?? payload;
  if (isRecord(raw)) {
    raw = Object.entries(raw).map(([k, v]) => (isRecord(v) ? { id: k, ...v } : { id: k, state: v }));
  }
  const list = Array.isArray(raw) ? raw : [];
  const providers: TtsProvider[] = [];
  for (const entry of list) {
    const p: Json = typeof entry === "string" ? { id: entry } : isRecord(entry) ? entry : {};
    const probe = isRecord(p.probe) ? p.probe : null;
    const id = pick(p, ["id", "provider", "key", "name"]) ?? "provider";
    const state = (pick(probe, ["state", "status"]) ?? pick(p, ["state", "status"]) ?? "unknown").toLowerCase();
    const probeVoices = probe && Array.isArray(probe.voices) ? probe.voices : [];
    const rawVoices: unknown[] = Array.isArray(p.voices) ? p.voices : probeVoices;
    const rawLanguages = p.languages ?? p.language ?? p.locales ?? (probe ? probe.languages : undefined);
    providers.push({
      id,
      name: pick(p, ["name", "label", "title"]) ?? id,
      state,
      reason: pick(probe, ["reason", "detail", "message", "error", "hint"]) ?? pick(p, ["reason", "detail", "message", "error", "hint"]),
      ready: state === "ready" || state === "ok" || p.ready === true,
      voices: rawVoices
        .map((v): TtsVoice => {
          const rec: Json = typeof v === "string" ? { id: v, name: v } : isRecord(v) ? v : {};
          return {
            id: pick(rec, ["id", "voiceId", "voice_id", "key", "name"]) ?? "",
            name: pick(rec, ["name", "label", "title", "id", "voiceId"]) ?? "",
            language: pick(rec, ["language", "lang", "locale"]),
          };
        })
        .filter((v) => v.id !== ""),
      languages: Array.isArray(rawLanguages)
        ? rawLanguages.filter((l): l is string => typeof l === "string").join(", ") || null
        : typeof rawLanguages === "string"
          ? rawLanguages
          : null,
    });
  }
  const allowed = Array.isArray(payload.allowed)
    ? payload.allowed.filter((a): a is string => typeof a === "string")
    : null;
  return {
    providers,
    preferred: typeof payload.preferred === "string" ? payload.preferred : null,
    allowed: allowed && allowed.length ? allowed : null,
  };
}

/* ── rejoin ─────────────────────────────────────────────────────────────── */

export type HelloPayload = {
  repo: string | null;
  envFileExists: boolean | null;
  running: boolean;
  phase: string | null;
  plan: PlanStep[];
  appPort: number | null;
  enforcement: Enforcement | null;
  /** The wizard server's OWN bound port. Read for the record and deliberately
   *  not acted on: this page already knows which port it connected to (the
   *  fragment named it), and `self.port` exists so the STANDALONE page can build
   *  the hand-off URL after an `EADDRINUSE` retry moved the server. */
  selfPort: number | null;
  /** Every replayed event, VERBATIM — merged across all of the replay block's
   *  lists and sorted by `seq`. Feed these through the LIVE handler. */
  replay: WireEvent[];
  /** The last status line. Prose, not an event: it carries no `seq`. */
  replayStatus: string | null;
  /** The final matrix markdown. Also not an event — guard it on its content. */
  replayMatrix: string | null;
};

function seqOf(ev: Json): number {
  return typeof ev.seq === "number" && Number.isFinite(ev.seq) ? ev.seq : -1;
}

/**
 * The rejoin lists, in the order the contract names them. They are grouped for
 * readability and they INTERLEAVE in time, which is the whole reason this
 * function exists.
 */
const REPLAY_LISTS = ["probes", "narration", "notices", "cards"] as const;

/**
 * `hello` — the only event with no `seq`, and the whole of the rejoin.
 *
 * The load-bearing rule, and it is not obvious: **merge every replay list and
 * sort by `seq` before rendering anything.** The lists are grouped by kind but
 * the stream they came from was not — a `narration` block is emitted BETWEEN two
 * `probe` markers of one assistant message — so walking the groups one after the
 * other runs time backwards, and the "drop anything at or below the highest seq
 * I have seen" guard (which is what makes an EventSource auto-reconnect
 * idempotent instead of a double render) then eats the prose whose seq the
 * probes have already sailed past. The seam's own drivers measured exactly that.
 *
 * Everything is optional. A host that sends no `replay` block at all produces an
 * empty replay, which is precisely the state a first connect is in — so the
 * fresh-connect path and the rejoin path are the same code with different
 * amounts of history, not two renderers.
 */
export function readHello(ev: Json): HelloPayload {
  const replay = isRecord(ev.replay) ? ev.replay : null;
  const merged: WireEvent[] = [];
  for (const key of REPLAY_LISTS) {
    const list = replay && Array.isArray(replay[key]) ? replay[key] : [];
    for (const entry of list) if (isRecord(entry)) merged.push(entry);
  }
  // `terminal` IS an event (done / stopped / error) and carries a seq like any
  // other, so it sorts into place rather than being appended blindly — a face
  // that joined after the run ended renders its terminal panel from here.
  if (replay && isRecord(replay.terminal)) merged.push(replay.terminal);
  merged.sort((a, b) => seqOf(a) - seqOf(b));

  return {
    repo: str(ev.repo) || null,
    envFileExists: typeof ev.envFileExists === "boolean" ? ev.envFileExists : null,
    running: ev.running === true,
    phase: str(ev.phase) || null,
    plan: normalizePlan(ev.plan),
    appPort: num(ev.appPort),
    enforcement: readEnforcement(ev.enforcement),
    selfPort: isRecord(ev.self) ? num(ev.self.port) : null,
    replay: merged,
    replayStatus: replay ? str(replay.status) || null : null,
    replayMatrix: replay && typeof replay.matrix === "string" && replay.matrix ? replay.matrix : null,
  };
}

/* ── resolved ───────────────────────────────────────────────────────────── */

export type ResolvedOutcome =
  | "answered"
  | "saved"
  | "kept"
  | "skipped"
  | "allowed"
  | "declined"
  | "withdrawn"
  /** Not on the wire — where an outcome word this page does not know lands. */
  | "settled";

export type Resolved = {
  id: string;
  kind: "question" | "secret" | "permission" | null;
  outcome: ResolvedOutcome;
  /** Present only for a question: the label(s) the operator picked. */
  answer: string | null;
};

const OUTCOMES: readonly ResolvedOutcome[] = [
  "answered",
  "saved",
  "kept",
  "skipped",
  "allowed",
  "declined",
  "withdrawn",
];

/**
 * `{type:"resolved", …}` — a card is no longer open, and it may have been
 * answered on ANOTHER face. Two faces watch one session (the standalone page
 * stays open behind the hand-off tab), the decision has always been server-side,
 * and this is the event that says so — without it the face that did not answer
 * is left holding a live-looking control nobody is listening to.
 *
 * An outcome word this page does not recognise degrades to `settled` rather than
 * being dropped: the card really is closed either way, and leaving it open
 * because the vocabulary grew is the one failure that matters here.
 */
export function readResolved(ev: Json): Resolved | null {
  const id = str(ev.id);
  if (!id) return null;
  const kindRaw = str(ev.kind);
  const outcomeRaw = str(ev.outcome) as ResolvedOutcome;
  const answer = Array.isArray(ev.answer)
    ? ev.answer.filter((a): a is string => typeof a === "string").join(", ")
    : str(ev.answer);
  return {
    id,
    kind: kindRaw === "question" || kindRaw === "secret" || kindRaw === "permission" ? kindRaw : null,
    outcome: OUTCOMES.includes(outcomeRaw) ? outcomeRaw : "settled",
    answer: answer || null,
  };
}
