import { ensureDb, safeRowParse } from "./core";
import { campaignPackSchema, type CampaignPack } from "../schemas";
import { DEFAULT_WORKSPACE_ID } from "./workspaces";

// ---- Campaign packs (Erika gap E1) -----------------------------------------

// One stored pack per (job, language, team) — the durable artifact behind the job
// posting modal's Campaign tab. `payload` is the campaign_cli pack verbatim
// (variants + warning codes + applyUrl); `source` records llm vs deterministic
// provenance so the UI can label a rule-based fallback honestly.
//
// The read side is VALIDATED (campaignPackSchema) — the write side is not, and
// deliberately: saveCampaignPack stores what campaign_cli produced, and refusing a
// pack at write time would throw away the only copy of a paid LLM run. A pack that
// cannot be read back is a decode failure the read reports, not a lost artifact.
export type CampaignPackRecord = {
  jobId: string;
  lang: string;
  payload: CampaignPack;
  source: string;
  createdAt: string;
};

export function saveCampaignPack(
  jobId: string,
  lang: string,
  payload: unknown,
  source: string,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): CampaignPackRecord {
  const db = ensureDb();
  const now = new Date().toISOString();
  // Target-less ON CONFLICT: the statement names no key, so it is valid against BOTH
  // key shapes — the widened PRIMARY KEY (job_id, lang, workspace_id) this schema boots
  // into, and the legacy (job_id, lang) an older image or a restored old dump carries
  // until the next boot widens it (core.ts widenCampaignPacksKey). `ON CONFLICT(job_id,
  // lang)` would throw against the widened key ("does not match any PRIMARY KEY").
  const res = db.prepare(
    `INSERT INTO campaign_packs (job_id, lang, payload_json, source, created_at, workspace_id)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT DO UPDATE SET
       payload_json = excluded.payload_json,
       source = excluded.source,
       created_at = excluded.created_at
     WHERE campaign_packs.workspace_id = excluded.workspace_id`
  ).run(jobId, lang, JSON.stringify(payload), source, now, workspaceId);
  // Under the widened key a second team's save is its own row, so a conflict can only be
  // a same-team regenerate — which the WHERE admits. The zero-change check stays as the
  // invariant it now is: it can only fire while the table still carries the LEGACY key
  // (a foreign row holding the (job_id, lang) slot), and then refusing loudly beats
  // returning a record for a pack that was never stored (the "never a green lie" rule —
  // the wait-or-leave path in campaign-run.ts promises the pack persists).
  if (res.changes === 0) {
    throw new Error(
      `Campaign pack for this role and language could not be saved — a conflicting record already holds that slot. Nothing was stored.`
    );
  }
  // The stored payload as the reader will see it. Cast rather than parsed for the
  // reason above: this is the artifact campaign_cli produced, and the caller already
  // holds it — re-validating here would only decide whether to LIE about the save.
  return { jobId, lang, payload: payload as CampaignPack, source, createdAt: now };
}

export function getCampaignPack(jobId: string, lang: string, workspaceId: string = DEFAULT_WORKSPACE_ID): CampaignPackRecord | null {
  const db = ensureDb();
  const row = db
    .prepare(
      `SELECT job_id, lang, payload_json, source, created_at FROM campaign_packs WHERE job_id = ? AND lang = ? AND workspace_id = ?`
    )
    .get(jobId, lang, workspaceId) as
    | { job_id: string; lang: string; payload_json: string; source: string; created_at: string }
    | undefined;
  if (!row) return null;
  // Behind a schema, like every other JSON column this repo decodes (intakes.ts is
  // the sibling shape). A pack that does not clear the floor the Campaign tab
  // dereferences reads as ABSENT — "no pack yet, generate one" — rather than
  // rendering `undefined` into ad copy. safeRowParse books the issue in the decode
  // ledger either way, so a corrupt column is visible rather than merely quiet.
  const payload = safeRowParse<CampaignPack>(row.payload_json, "getCampaignPack", `${jobId}:${lang}`, campaignPackSchema);
  if (payload === null) return null;
  return { jobId: row.job_id, lang: row.lang, payload, source: row.source, createdAt: row.created_at };
}
