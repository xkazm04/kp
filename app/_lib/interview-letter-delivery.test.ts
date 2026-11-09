// Q10 on the feedback letter: deliverApprovedLetter passes the draft's source, so a TEMPLATE
// letter does not claim AI drafting, a model one does, and a letter whose draft is gone
// (source unknowable) keeps the line.
//
// unit-db.ts MUST be the first project import.
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createPipelineEntry } from "./db/pipeline.ts";
import { listOutboxFiltered } from "./db/devcase.ts";
import { DEFAULT_WORKSPACE_ID as WS } from "./db/workspaces.ts";
import type { InterviewLetterRecord } from "./db/interview-letters.ts";
import { commsTranslator } from "./comms-translator.ts";

const { deliverApprovedLetter } = await import("./interview-letter-delivery.ts");

after(() => cleanupUnitDb());
delete process.env.COMMS_WEBHOOK_URL;

let seq = 0;
async function sentBody(draft: { source: "model" | "template" } | null): Promise<string> {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `ild-c${seq}`,
    candidateLabel: `Letter Candidate ${seq}`,
    jobId: `ild-job-${seq}`,
    jobTitle: "Platform Engineer",
    locale: "en",
    contact: `ild${seq}@example.cz`,
    stage: "Interview",
    workspaceId: WS,
  });
  const letter = {
    id: `ild-letter-${seq}`,
    lang: "en",
    finalText: "Thank you for your time. Here is our feedback.",
    draft: draft ? { text: "x", source: draft.source, createdAt: new Date().toISOString() } : null,
  } as unknown as InterviewLetterRecord;
  await deliverApprovedLetter(letter, entry, WS);
  return listOutboxFiltered({ ref: entry.id })[0]?.body ?? "";
}

test("a template feedback letter does not carry the AI-drafted line; a model one does", async () => {
  const line = (await commsTranslator("en"))("aiDraftedFooter");
  assert.ok(line.length > 10);
  assert.ok(!(await sentBody({ source: "template" })).includes(line));
  assert.ok((await sentBody({ source: "model" })).includes(line));
});

test("a feedback letter with no draft on the row keeps the line (source cannot be proved)", async () => {
  const line = (await commsTranslator("en"))("aiDraftedFooter");
  assert.ok((await sentBody(null)).includes(line));
});
