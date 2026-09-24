// Lesson derivation (lessons.ts) - pure, no DB.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LESSON_FEEDBACK_MAX_CHARS,
  LESSON_RECIPE_DISCLOSURE,
  LESSON_RECIPE_QUALIFICATION,
  LESSON_RECIPE_VERIFICATION,
  commonLessonBullets,
  deriveGigLessons,
  scrubGigFeedback,
  type GigLessonInput,
} from "./lessons.ts";
import { GIG_CHECKLISTS } from "./checklists.ts";
import { gigRecipeSlugs } from "./recipes.ts";
import { GIG_DISCLOSURE_ITEM } from "./types.ts";

const KEYS = GIG_CHECKLISTS.security;

function input(over: Partial<GigLessonInput> = {}): GigLessonInput {
  return {
    arena: "security",
    verdict: "accepted",
    recipes: gigRecipeSlugs("security").map((slug) => ({ slug, version: "0.1.0" })),
    evidence: [
      { kind: "repro", passed: true },
      { kind: "repro", passed: true },
      { kind: "test", passed: false },
    ],
    checklist: { keys: KEYS, ticked: Object.fromEntries(KEYS.map((k, i) => [k, i !== 1])) },
    feedbackText: null,
    scrubNames: ["Acme Robotics", "Stored XSS in the Acme admin panel"],
    qualification: {
      score: 80,
      factors: { arenaFit: true, rewardKnown: true, deadlineHeadroomDays: 12.5, specialistAvailable: true, suspect: false },
      note: null,
      source: "deterministic",
      fallbackReason: null,
    },
    ...over,
  };
}

test("accepted: the evidence kinds and the checklist tally, in the stated shape", () => {
  const b = commonLessonBullets(input());
  assert.deepEqual(b, [
    `accepted: security work whose evidence included repro, test and whose checklist had ${KEYS.length - 1}/${KEYS.length} items ticked`,
  ]);
});

test("rejected: the tally plus the keys left unticked before sending", () => {
  const b = commonLessonBullets(input({ verdict: "rejected" }));
  assert.match(b[0], /^rejected: security work whose evidence included repro, test and whose checklist had 5\/6 items ticked$/);
  assert.equal(b[1], `left unticked before sending: ${KEYS[1]}`);
});

test("duplicate and no_response have their own fixed lesson", () => {
  assert.deepEqual(commonLessonBullets(input({ verdict: "duplicate" })), ["rejected as duplicate: check for prior reports before drafting"]);
  assert.match(commonLessonBullets(input({ verdict: "no_response" }))[0], /^no response: security work drew no verdict; /);
});

test("no evidence and no review are said, never guessed", () => {
  const b = commonLessonBullets(input({ evidence: [], checklist: { keys: KEYS, ticked: null } }));
  assert.equal(b[0], "accepted: security work whose evidence included no recorded evidence and whose checklist had no review was recorded");
});

test("one lesson per adopted recipe, each carrying the common bullets; three recipes add their own", () => {
  const lessons = deriveGigLessons(input());
  assert.deepEqual(
    lessons.map((l) => l.recipe.slug),
    gigRecipeSlugs("security")
  );
  const by = new Map(lessons.map((l) => [l.recipe.slug, l.bullets]));
  for (const l of lessons) assert.ok(l.bullets[0].startsWith("accepted: security work"), l.recipe.slug);
  assert.equal(by.get("bug-bounty-vulnerability-report")!.length, 1, "the arena recipe gets the common bullets only");
  assert.equal(by.get(LESSON_RECIPE_QUALIFICATION)![1], "accepted at qualification score 80/100 (reward stated: yes; deadline headroom: 12.5 days)");
  assert.equal(by.get(LESSON_RECIPE_VERIFICATION)![1], "accepted with evidence at send time: repro x2 (2 passed, 0 failed); test x1 (0 passed, 1 failed)");
  assert.equal(by.get(LESSON_RECIPE_DISCLOSURE)![1], "accepted with the AI-use disclosure ticked before sending");
  // A recipe listed twice is one lesson; an empty slug is none.
  const twice = deriveGigLessons(input({ recipes: [{ slug: "x", version: "1" }, { slug: "x", version: "1" }, { slug: "", version: "1" }] }));
  assert.equal(twice.length, 1);
});

