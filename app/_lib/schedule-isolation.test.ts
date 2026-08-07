import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { createScheduleInvite, listScheduleInvites, getScheduleInviteByToken, confirmScheduleInvite } from "./schedule-store.ts";
import { createPipelineEntry, actOnPipelineEntry } from "./db/pipeline.ts";

after(() => cleanupUnitDb());

// Behavioral tenant-isolation for the Schedule surface (P1). Invites derive their
// team from the linked entry (auto), the recruiter agenda is scoped, the candidate
// token flow is team-agnostic, and slot collisions are per-team.

test("schedule invites are isolated per team on the agenda (workspace derived from the entry)", () => {
  const ea = createPipelineEntry({ candidateId: "c-a", candidateLabel: "A", jobId: "j", jobTitle: "R", workspaceId: "ws-a" });
  const eb = createPipelineEntry({ candidateId: "c-b", candidateLabel: "B", jobId: "j", jobTitle: "R", workspaceId: "ws-b" });
  const ia = createScheduleInvite({ entryId: ea.entry.id, candidateLabel: "A" });
  const ib = createScheduleInvite({ entryId: eb.entry.id, candidateLabel: "B" });
  assert.equal(ia.workspaceId, "ws-a", "invite derives its team from the linked entry");
  assert.equal(ib.workspaceId, "ws-b");

  const agendaA = listScheduleInvites(200, "ws-a").map((i) => i.token);
  assert.ok(agendaA.includes(ia.token), "ws-a's agenda shows its own invite");
  assert.ok(!agendaA.includes(ib.token), "ws-a's agenda must NOT show ws-b's invite");

  // The candidate opens their invite by token regardless of team (token = capability).
  assert.ok(getScheduleInviteByToken(ib.token), "the candidate resolves their own invite by token");
});

test("slot collisions are per-team — two teams can book the same instant", () => {
  const ea = createPipelineEntry({ candidateId: "c-c", candidateLabel: "C", jobId: "j", jobTitle: "R", workspaceId: "ws-a" });
  const eb = createPipelineEntry({ candidateId: "c-d", candidateLabel: "D", jobId: "j", jobTitle: "R", workspaceId: "ws-b" });
  const ia = createScheduleInvite({ entryId: ea.entry.id });
  const ib = createScheduleInvite({ entryId: eb.entry.id });
  const slotAt = "2026-08-01T10:00:00.000Z";
  assert.equal(confirmScheduleInvite(ia.token, "Sat 10:00", slotAt).ok, true);
  // Same instant, different team → NOT a clash (separate per-team calendars).
  assert.equal(confirmScheduleInvite(ib.token, "Sat 10:00", slotAt).ok, true, "team B books the same slot (per-team calendar)");
});

// Direction: re-invite from the Closed bucket — the recruiter agenda read surfaces the
// linked entry's status/stage so a surface can gate on the entry's fate (the Closed
// re-invite is withheld for a terminal/hired entry).
test("the agenda read surfaces the linked entry's status + stage (for the Closed re-invite gate)", () => {
  const { entry } = createPipelineEntry({ candidateId: "c-e", candidateLabel: "E", jobId: "j2", jobTitle: "R", workspaceId: "ws-e" });
  const invite = createScheduleInvite({ entryId: entry.id, candidateLabel: "E" });
  const before = listScheduleInvites(200, "ws-e").find((i) => i.token === invite.token);
  assert.ok(before, "the invite is on its team's agenda");
  assert.equal(before!.entryStatus, "active", "the live entry's status rides the agenda projection");
  assert.equal(typeof before!.entryStage, "string", "the entry's stage is surfaced too");

  // Reject the entry → the projection reflects the terminal status on the next read.
  actOnPipelineEntry(entry.id, "reject", undefined, undefined, "ws-e");
  const after = listScheduleInvites(200, "ws-e").find((i) => i.token === invite.token);
  assert.equal(after!.entryStatus, "rejected", "a terminal entry status is visible to the agenda gate");
});
