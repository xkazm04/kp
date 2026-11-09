// With KP_VOICE_INTERVIEW off, NO voice-interview invite can be minted or mailed, whatever
// caller reaches the two functions that do it. The doors (proxy, stage hook) are the first
// line; this pins the backstop UNDER them, so a future caller cannot bypass the flag.
// unit-db.ts MUST be the first project import (sets KP_DB_PATH).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { mintAndInviteVoiceScreen } from "../interview-invite.ts";
import { dispatchInterviewInvite } from "../comms-dispatch.ts";
import { assertVoiceInterviewEnabled, VoiceInterviewOffError } from "./enabled.ts";

after(() => cleanupUnitDb());

function withFlag<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const bag = process.env as Record<string, string | undefined>;
  const prior = bag.KP_VOICE_INTERVIEW;
  if (value === undefined) delete bag.KP_VOICE_INTERVIEW;
  else bag.KP_VOICE_INTERVIEW = value;
  return fn().finally(() => {
    if (prior === undefined) delete bag.KP_VOICE_INTERVIEW;
    else bag.KP_VOICE_INTERVIEW = prior;
  });
}

test("assertVoiceInterviewEnabled: only exactly '1' passes", () => {
  assert.doesNotThrow(() => assertVoiceInterviewEnabled({ KP_VOICE_INTERVIEW: "1" }));
  for (const v of [undefined, "0", "true", ""]) {
    assert.throws(() => assertVoiceInterviewEnabled({ KP_VOICE_INTERVIEW: v }), VoiceInterviewOffError);
  }
});

for (const v of [undefined, "0", "true"]) {
  test(`flag ${JSON.stringify(v)}: mintAndInviteVoiceScreen refuses before any read or write`, async () => {
    await withFlag(v, async () => {
      await assert.rejects(
        mintAndInviteVoiceScreen({ entryId: "no-such-entry", workspaceId: "default", origin: "http://localhost" }),
        VoiceInterviewOffError
      );
    });
  });

  test(`flag ${JSON.stringify(v)}: dispatchInterviewInvite sends nothing`, async () => {
    await withFlag(v, async () => {
      await assert.rejects(
        dispatchInterviewInvite({ id: "no-such-entry", candidateLabel: "X", jobTitle: "Y", contact: "x@example.com" } as never, "http://localhost/interview/t"),
        VoiceInterviewOffError
      );
    });
  });
}
