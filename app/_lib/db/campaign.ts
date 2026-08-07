import { ensureDb, safeRowParse } from "./core";
import { DEFAULT_WORKSPACE_ID } from "./workspaces";

// ---- Campaign packs (Erika gap E1) -----------------------------------------

// One stored pack per (job, language) — the durable artifact behind the job
// posting modal's Campaign tab. `payload` is the campaign_cli pack verbatim
// (variants + warning codes + applyUrl); `source` records llm vs deterministic
// provenance so the UI can label a rule-based fallback honestly.
export type CampaignPackRecord = {
  jobId: string;
  lang: string;
  payload: unknown;
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
  db.prepare(
    `INSERT INTO campaign_packs (job_id, lang, payload_json, source, created_at, workspace_id)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(job_id, lang) DO UPDATE SET
       payload_json = excluded.payload_json,
       source = excluded.source,
       created_at = excluded.created_at
     WHERE campaign_packs.workspace_id = excluded.workspace_id`
  ).run(jobId, lang, JSON.stringify(payload), source, now, workspaceId);
  return { jobId, lang, payload, source, createdAt: now };
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
  const payload = safeRowParse<unknown>(row.payload_json, "getCampaignPack");
  if (payload === null) return null;
  return { jobId: row.job_id, lang: row.lang, payload, source: row.source, createdAt: row.created_at };
}