test("the disclosure bullet reads the disclosure key, and says when there was no review", () => {
  const untick = input({ checklist: { keys: KEYS, ticked: { [GIG_DISCLOSURE_ITEM]: false } } });
  const d = deriveGigLessons(untick).find((l) => l.recipe.slug === LESSON_RECIPE_DISCLOSURE)!;
  assert.equal(d.bullets[d.bullets.length - 1], "accepted with the AI-use disclosure not ticked before sending");
  const none = deriveGigLessons(input({ checklist: { keys: KEYS, ticked: null } })).find((l) => l.recipe.slug === LESSON_RECIPE_DISCLOSURE)!;
  assert.match(none.bullets[none.bullets.length - 1], /not reviewed/);
});

test("scrub: URLs, e-mails, @handles, long numbers, paths, secrets and the org's name all go", () => {
  const raw =
    "Thanks! Acme Robotics triaged it (see https://hackerone.com/reports/1234567 and www.acme.test/x). " +
    "Mail sec@acme.test or ping @acme-sec. Ticket 123456789 was filed; repro in /home/op/work/poc.py and src/app/admin/page.tsx. " +
    "Token ghp_abcdEFGH1234ijklMNOP5678qrst leaked. Great write-up, clear repro steps, impact understated.";
  const out = scrubGigFeedback(raw, ["Acme Robotics"])!;
  for (const gone of ["http", "www.", "@", "acme", "Acme", "123456789", "/home", "page.tsx", "ghp_", "1234567"]) {
    assert.ok(!out.includes(gone), `${gone} must be scrubbed: ${out}`);
  }
  assert.match(out, /Great write-up, clear repro steps, impact understated\./);
  // Short numbers survive: "3 of 4 steps" is generalizable.
  assert.equal(scrubGigFeedback("Only 3 of 4 steps reproduced on 2026 builds.", []), "Only 3 of 4 steps reproduced on 2026 builds.");
});

test("scrub: the name is matched whole-word and case-insensitively, and its long words go too", () => {
  assert.equal(scrubGigFeedback("ACME ROBOTICS liked it; acme will pay.", ["Acme Robotics"]), "liked it; will pay.");
  // "Acme" inside another word is left alone.
  assert.equal(scrubGigFeedback("The Acmeville fork is fine.", ["Acme"]), "The Acmeville fork is fine.");
});

test("scrub: nothing generalizable left -> null; long text is clipped", () => {
  assert.equal(scrubGigFeedback("https://x.test @bob 12345678", []), null);
  assert.equal(scrubGigFeedback("   ", []), null);
  assert.equal(scrubGigFeedback(null, []), null);
  const long = scrubGigFeedback("word ".repeat(200), [])!;
  assert.ok(long.length <= LESSON_FEEDBACK_MAX_CHARS);
  assert.ok(long.endsWith("…"));
});

test("feedback rides only after scrubbing, and never names the client", () => {
  const b = commonLessonBullets(input({ feedbackText: "Acme Robotics says: clear repro, but see https://acme.test/policy" }));
  assert.equal(b[1], "feedback (scrubbed): says: clear repro, but see");
  for (const line of deriveGigLessons(input({ feedbackText: "Acme Robotics says: clear repro" })).flatMap((l) => l.bullets)) {
    assert.ok(!/acme/i.test(line), line);
    assert.ok(!/xss in the/i.test(line), "the listing title never rides along");
  }
});

test("deterministic: the same input yields the same lessons", () => {
  assert.deepEqual(deriveGigLessons(input({ feedbackText: "Nice." })), deriveGigLessons(input({ feedbackText: "Nice." })));
});
