// Pins the drop-routing contract that stops the window-level CV catch from
// double-filing a labeled-zone drop as a phantom CV variant (idea-1a75b476).
//
// useGlobalFileDrag adds a window 'drop' listener that adds the dropped file as a
// CV. The JD / company columns and the empty CV zone render their OWN drop
// targets, and native drop events bubble to window — so without a carve-out a
// file dropped on the JD zone would land as the job description AND be silently
// added as a CV variant. resolveWindowDropTarget is that carve-out: it returns
// null for a drop inside any labeled (owned) zone and only routes drops that land
// outside every zone (the genuine drop-anywhere case).
//
// There is no render/DOM test layer in this repo, so this pairs the pure-routing
// assertions with source-level guards that the zones actually carry the marker
// and the hook actually consults it.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  OWNED_DROP_ZONE_ATTR,
  isOwnedDropZoneTarget,
  ownedDropZoneProps,
  resolveWindowDropTarget,
} from "./dropRouting.ts";

function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

// A stand-in for a drop event target whose closest() resolves the nearest
// ancestor carrying the given attributes, exactly like Element.closest does in
// the browser. `targetInside(OWNED_DROP_ZONE_ATTR)` models a drop landing inside
// a labeled zone; `targetInside()` models a drop in bare page space.
function targetInside(...attrs: string[]): EventTarget {
  return {
    closest(selectors: string) {
      const attr = selectors.replace(/^\[|\]$/g, "");
      return attrs.includes(attr) ? ({ matched: attr } as unknown) : null;
    },
  } as unknown as EventTarget;
}

const aFile = () => new File(["x"], "drop.pdf", { type: "application/pdf" });

// ── The regression: a drop on a labeled zone must NOT route to the CV catch ──
test("a file dropped on a labeled zone is not routed to the CV catch (no phantom CV)", () => {
  // The JD zone, company zone, and empty CV zone all carry OWNED_DROP_ZONE_ATTR,
  // so a drop landing inside any of them resolves to null — the zone's own onDrop
  // is the sole handler.
  const file = aFile();
  assert.equal(
    resolveWindowDropTarget(true, targetInside(OWNED_DROP_ZONE_ATTR), file),
    null,
    "a drop inside an owned zone must never be added as a CV variant",
  );
});

test("a file dropped outside every labeled zone IS routed to the CV catch (drop-anywhere)", () => {
  const file = aFile();
  assert.equal(
    resolveWindowDropTarget(true, targetInside(), file),
    file,
    "the drop-anywhere CV affordance must still route bare-page drops",
  );
});

test("a drop with no element target routes to the CV catch", () => {
  // A target that is not an Element (or is absent) is treated as outside every
  // zone, so the drop-anywhere catch still fires.
  const file = aFile();
  assert.equal(resolveWindowDropTarget(true, null, file), file);
  assert.equal(resolveWindowDropTarget(true, {} as EventTarget, file), file);
});

test("a non-file drag is never routed, wherever it lands", () => {
  const file = aFile();
  assert.equal(resolveWindowDropTarget(false, targetInside(), file), null);
  assert.equal(resolveWindowDropTarget(false, targetInside(OWNED_DROP_ZONE_ATTR), file), null);
});

test("a file drag outside any zone with no file present routes nothing", () => {
  assert.equal(resolveWindowDropTarget(true, targetInside(), null), null);
});

test("isOwnedDropZoneTarget detects the marker and tolerates non-elements", () => {
  assert.equal(isOwnedDropZoneTarget(targetInside(OWNED_DROP_ZONE_ATTR)), true);
  assert.equal(isOwnedDropZoneTarget(targetInside()), false, "an unmarked target is not owned");
  assert.equal(isOwnedDropZoneTarget(null), false);
  assert.equal(isOwnedDropZoneTarget({} as EventTarget), false, "a target without closest() is not owned");
});

test("ownedDropZoneProps spreads exactly the marker attribute", () => {
  assert.deepEqual(ownedDropZoneProps, { [OWNED_DROP_ZONE_ATTR]: "" });
});

// ── Source-level guards: the zones are actually wired to the contract ────────
test("useGlobalFileDrag routes its window drop through resolveWindowDropTarget", () => {
  const src = read("./useGlobalFileDrag.ts");
  assert.match(src, /resolveWindowDropTarget\(/, "the window catch must consult the routing carve-out");
  // The old unconditional `onDropRef.current(event.dataTransfer...files[0])` is
  // gone: the file handed to onDropRef now comes from resolveWindowDropTarget.
  assert.doesNotMatch(
    src,
    /onDropRef\.current\(\s*event\.dataTransfer/,
    "the window catch must not add the raw dropped file unconditionally",
  );
});

test("both JD/company zone states and the empty CV zone carry the owned marker", () => {
  // AnalyzeFileDropZone (JD + company) marks both its empty and filled renders so
  // neither a fresh drop nor a replacement can leak to the CV catch.
  const dropZone = read("./AnalyzeFileDropZone.tsx");
  assert.equal(
    (dropZone.match(/ownedDropZoneProps/g) ?? []).length,
    3, // one import + the empty-state label + the filled-state card
    "AnalyzeFileDropZone must mark both its empty and filled states as owned",
  );
  // The empty CV zone is marked so its own onDrop is the sole handler (else the
  // window catch would add the same CV twice). The populated CV column stays
  // UNmarked on purpose, so dropping an extra variant onto it still works.
  const profile = read("./AnalyzeProfileInput.tsx");
  assert.match(profile, /ownedDropZoneProps/, "the empty CV zone must be marked owned");
});

test("the drop-anywhere overlay names the JD/company carve-out (idea-9f3a1c52)", () => {
  // "Drop your CV anywhere" alone implies the labeled Job description and Company
  // zones too — but those own their drops and never become a CV. The overlay must
  // spell out the carve-out so the copy matches the routing contract above. The
  // copy is i18n-localized, so the component renders the `dropCarveout` key and
  // the actual wording lives in the message catalog (messages/en.json).
  const profile = read("./AnalyzeProfileInput.tsx");
  assert.match(
    profile,
    /t\("dropCarveout"\)/,
    "the overlay must render the carve-out message via the dropCarveout catalog key",
  );
  const en = JSON.parse(read("../../../messages/en.json")) as { analyze?: { dropCarveout?: string } };
  assert.match(
    en.analyze?.dropCarveout ?? "",
    /Job description and Company zones keep their own files/,
    "the dropCarveout copy must tell the user the JD/company zones keep their own drops",
  );
});
