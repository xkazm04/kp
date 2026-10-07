// Pins the re-score handling both callers share: a 409 INTERVIEW_SCORECARD_UNGROUNDED
// produces the localized sentence (never the server's English), a 200 reports ok so the
// caller refreshes, and an unreadable failure falls back to the generic re-score message.
//
// Runner: node --import ./scripts/test-alias-loader.mjs --experimental-transform-types \
//        --test-isolation=process --test app/features/hiring/schedule/scheduleRescore.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rescoreSession } from "./scheduleRescore.ts";
import { resolveErrorMessage } from "@/app/_lib/use-error-message";

const en = JSON.parse(readFileSync(new URL("../../../../messages/en.json", import.meta.url), "utf8")).errors as Record<string, string>;
const resolve = (payload: { code?: string | null } | null | undefined, fallback: string) =>
  resolveErrorMessage(payload, fallback, (c) => c in en, (c) => en[c]);

const reply = (status: number, body: unknown): typeof fetch =>
  (async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status })) as typeof fetch;

test("a 409 INTERVIEW_SCORECARD_UNGROUNDED shows the localized sentence, not the server's error string", async () => {
  const out = await rescoreSession("s1", resolve, reply(409, { error: "English server text", code: "INTERVIEW_SCORECARD_UNGROUNDED" }));
  assert.deepEqual(out, { ok: false, message: en.INTERVIEW_SCORECARD_UNGROUNDED });
});

test("a 200 is ok, so the caller refreshes", async () => {
  assert.deepEqual(await rescoreSession("s1", resolve, reply(200, { ok: true })), { ok: true });
});

test("a failure with no readable code, or no network, reads as the generic re-score failure", async () => {
  const generic = { ok: false, message: en.INTERVIEW_RESCORE_FAILED };
  assert.deepEqual(await rescoreSession("s1", resolve, reply(502, "<html>")), generic);
  assert.deepEqual(await rescoreSession("s1", resolve, (async () => { throw new Error("offline"); }) as typeof fetch), generic);
});

test("the session id is encoded into the path", async () => {
  let url = "";
  await rescoreSession("a/b", resolve, (async (u: string) => { url = u; return new Response("{}"); }) as unknown as typeof fetch);
  assert.equal(url, "/api/interview/sessions/a%2Fb/rescore");
});
