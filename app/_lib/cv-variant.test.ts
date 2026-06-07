// Pins the one shared "same CV variant" rule (idea-bb9ddb46). The client intake
// (addCvFile) and the server intake (collectCvFiles) used to disagree: the
// client merged by name+size (losing two different CVs that shared a name and
// byte length), the server never deduped content (running an identical clone
// twice). Both now key on CONTENT via cvVariantHash. These lock that contract:
// identity ignores the filename and catches only true byte clones.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { cvVariantHash, dedupeCvVariants, isDuplicateCvVariant } from "./cv-variant.ts";

const file = (content: string, name: string) => new File([content], name, { type: "text/plain" });

test("same content hashes identically (dedupe stays usable)", async () => {
  assert.equal(await cvVariantHash(file("resume body", "a.txt")), await cvVariantHash(file("resume body", "a.txt")));
});

test("identity is the content, not the name: same bytes + different name = same variant", async () => {
  assert.equal(await cvVariantHash(file("resume body", "a.txt")), await cvVariantHash(file("resume body", "b.txt")));
});

test("different content with the same name and byte length stays distinct (the old name+size bug)", async () => {
  // "world" and "wXrld" share a filename and byte length but are different CVs;
  // the old client rule (name === name && size === size) silently merged them.
  assert.notEqual(await cvVariantHash(file("world", "cv.txt")), await cvVariantHash(file("wXrld", "cv.txt")));
});

test("dedupeCvVariants keeps the first occurrence of each distinct content, in order", async () => {
  const out = await dedupeCvVariants([
    file("aaa", "x.txt"),
    file("aaa", "y.txt"), // same content as x → dropped despite the different name
    file("bbb", "z.txt"),
  ]);
  assert.deepEqual(
    out.map((f) => f.name),
    ["x.txt", "z.txt"]
  );
});

test("dedupeCvVariants keeps same-name different-content files (the old server gap, now safe)", async () => {
  // The server used to keep these by accident (no content dedupe at all). The
  // rule must still keep them — only true byte clones get dropped.
  const out = await dedupeCvVariants([file("one", "cv.txt"), file("two", "cv.txt")]);
  assert.deepEqual(
    out.map((f) => f.name),
    ["cv.txt", "cv.txt"]
  );
});

test("isDuplicateCvVariant matches on content regardless of filename", async () => {
  const existing = [file("resume", "v1.txt")];
  assert.equal(await isDuplicateCvVariant(file("resume", "v2.txt"), existing), true);
  assert.equal(await isDuplicateCvVariant(file("different", "v2.txt"), existing), false);
});

test("isDuplicateCvVariant is false against an empty form (first add always lands)", async () => {
  assert.equal(await isDuplicateCvVariant(file("resume", "cv.txt"), []), false);
});
