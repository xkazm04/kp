import path from "node:path";
import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";

const DB_PATH = process.env.KP_DB_PATH ?? path.join(process.cwd(), "data", "kp.sqlite");

let _db: Database.Database | null = null;

function ensureDb(): Database.Database {
  if (_db) return _db;
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS analyses (
      slug TEXT PRIMARY KEY,
      candidate_label TEXT NOT NULL,
      jd_slug TEXT,
      score INTEGER,
      role_family TEXT,
      seniority TEXT,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_analyses_created_at
      ON analyses (created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_analyses_jd_slug
      ON analyses (jd_slug);

    CREATE TABLE IF NOT EXISTS jds (
      slug TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_jds_created_at
      ON jds (created_at DESC);

    CREATE TABLE IF NOT EXISTS gemini_cache (
      hash TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_gemini_cache_expires
      ON gemini_cache (expires_at);
  `);
  seedExampleJd(db);
  _db = db;
  return db;
}

// Drop a single example JD into the library on first init so the picker is
// not empty when a developer first opens the app. Idempotent: skipped on
// every subsequent boot.
const SEED_JD_SLUG = "example-ai-architect";
const SEED_JD_TITLE = "AI Architect / ML Engineer (part-time → core team) — K&P AI";
const SEED_JD_BODY = `Company: K&P AI s.r.o.
Role: AI Architect / ML Engineer (part-time → core team)
Location: Remote-friendly; Prague-based company
Employment: Part-time, ~10 hours/week; flexible start
Compensation: 10,000 CZK monthly initially + equity; progression to Head of AI

About the company
SaaS startup building AI tools that simplify data work and decision-making. Practical products addressing real problems — speed, clarity, usability over aesthetics. €250k+ investment, Web Summit selection. Core team of 5 spans web, product, marketing, development, and AI. A B2C AI architecture is already in place; you advance it further.

Key responsibilities
- Build on the existing B2C AI architecture
- Adapt and enhance the architecture for B2B use cases
- Refine B2C systems using production data
- Design and iterate AI pipelines (scoring, LLM, evaluation)
- Execute prompt engineering and improve output explainability
- Handle data tasks: scraping, structuring, validation
- Establish quality metrics and testing frameworks

Required skills
- AI / ML experience on real projects (not toy / coursework only)
- Understanding of AI architecture and end-to-end pipelines
- Python proficiency for data integration
- Foundation in embeddings, LLMs, and pipeline composition
- Product and business thinking
- Self-directed, ownership mindset
- Enjoyment of technical problem-solving

Nice to have
- Aspiration to lead AI / analytics teams in the future

Seniority: Mid-level to Senior
Growth path: potential advancement to Head of AI with team-building scope and international scaling.

Source: https://www.startupjobs.cz/nabidka/103717/ai-architect-ml-engineer-part-time-core-team`;

function seedExampleJd(db: Database.Database): void {
  const row = db.prepare(`SELECT 1 FROM jds WHERE slug = ?`).get(SEED_JD_SLUG);
  if (row) return;
  db.prepare(`INSERT INTO jds (slug, title, body, created_at) VALUES (?, ?, ?, ?)`).run(
    SEED_JD_SLUG,
    SEED_JD_TITLE,
    SEED_JD_BODY,
    new Date().toISOString()
  );
}

export type AnalysisRow = {
  slug: string;
  candidate_label: string;
  jd_slug: string | null;
  score: number | null;
  role_family: string | null;
  seniority: string | null;
  payload_json: string;
  created_at: string;
};

export type AnalysisSummary = Omit<AnalysisRow, "payload_json">;

export type JdRow = {
  slug: string;
  title: string;
  body: string;
  created_at: string;
};

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
function generateSlug(): string {
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

export type SaveAnalysisInput = {
  candidateLabel: string;
  jdSlug: string | null;
  score: number | null;
  roleFamily: string | null;
  seniority: string | null;
  payload: unknown;
};

export function saveAnalysis(input: SaveAnalysisInput): { slug: string; createdAt: string } {
  const db = ensureDb();
  const slug = generateSlug();
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO analyses
      (slug, candidate_label, jd_slug, score, role_family, seniority, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    slug,
    input.candidateLabel,
    input.jdSlug,
    input.score,
    input.roleFamily,
    input.seniority,
    JSON.stringify(input.payload),
    createdAt
  );
  return { slug, createdAt };
}

export function listAnalyses(limit = 100): AnalysisSummary[] {
  const db = ensureDb();
  const rows = db
    .prepare(
      `SELECT slug, candidate_label, jd_slug, score, role_family, seniority, created_at
       FROM analyses
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(limit) as AnalysisSummary[];
  return rows;
}

export function loadAnalysis(slug: string): { row: AnalysisRow; payload: unknown } | null {
  const db = ensureDb();
  const row = db
    .prepare(
      `SELECT slug, candidate_label, jd_slug, score, role_family, seniority, payload_json, created_at
       FROM analyses WHERE slug = ?`
    )
    .get(slug) as AnalysisRow | undefined;
  if (!row) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(row.payload_json);
  } catch {
    return null;
  }
  return { row, payload };
}

export type SaveJdInput = {
  title: string;
  body: string;
};

export function saveJd(input: SaveJdInput): { slug: string; createdAt: string } {
  const db = ensureDb();
  const slug = generateSlug();
  const createdAt = new Date().toISOString();
  db.prepare(`INSERT INTO jds (slug, title, body, created_at) VALUES (?, ?, ?, ?)`).run(
    slug,
    input.title,
    input.body,
    createdAt
  );
  return { slug, createdAt };
}

export function listJds(limit = 100): JdRow[] {
  const db = ensureDb();
  return db
    .prepare(`SELECT slug, title, body, created_at FROM jds ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as JdRow[];
}

export function loadJd(slug: string): JdRow | null {
  const db = ensureDb();
  const row = db
    .prepare(`SELECT slug, title, body, created_at FROM jds WHERE slug = ?`)
    .get(slug) as JdRow | undefined;
  return row ?? null;
}

type CacheRow = {
  hash: string;
  payload_json: string;
  prompt_version: string;
  expires_at: string;
};

export function lookupGeminiCache(hash: string, promptVersion: string): unknown | null {
  const db = ensureDb();
  const row = db
    .prepare(
      `SELECT hash, payload_json, prompt_version, expires_at
       FROM gemini_cache WHERE hash = ?`
    )
    .get(hash) as CacheRow | undefined;
  if (!row) return null;
  if (row.prompt_version !== promptVersion) return null;
  const expiresAt = Date.parse(row.expires_at);
  if (Number.isFinite(expiresAt) && expiresAt < Date.now()) return null;
  try {
    return JSON.parse(row.payload_json);
  } catch {
    return null;
  }
}

export function storeGeminiCache(
  hash: string,
  payload: unknown,
  promptVersion: string,
  ttlHours: number
): void {
  const db = ensureDb();
  const now = new Date();
  const expires = new Date(now.getTime() + ttlHours * 3600 * 1000);
  db.prepare(
    `INSERT INTO gemini_cache (hash, payload_json, prompt_version, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(hash) DO UPDATE SET
       payload_json = excluded.payload_json,
       prompt_version = excluded.prompt_version,
       created_at = excluded.created_at,
       expires_at = excluded.expires_at`
  ).run(hash, JSON.stringify(payload), promptVersion, now.toISOString(), expires.toISOString());
}

export function pruneGeminiCache(): number {
  const db = ensureDb();
  const result = db
    .prepare(`DELETE FROM gemini_cache WHERE expires_at < ?`)
    .run(new Date().toISOString());
  return Number(result.changes ?? 0);
}
