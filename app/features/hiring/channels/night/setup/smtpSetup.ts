/*
 * The SMTP sender's setup, as decisions (pure; pinned by smtpSetup.test.ts). The card (SetupSmtp)
 * and its hook only paint what these return:
 *
 *  - the read: GET /api/comms/smtp -> state, or null while unknown (never a fabricated "off");
 *  - the save body: a preset sends no host/port/security (the server fills them), the password
 *    only when typed (omitted = keep), the version only when it was READ;
 *  - the test answer: `sent` only when the server said ok (250 after DATA); a failure carries the
 *    stage and the server's own code and text; a refusal is about the caller, not the server.
 */

export type SmtpPresetId = "gmail" | "seznam" | "office365" | "custom";
export const SMTP_PRESET_IDS: readonly SmtpPresetId[] = ["gmail", "seznam", "office365", "custom"];
export type SmtpSecurityId = "tls" | "starttls";
export type SmtpHealthWord = "configured" | "unconfigured" | "unreadable";
export type SmtpActive = "relay" | "smtp" | "none";

export type SmtpAttemptRow = {
  at: string;
  kind: string;
  to: string;
  outcome: "sent" | "retry" | "failed" | "refused";
  stage: string | null;
  code: number | null;
  text: string;
};
export type SmtpSuppressedRow = { address: string; code: number | null; text: string; at: string };

export type SmtpState = {
  preset: SmtpPresetId | null;
  host: string;
  port: number | null;
  security: SmtpSecurityId | null;
  address: string;
  fromName: string;
  hasPassword: boolean;
  version: number;
  health: SmtpHealthWord;
  active: SmtpActive;
  attempts: SmtpAttemptRow[];
  suppressed: SmtpSuppressedRow[];
};

const isPreset = (v: unknown): v is SmtpPresetId => typeof v === "string" && (SMTP_PRESET_IDS as readonly string[]).includes(v);
const OUTCOMES = ["sent", "retry", "failed", "refused"];

/** One GET /api/comms/smtp body -> the state, or null when it carries no config. */
export function parseSmtpBody(body: unknown): SmtpState | null {
  const d = body as {
    config?: {
      preset?: unknown; host?: string | null; port?: number | null; security?: unknown; address?: string | null; fromName?: string | null;
      hasPassword?: boolean; version?: number; attempts?: unknown; suppressed?: unknown;
    };
    smtp?: unknown;
    active?: unknown;
  } | null;
  if (!d?.config) return null;
  const c = d.config;
  const attempts = Array.isArray(c.attempts)
    ? (c.attempts as SmtpAttemptRow[]).filter((a) => a && typeof a.to === "string" && OUTCOMES.includes(a.outcome))
    : [];
  const suppressed = Array.isArray(c.suppressed) ? (c.suppressed as SmtpSuppressedRow[]).filter((s) => s && typeof s.address === "string") : [];
  return {
    preset: isPreset(c.preset) ? c.preset : null,
    host: c.host ?? "",
    port: typeof c.port === "number" ? c.port : null,
    security: c.security === "tls" || c.security === "starttls" ? c.security : null,
    address: c.address ?? "",
    fromName: c.fromName ?? "",
    hasPassword: Boolean(c.hasPassword),
    version: c.version ?? 0,
    health: d.smtp === "configured" || d.smtp === "unreadable" ? d.smtp : "unconfigured",
    active: d.active === "relay" || d.active === "smtp" ? d.active : "none",
    attempts,
    suppressed,
  };
}

export type SmtpForm = {
  preset: SmtpPresetId;
  address: string;
  fromName: string;
  password: string;
  host: string;
  port: string;
  security: SmtpSecurityId;
};

/** The form as the stored state seeds it (Gmail when nothing is stored: the commonest mailbox). */
export function smtpFormFrom(state: SmtpState | null): SmtpForm {
  return {
    preset: state?.preset ?? "gmail",
    address: state?.address ?? "",
    fromName: state?.fromName ?? "",
    password: "",
    host: state?.preset === "custom" ? state.host : "",
    port: state?.preset === "custom" && state.port ? String(state.port) : "587",
    security: state?.preset === "custom" && state.security ? state.security : "starttls",
  };
}

