import { NextResponse } from "next/server";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  actOnPipelineEntry,
  hasEventToday,
  listActiveEntriesForAutomation,
  recordAutomationEvent,
} from "@/app/_lib/db";
import {
  cleanupWorkdir,
  createWorkdir,
  parseStderrError,
  spawnPython,
} from "@/app/_lib/python-runner";

export const runtime = "nodejs";

type Decision = {
  entryId: string;
  action: "advance" | "reject" | "hold" | "none";
  toStage: string | null;
  alerts: string[];
  reason: string;
};

// Task 7 — deterministic policy pass over all active entries. LLM-free.
export async function POST() {
  let workdir: string | null = null;
  try {
    const entries = listActiveEntriesForAutomation();
    if (entries.length === 0) {
      return NextResponse.json({ summary: { advanced: 0, rejected: 0, held: 0, alerts: 0 }, decisions: [] });
    }

    workdir = await createWorkdir();
    const inputPath = path.join(workdir, "entries.json");
    await writeFile(inputPath, JSON.stringify(entries), "utf-8");

    const { result } = spawnPython(["-m", "pipeline.jobfit.automation_cli", "policy-pass", "--entries-json", inputPath]);
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) {
      const err = parseStderrError(stderr, exitCode);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    const { decisions } = JSON.parse(stdout) as { decisions: Decision[] };
    const summary = { advanced: 0, rejected: 0, held: 0, alerts: 0 };

    for (const d of decisions) {
      if (!d.entryId) continue;
      if (d.action === "advance") {
        actOnPipelineEntry(d.entryId, "accept"); // logs `advanced` + stamps stage_changed_at
        summary.advanced += 1;
      } else if (d.action === "reject") {
        actOnPipelineEntry(d.entryId, "reject"); // BAU<40 only — enforced in evaluate_entry
        summary.rejected += 1;
      } else if (d.action === "hold") {
        summary.held += 1;
      }
      for (const alert of d.alerts ?? []) {
        if (!hasEventToday(d.entryId, alert)) {
          recordAutomationEvent(d.entryId, alert, d.reason);
          summary.alerts += 1;
        }
      }
    }

    return NextResponse.json({ summary, decisions });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Automation pass failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (workdir) await cleanupWorkdir(workdir);
  }
}
