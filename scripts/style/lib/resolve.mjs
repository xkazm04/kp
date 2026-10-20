// Turn a targets.json entry into a concrete URL against one running server.
//
// Placeholders are resolved by the entry's own documented query, READ-ONLY, on the
// throwaway copy the server serves. A `seed` runs only when its query found
// nothing, and only against that throwaway copy — never the source database.

const SEED_SUBMISSION_ID = 'dsub-style-instruments-fixture';

/** Named seeds. Each writes the minimum into the throwaway DB and goes through the
 *  app's own API for anything that has to be signed or derived. */
const SEEDS = {
  async 'skill-profile'({ dbFile, baseUrl }) {
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(dbFile);
    try {
      const evaluation = {
        evaluation: { dimensionScores: { framing: 78, tooling: 71, judgment: 84, architecture: 66 }, confidence: 0.74 },
        transfer: { transferScore: 76 },
      };
      db.prepare(
        `INSERT OR IGNORE INTO dev_submissions (id, posting_id, candidate_ref, repo_ref, notes, contact, status, eval_json, transfer_score, received_at, workspace_id)
         VALUES (?, NULL, 'Style fixture', NULL, NULL, NULL, 'evaluated', ?, 76, '2026-09-01T09:00:00.000Z', 'workspace')`,
      ).run(SEED_SUBMISSION_ID, JSON.stringify(evaluation));
    } finally {
      db.close();
    }
    const res = await fetch(`${baseUrl}/api/devcase/skill-profile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: 'kp_entered=1' },
      body: JSON.stringify({ submissionId: SEED_SUBMISSION_ID }),
    });
    if (!res.ok) throw new Error(`seed skill-profile: POST /api/devcase/skill-profile answered ${res.status} ${await res.text()}`);
  },
};

async function queryOne(dbFile, sql) {
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(dbFile, { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare(sql).get();
    return row ? Object.values(row)[0] ?? null : null;
  } finally {
    db.close();
  }
}

/**
 * Resolve every {placeholder} in `target.path`. Returns { url, values, seeded }.
 * Throws with the query and the reason when a placeholder cannot be filled —
 * a surface that cannot be reached is a failed target, never a skipped one.
 */
export async function resolveTarget(name, target, { dbFile, baseUrl, dryRun = false }) {
  const values = {};
  let seeded = false;
  for (const key of [...target.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1])) {
    const spec = target.resolve?.[key];
    if (!spec?.sql) throw new Error(`${name}: path placeholder {${key}} has no resolve.${key}.sql`);
    let value = await queryOne(dbFile, spec.sql);
    if (value == null && target.seed && !dryRun) {
      const seed = SEEDS[target.seed];
      if (!seed) throw new Error(`${name}: unknown seed "${target.seed}"`);
      await seed({ dbFile, baseUrl });
      seeded = true;
      value = await queryOne(dbFile, spec.sql);
    }
    if (value == null) {
      if (dryRun && target.seed) { values[key] = `<minted at run time by seed "${target.seed}">`; continue; }
      throw new Error(`${name}: {${key}} resolved to nothing: ${spec.sql}`);
    }
    values[key] = String(value);
  }
  const path = target.path.replace(/\{(\w+)\}/g, (_m, k) => (values[k].startsWith('<') ? values[k] : encodeURIComponent(values[k])));
  return { url: `${baseUrl ?? ''}${path}`, path, values, seeded };
}

export const SEED_NAMES = Object.keys(SEEDS);