/** The form differs from what is stored. */
export function smtpDirty(state: SmtpState | null, form: SmtpForm): boolean {
  if (form.password !== "") return true;
  const seed = smtpFormFrom(state);
  if (form.preset !== seed.preset || form.address.trim() !== seed.address || form.fromName.trim() !== seed.fromName) return true;
  return form.preset === "custom" && (form.host.trim() !== seed.host || form.port.trim() !== seed.port || form.security !== seed.security);
}

/** Save may run: not busy, an address typed, and a password stored or typed. */
export function canSaveSmtp(state: SmtpState | null, form: SmtpForm, busy: boolean): boolean {
  if (busy || form.address.trim() === "") return false;
  if (form.preset === "custom" && (form.host.trim() === "" || form.port.trim() === "")) return false;
  return form.password !== "" || Boolean(state?.hasPassword);
}

export type SmtpSaveBody = {
  preset: SmtpPresetId;
  address: string;
  fromName: string;
  password?: string;
  host?: string;
  port?: number;
  security?: SmtpSecurityId;
  expectedVersion?: number;
};

export function smtpSaveBody(state: SmtpState | null, form: SmtpForm): SmtpSaveBody {
  const body: SmtpSaveBody = { preset: form.preset, address: form.address.trim(), fromName: form.fromName.trim() };
  if (form.password !== "") body.password = form.password;
  if (form.preset === "custom") {
    body.host = form.host.trim();
    body.port = Number(form.port.trim());
    body.security = form.security;
  }
  if (state) body.expectedVersion = state.version;
  return body;
}

export type SmtpTestGate = "ok" | "busy" | "noSender" | "unreadable" | "unsaved";

export function smtpTestGate(state: SmtpState | null, dirty: boolean, busy: boolean): SmtpTestGate {
  if (busy) return "busy";
  if (state?.health === "unreadable") return "unreadable";
  if (state?.health !== "configured") return "noSender";
  return dirty ? "unsaved" : "ok";
}

type Coded = { code?: string | null };

export type SmtpTest =
  | { kind: "sent"; to: string; code: number }
  | { kind: "failed"; to: string; stage: string; code: number | null; text: string }
  | { kind: "sealed" }
  | { kind: "unconfigured" }
  | { kind: "unreadable" }
  | { kind: "refused"; body: Coded; status?: number };

/** One POST /api/comms/smtp/test answer (null = the request never completed). */
export function smtpTestOutcome(body: unknown, http?: number): SmtpTest {
  const d = body && typeof body === "object"
    ? (body as { ok?: boolean; to?: string; code?: unknown; stage?: string; text?: string; sealed?: boolean; reason?: string })
    : null;
  if (d === null) return { kind: "failed", to: "", stage: "connect", code: null, text: "network" };
  if (d.ok === true) return { kind: "sent", to: d.to ?? "", code: typeof d.code === "number" ? d.code : 250 };
  if (typeof d.code === "string") return http ? { kind: "refused", body: { code: d.code }, status: http } : { kind: "refused", body: { code: d.code } };
  if (d.sealed) return { kind: "sealed" };
  if (d.reason === "unconfigured") return { kind: "unconfigured" };
  if (d.reason === "unreadable") return { kind: "unreadable" };
  return { kind: "failed", to: d.to ?? "", stage: d.stage ?? "connect", code: typeof d.code === "number" ? d.code : null, text: d.text ?? "" };
}

/** Protocol names for the stage a reply came at. Not translated: they are SMTP's own words. */
export const SMTP_STAGE_LABEL: Record<string, string> = {
  connect: "connect",
  greeting: "greeting",
  ehlo: "EHLO",
  starttls: "STARTTLS",
  auth: "AUTH",
  mail: "MAIL FROM",
  rcpt: "RCPT TO",
  data: "DATA",
  quit: "QUIT",
};

export function smtpStageLabel(stage: string | null): string {
  return stage ? (SMTP_STAGE_LABEL[stage] ?? stage) : "";
}

/** How many recent attempts the card lists. */
export const SMTP_RECENT_SHOWN = 5;
