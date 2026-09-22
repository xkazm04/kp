// PULL-SOURCE FORM — the pure half of ChannelsReceiverPullCard.
//
// PATCH /api/channels/webhooks is the pull write (org:manage + per-IP limiter). Its
// secret field follows the repo's stored-credential contract (db/channels.ts
// setChannelPull, the relay and edge cards):
//   • pullSecret omitted → keep the stored bearer
//   • pullSecret ""      → clear it
//   • any other string   → replace it (encrypted at rest)
// A null/blank pullUrl DISABLES pulling and clears the source cursor, so a blank save
// is only legitimate once the stored record is KNOWN — the same
// blankSaveOnUnknownConfig guard ChannelsEdgeCard and ChannelsRelayConfigCard carry.

export type PullRecord = { pullUrl: string | null; hasPullSecret: boolean };
export type PullFields = { url: string; secret: string; clearSecret: boolean };
export type PullPatchBody = { token: string; pullUrl: string | null; pullSecret?: string };

export function pullPatchBody(token: string, fields: PullFields): PullPatchBody {
  const url = fields.url.trim();
  const body: PullPatchBody = { token, pullUrl: url === "" ? null : url };
  if (fields.secret !== "") body.pullSecret = fields.secret;
  else if (fields.clearSecret) body.pullSecret = "";
  return body;
}

/** Whether Save may run. `record` is null while the receivers list is unread. */
export function canSavePull(record: PullRecord | null, fields: PullFields, busy = false): boolean {
  if (busy) return false;
  const url = fields.url.trim();
  if (record === null) return url !== "";
  const urlChanged = url !== (record.pullUrl ?? "");
  const secretChanged = fields.secret !== "" || (fields.clearSecret && record.hasPullSecret);
  return urlChanged || secretChanged;
}

export type PullOutcome<P = unknown> = { ok: true; pull: P } | { ok: false; code: string | null };

/** Read a PATCH answer. A refusal keeps ONLY its machine code — the body's English
 *  `error` never leaves this function, so the caller can only localize it through
 *  useErrorMessage. A 200 without the `{ pull }` envelope is not a save. */
export function interpretPullResponse(status: number, body: unknown): PullOutcome {
  const b = body && typeof body === "object" ? (body as { pull?: unknown; code?: unknown }) : null;
  if (status >= 200 && status < 300 && b && b.pull && typeof b.pull === "object") return { ok: true, pull: b.pull };
  if (status >= 200 && status < 300) return { ok: false, code: null };
  return { ok: false, code: typeof b?.code === "string" ? b.code : null };
}
