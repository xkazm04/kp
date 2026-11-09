import { test } from "node:test";
import assert from "node:assert/strict";
import { redactCandidateLinks, CANDIDATE_LINK_PLACEHOLDER } from "./comms-link-redaction.ts";

const TOKEN = "tok_AbC123-xyz_9876543210";

for (const door of ["offer", "schedule", "status", "data", "stop", "interview"]) {
  test(`/${door}/<token> is redacted: absolute, relative, with ?lang=`, () => {
    const abs = `Open https://kp.example.com/${door}/${TOKEN}?lang=cs now`;
    const rel = `Open /${door}/${TOKEN} now`;
    const relQ = `Open /${door}/${TOKEN}?lang=de&x=1.`;
    for (const body of [abs, rel, relQ]) {
      const out = redactCandidateLinks(body);
      assert.ok(!out.includes(TOKEN), `token left in: ${out}`);
      assert.ok(!out.includes("lang="), `query left in: ${out}`);
      assert.ok(out.includes(`/${door}/${CANDIDATE_LINK_PLACEHOLDER}`));
    }
    assert.equal(redactCandidateLinks(abs), `Open https://kp.example.com/${door}/${CANDIDATE_LINK_PLACEHOLDER} now`);
    assert.equal(redactCandidateLinks(relQ), `Open /${door}/${CANDIDATE_LINK_PLACEHOLDER}.`);
  });
}

test("a percent-encoded token is redacted whole", () => {
  const out = redactCandidateLinks("https://x.io/offer/a%2Fb%3Dc%20d?lang=fr tail");
  assert.equal(out, `https://x.io/offer/${CANDIDATE_LINK_PLACEHOLDER} tail`);
});

test("several links in one body all go", () => {
  const out = redactCandidateLinks(`a /offer/${TOKEN}\nb /data/${TOKEN}?lang=en\nc https://h/stop/${TOKEN}`);
  assert.ok(!out.includes(TOKEN));
});

test("a body with no link is unchanged", () => {
  const body = "Dear Ana,\nWe would like to offer you the role. See /about and https://x.io/jobs/1.";
  assert.equal(redactCandidateLinks(body), body);
  assert.equal(redactCandidateLinks(""), "");
});
