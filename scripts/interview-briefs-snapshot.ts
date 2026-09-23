// The voice-interviewer eval's brief snapshot — a stored DERIVATION of the production
// interviewer briefs, not a copy of them.
//
// pipeline/jobfit/eval/interview_eval.py tests the brief the product ships. It used to do
// that through a hand-kept Python port of the prompt text (drift-guarded by a substring
// test) plus two node subprocess bridges that fell back silently — to the port, and for a
// `grounded` scenario to the DEFAULT brief while the row stayed labelled grounded. Now the
// production builders render every kind ONCE here, with a sentinel where the role goes,
// and the result is committed as pipeline/jobfit/eval/interview_briefs.json. Python only
// ever reads that file and substitutes the role; nothing spawns node.
//
//   npm run interview:briefs     # regenerate after any interviewer-brief copy change
//
// app/_lib/voice/interview-brief-snapshot.test.ts (in `npm run test:unit`) re-renders and
// compares, and proves the substitution faithful by rendering real roles directly — so a
// copy change that forgets to regenerate fails there, naming the kind and this command.
//
// Every builder falls back when the role is empty (`opts.role || "<fallback>"`), which a
// literal replace cannot reproduce. So each kind also records its `fallbackRole`, found by
// rendering once with '' and solving for the string that stands where the sentinel stood;
// Python substitutes it when a scenario has no role line.
//
// `grounded` is composeBrief via the real buildGroundedInterview(entryId): it needs a
// pipeline entry and a prep pack, so it seeds a fixture into the database at KP_DB_PATH.
// The CLI below always points that at a throwaway directory; an in-process caller (the
// unit test) must have done the same before this module touches the DB.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const BRIEF_SNAPSHOT_SCHEMA = 1;
export const BRIEF_SNAPSHOT_PATH = "pipeline/jobfit/eval/interview_briefs.json";
export const REGENERATE_COMMAND = "npm run interview:briefs";
/** Stands where the role line (default/student/case) or the job title (grounded) goes. */
export const ROLE_SENTINEL = "{{ROLE}}";
export const BRIEF_KINDS = ["default", "student", "case", "grounded"] as const;
export type BriefKind = (typeof BRIEF_KINDS)[number];

export type BriefTemplate = { template: string; fallbackRole: string };
export type BriefSnapshot = {
  schema: number;
  sentinel: string;
  regenerate: string;
  kinds: Record<BriefKind, BriefTemplate>;
};

// The grounded fixture: the shape interview-prep-run produces (topic / min window / goal /
// questions / optional follow-up). Same content as scripts/interview-brief-grounded.ts.
export const GROUNDED_FIXTURE_CHRONOLOGY = [
  {
    fromMin: 0, toMin: 5, topic: "Recent backend ownership",
    goal: "Establish what they actually built and owned end to end.",
    questions: [
      "Walk me through the most complex service you owned end to end.",
      "What was genuinely your decision versus the team's?",
    ],
  },
  {
    fromMin: 5, toMin: 12, topic: "Design trade-offs",
    goal: "Probe the why behind the what — reasoning over recall.",
    questions: ["Why that datastore over the alternatives?", "What breaks first under 10x load?"],
    followUp: "Where did that design bite you later, and what did you change?",
  },
  {
    fromMin: 12, toMin: 18, topic: "Incidents & recovery",
    goal: "How they behave when production breaks — the best ramp-up predictor.",
    questions: ["Tell me about a production incident you led. What was the loop from alert to fix?"],
  },
  {
    fromMin: 18, toMin: 22, topic: "Direction & their questions",
    goal: "Intrinsic motivation and what they want next.",
    questions: ["What kind of problems do you want to be working on a year from now?"],
  },
];

let groundedSeq = 0;

/** The REAL grounded prep-chronology brief for `title`, through buildGroundedInterview over
 *  a freshly seeded fixture entry (a non-early-career archetype and a jobId with no job row,
 *  so the prep-chronology branch runs with the default company). The entry id is returned
 *  only so a test can prove it never reaches the brief. */
