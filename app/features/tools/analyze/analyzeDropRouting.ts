// The Analyze intake router — pure, free of React and the DOM, so every rule below
// runs under `npm run test:unit` (challenge-r03 cv-analyze-intake/A).
//
// Where a file goes used to be decided by WHICH DOM NODE caught the event: a window
// listener inside the CV column, three per-zone onDrop handlers, an "owned zone"
// carve-out attribute and a prop-order override. Four drops were lost without a
// word (a drop on the attached JD/company card, the 2nd+ file of a JD/company drop,
// every valid CV after an invalid one, and "page" could only ever mean CV).
//
// Now: each zone DECLARES an id from one closed vocabulary; one window listener,
// hosted by the form, resolves the id of the nearest marked ancestor and asks
// `planDrop` for the whole drop; the plan says where each file goes and names a
// reason for every file that does not go in. A zone's own picker asks the same
// plan, so a click and a drop can no longer diverge.
//
// idea-1a75b476 still holds by construction: a plan names ONE destination per file,
// so a drop on the JD zone can never also become a phantom CV variant.

import { acceptUpload, MAX_CV_VARIANTS, type UploadRejectionCode } from "@/app/_lib/upload-constraints";

/** The zones a component can claim. Literal array + derived union + runtime guard. */
export const DROP_ZONES = ["cv", "jd", "company"] as const;
export type DropZone = (typeof DROP_ZONES)[number];

export function isDropZone(value: unknown): value is DropZone {
  return typeof value === "string" && (DROP_ZONES as readonly string[]).includes(value);
}

/** Where a drop landed: a declared zone, or bare page space (which files as a CV). */
export type DropTarget = DropZone | "page";

/** The attribute a zone's root carries; its VALUE is the zone id. */
export const DROP_ZONE_ATTR = "data-file-dropzone";

/** Spread onto a zone's root element, so the marker and the resolver that reads it
 *  stay one source of truth. */
export function dropZoneProps(zone: DropZone): { [DROP_ZONE_ATTR]: DropZone } {
  return { [DROP_ZONE_ATTR]: zone };
}

type ClosestTarget = {
  closest?: (selectors: string) => { getAttribute?: (name: string) => string | null } | null;
};

/**
 * The zone a drop landed in: the id on the nearest `[data-file-dropzone]` ancestor.
 * Duck-types `closest` so it runs in the browser and under the DOM-less unit runner;
 * a target with no `closest` (the document, a text node), no marked ancestor, or a
 * marker outside the vocabulary resolves to "page".
 */
export function resolveDropZone(target: EventTarget | null): DropTarget {
  const el = target as ClosestTarget | null;
  if (!el || typeof el.closest !== "function") return "page";
  const marked = el.closest(`[${DROP_ZONE_ATTR}]`);
  const id = marked && typeof marked.getAttribute === "function" ? marked.getAttribute(DROP_ZONE_ATTR) : null;
  return isDropZone(id) ? id : "page";
}

/** Why a file did not go in. `cap`: the CV column is full. `single-slot`: the JD and
 *  company zones hold one file and an earlier file in the same drop took it. The two
 *  upload codes are `acceptUpload`'s, resolved through `errors.<CODE>`. */
export type DropRefusalReason = "cap" | "single-slot" | UploadRejectionCode;
export type DropRefusal = { file: File; reason: DropRefusalReason };

/** A single-slot commit; `replaces` says the slot already held a file. */
export type SlotCommit = { file: File; replaces: boolean };

export type DropPlan = {
  cv: File[];
  jd: SlotCommit | null;
  company: SlotCommit | null;
  refused: DropRefusal[];
};

/** The form as the plan sees it. Every field defaults, so a picker can pass only
 *  what its zone needs. `isFileDrag` is false for a text-selection drag. */
export type DropSnapshot = {
  cvCount?: number;
  maxCv?: number;
  hasJdFile?: boolean;
  hasCompanyFile?: boolean;
  isFileDrag?: boolean;
};

/** One single-slot zone's share of a drop: the first file that clears the gate
 *  takes the slot (replacing a filled one), every later one is refused by name. */
export function planSingleSlot(
  files: readonly File[],
  filled: boolean,
): { slot: SlotCommit | null; refused: DropRefusal[] } {
  let slot: SlotCommit | null = null;
  const refused: DropRefusal[] = [];
  for (const file of files) {
    const gate = acceptUpload(file);
    if (!gate.ok) refused.push({ file, reason: gate.code });
    else if (slot) refused.push({ file, reason: "single-slot" });
    else slot = { file: gate.file, replaces: filled };
  }
  return { slot, refused };
}

/**
 * Plan a drop (or a picker selection) onto `zone`. The gate runs per file and a
 * rejection never stops the batch; "page" and "cv" fill the CV column up to the cap.
 * Returns null for anything that is not a file intake — a text-selection drag, or
 * a drag carrying no files — wherever it landed.
 *
 * The plan is a pre-check over a snapshot: the CV hook still re-checks the cap
 * after its hash await and is still the content deduper, so neither authority moves.
 */
export function planDrop(zone: DropTarget, files: readonly File[], snapshot: DropSnapshot): DropPlan | null {
  if (snapshot.isFileDrag === false || files.length === 0) return null;
  const plan: DropPlan = { cv: [], jd: null, company: null, refused: [] };

  if (zone === "jd" || zone === "company") {
    const { slot, refused } = planSingleSlot(files, zone === "jd" ? Boolean(snapshot.hasJdFile) : Boolean(snapshot.hasCompanyFile));
    plan[zone] = slot;
    plan.refused = refused;
    return plan;
  }

  let room = Math.max(0, (snapshot.maxCv ?? MAX_CV_VARIANTS) - (snapshot.cvCount ?? 0));
  for (const file of files) {
    const gate = acceptUpload(file);
    if (!gate.ok) {
      plan.refused.push({ file, reason: gate.code });
    } else if (room > 0) {
      plan.cv.push(gate.file);
      room -= 1;
    } else {
      plan.refused.push({ file, reason: "cap" });
    }
  }
  return plan;
}