export async function renderGrounded(
  title: string,
  opts: { candidateLabel?: string; chronology?: unknown[] } = {},
): Promise<{ brief: string; runOfShow: string[]; durationMin: number; entryId: string }> {
  if (!process.env.KP_DB_PATH) {
    throw new Error("renderGrounded seeds a fixture entry: point KP_DB_PATH at a throwaway database first");
  }
  const { createPipelineEntry } = await import("@/app/_lib/db/pipeline");
  const { saveInterviewPrep } = await import("@/app/_lib/interview-prep");
  const { buildGroundedInterview } = await import("@/app/_lib/interview-run");
  const candidateLabel = opts.candidateLabel ?? "Candidate";
  groundedSeq += 1;
  // A distinct candidate per render: an entry id is `m-<candidate>-<job>`, and a re-add of
  // the same pair would hand back the FIRST render's entry (and its title).
  const { entry } = createPipelineEntry({
    candidateId: `eval-cand-grounded-${groundedSeq}`,
    candidateLabel,
    archetype: "bau",
    jobId: "eval-fixture-role",
    jobTitle: title,
  });
  saveInterviewPrep(entry.id, candidateLabel, title, {
    scenario: "Grounded senior screen (eval fixture)",
    durationMin: 22,
    focusAreas: ["backend depth", "system design", "incident response"],
    chronology: opts.chronology ?? GROUNDED_FIXTURE_CHRONOLOGY,
  });
  const out = await buildGroundedInterview(entry.id);
  return { brief: out.instructions, runOfShow: out.runOfShow, durationMin: out.durationMin, entryId: entry.id };
}

/** One kind's brief for `role`, through the production builder. */
export async function renderKind(
  kind: BriefKind,
  role: string,
  opts: { company?: string | null; candidateLabel?: string | null; durationMin?: number | null } = {},
): Promise<string> {
  if (kind === "grounded") return (await renderGrounded(role, { candidateLabel: opts.candidateLabel ?? undefined })).brief;
  if (kind === "student" || kind === "case") {
    const si = await import("@/app/_lib/student-interview");
    const o = { roleLine: role, company: opts.company ?? null, candidateLabel: opts.candidateLabel ?? null };
    return kind === "student"
      ? si.studentInterviewerInstructions(o)
      : si.caseGroundedInterviewerInstructions(si.DEMO_CASE_SCENARIO, o);
  }
  const { defaultInterviewerInstructions } = await import("@/app/_lib/voice/index");
  return defaultInterviewerInstructions({ role, durationMin: opts.durationMin ?? null });
}

/** The role substitution Python performs: every sentinel becomes `role`, or the recorded
 *  fallback when the role is empty (the builders' own `role || <fallback>`). */
export function substituteRole(template: string, role: string, fallbackRole: string): string {
  return template.split(ROLE_SENTINEL).join(role || fallbackRole);
}

/** Solve for the string the builder put where the sentinel stood when rendered with ''. */
export function deriveFallback(kind: string, template: string, emptyRender: string): string {
  const parts = template.split(ROLE_SENTINEL);
  const slots = parts.length - 1;
  if (slots < 1) throw new Error(`${kind}: the sentinel never reached the brief, so the role is not substitutable`);
  const fixed = parts.reduce((n, p) => n + p.length, 0);
  const width = (emptyRender.length - fixed) / slots;
  const fallback = Number.isInteger(width) && width >= 0 ? emptyRender.slice(parts[0].length, parts[0].length + width) : "";
  if (!fallback || substituteRole(template, "", fallback) !== emptyRender) {
    throw new Error(
      `${kind}: the empty-role brief is not the sentinel template with one fallback substituted — ` +
        "the builder does more than `role || <fallback>`, and the snapshot cannot represent it",
    );
  }
  return fallback;
}

export async function renderBriefSnapshot(): Promise<BriefSnapshot> {
  const kinds = {} as Record<BriefKind, BriefTemplate>;
  for (const kind of BRIEF_KINDS) {
    const template = await renderKind(kind, ROLE_SENTINEL);
    const fallbackRole = deriveFallback(kind, template, await renderKind(kind, ""));
    kinds[kind] = { template, fallbackRole };
  }
  return { schema: BRIEF_SNAPSHOT_SCHEMA, sentinel: ROLE_SENTINEL, regenerate: REGENERATE_COMMAND, kinds };
}

/** The committed bytes: stable key order, 2-space JSON, LF, trailing newline. */
export function serializeSnapshot(snapshot: BriefSnapshot): string {
  const ordered = {
    $comment: [
      "GENERATED by scripts/interview-briefs-snapshot.ts - do not edit by hand.",
      `Regenerate with \`${REGENERATE_COMMAND}\` after any interviewer-brief copy change;`,
      "app/_lib/voice/interview-brief-snapshot.test.ts fails until you do.",
      "Each template is the production brief rendered with `sentinel` where the role goes;",
      "`fallbackRole` is what the builder uses when the role is empty.",
      "Read by pipeline/jobfit/eval/interview_eval.py (load_brief_snapshot / render_brief).",
    ],
    schema: snapshot.schema,
    sentinel: snapshot.sentinel,
    regenerate: snapshot.regenerate,
    kinds: Object.fromEntries(
      BRIEF_KINDS.map((k) => [k, { template: snapshot.kinds[k].template, fallbackRole: snapshot.kinds[k].fallbackRole }]),
    ),
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

export function parseSnapshot(text: string): BriefSnapshot {
  const raw = JSON.parse(text) as Partial<BriefSnapshot>;
  return {
    schema: raw.schema as number,
    sentinel: raw.sentinel as string,
    regenerate: raw.regenerate as string,
    kinds: (raw.kinds ?? {}) as Record<BriefKind, BriefTemplate>,
  };
}

/** Every way `committed` differs from `live`, one line per kind, each naming the kind and
 *  the regenerate command. Empty when they agree. */
export function compareSnapshot(committed: BriefSnapshot, live: BriefSnapshot): string[] {
  const out: string[] = [];
  const fix = `regenerate with \`${REGENERATE_COMMAND}\``;
  if (committed.schema !== live.schema) out.push(`schema ${committed.schema} != ${live.schema}: ${fix}`);
  if (committed.sentinel !== live.sentinel) out.push(`sentinel ${committed.sentinel} != ${live.sentinel}: ${fix}`);
  for (const kind of BRIEF_KINDS) {
    const c = committed.kinds?.[kind];
    const l = live.kinds[kind];
    if (!c) {
      out.push(`${kind}: missing from ${BRIEF_SNAPSHOT_PATH}: ${fix}`);
      continue;
    }
    const drift: string[] = [];
    if (c.template !== l.template) {
      let i = 0;
      while (i < c.template.length && c.template[i] === l.template[i]) i += 1;
      drift.push(
        `template differs from the production builder at char ${i} ` +
          `(committed ${JSON.stringify(c.template.slice(i, i + 40))}, live ${JSON.stringify(l.template.slice(i, i + 40))})`,
      );
    }
    if (c.fallbackRole !== l.fallbackRole) {
      drift.push(`fallbackRole ${JSON.stringify(c.fallbackRole)} != builder's ${JSON.stringify(l.fallbackRole)}`);
    }
    if (drift.length) out.push(`${kind}: ${drift.join("; ")}: ${fix}`);
  }
  return out;
}

async function main(argv: string[]): Promise<void> {
  // Always a throwaway database: the grounded fixture writes an entry and a prep pack, and
  // this must never be the operator's data/kp.sqlite. KP_EMPTY skips the demo-corpus seed.
  const dir = mkdtempSync(path.join(tmpdir(), "kp-brief-snapshot-"));
  process.env.KP_DB_PATH = path.join(dir, "kp.sqlite");
  process.env.KP_EMPTY = "1";
  try {
    const text = serializeSnapshot(await renderBriefSnapshot());
    if (argv.includes("--stdout")) {
      process.stdout.write(text);
    } else {
      writeFileSync(path.resolve(BRIEF_SNAPSHOT_PATH), text, "utf8");
      process.stderr.write(`wrote ${BRIEF_SNAPSHOT_PATH}\n`);
    }
  } finally {
    const holder = globalThis as typeof globalThis & { __kpDb?: { close(): void } };
    try {
      holder.__kpDb?.close();
    } catch {
      /* already closed — the directory removal below is best-effort either way */
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* Windows keeps an isolated store's handle open; the OS temp sweep reclaims it */
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
