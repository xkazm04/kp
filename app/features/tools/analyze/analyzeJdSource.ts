// The Analyze form's job-description column as ONE value (challenge-r10 analyze-workspace/A).
//
// The column used to be three independent atoms — an attached file, the pasted text and
// the picked saved-JD slug — and the rule binding them ("one active source, and a slug
// only when its body is what gets sent") was kept by hand at six call sites. Three live
// defects fell out of that:
//
//   - a sidebar hop dropped the role link (the draft stored the text, never the slug);
//   - any keystroke in a picked JD silently unlinked it from its role;
//   - picking a saved JD while a JD file was attached sent all three, so the run was
//     scored against the FILE's prose (analyze-run prefers the path), grounded on the
//     picked role's requirements and filed under that role.
//
// Every writer now dispatches a JdAction into `nextJdSource`, and every reader goes
// through a projection. `jdSubmission` is exactly what the submit sends; it cannot
// express file+slug or file+text, and it never carries a slug without its body.
//
// One product decision lives here, named: editing a picked JD's text KEEPS the link
// and marks it edited (Revert and Detach are one click away). The role's structured
// requirements still ground the score — that is what the recruiter picked; an edit
// changes the prose, not the requisition. A file attach replaces pasted text instead of
// sitting beside it: that text was never sent next to a file anyway.
//
// Pure — no React, no fetch. The fetches and the pick-sequence guard stay in
// useAnalyzeJdLibrary, which dispatches into this.

export type JdBodyState = "loading" | "ready" | "failed";

export type JdSource =
  | { kind: "none" }
  | { kind: "typed"; text: string }
  | { kind: "file"; file: File }
  | {
      kind: "saved";
      slug: string;
      /** What the textarea shows. While `loading` (and after `failed`) it is the text
       *  the column held before the pick, so a failed fetch costs nothing typed. */
      text: string;
      /** The body as loaded — what Revert returns to. `null` after a draft restore of
       *  an edited link (the body is not stored twice); Revert then re-fetches it. */
      baseline: string | null;
      state: JdBodyState;
      edited: boolean;
      /** Came back from the draft and not yet checked against the library. */
      restored?: boolean;
    };

export type JdAction =
  | { type: "pickSaved"; slug: string }
  | { type: "bodyLoaded"; slug: string; body: unknown }
  | { type: "bodyFailed"; slug: string }
  | { type: "edit"; text: string }
  | { type: "revert" }
  | { type: "unlink" }
  | { type: "attachFile"; file: File }
  | { type: "removeFile" }
  | { type: "clear" }
  /** Fill an EMPTY column from the draft; a source set this mount always wins. */
  | { type: "restore"; source: JdSource };

export const JD_NONE: JdSource = { kind: "none" };

/** Text as a source: blank is no source at all. */
function fromText(text: string): JdSource {
  return text.trim() ? { kind: "typed", text } : JD_NONE;
}

/** The text the column currently shows (a file shows none). */
export function jdText(source: JdSource): string {
  return source.kind === "typed" || source.kind === "saved" ? source.text : "";
}

export function nextJdSource(source: JdSource, action: JdAction): JdSource {
  switch (action.type) {
    case "pickSaved":
      // The pick is the column's source from now on: an attached file is dropped here,
      // not left to be sent beside the role it was never scored against.
      return { kind: "saved", slug: action.slug, text: jdText(source), baseline: null, state: "loading", edited: false };
    case "bodyLoaded": {
      // Only the pick still waiting for THIS slug takes the body. A late answer for an
      // older pick, or one landing after the recruiter typed/attached, is dropped.
      if (source.kind !== "saved" || source.slug !== action.slug || source.state !== "loading") return source;
      // A non-string or blank body is a failed load: sending the slug with it would be
      // a JD-blind run filed as a role-specific match.
      if (typeof action.body !== "string" || !action.body.trim()) return { ...source, state: "failed" };
      return { ...source, text: action.body, baseline: action.body, state: "ready", edited: false };
    }
    case "bodyFailed":
      if (source.kind !== "saved" || source.slug !== action.slug || source.state !== "loading") return source;
      return { ...source, state: "failed" };
    case "edit":
      if (source.kind === "saved" && source.state === "ready") {
        // Clearing the text is not an edit of the role — it is leaving it.
        if (!action.text.trim()) return JD_NONE;
        const edited = source.baseline === null ? true : action.text !== source.baseline;
        return { ...source, text: action.text, edited };
      }
      // Typing over a loading or failed pick takes the column; so does typing while a
      // file is attached (the last action wins — the column holds one source). An
      // empty edit is not typing, so it never costs an attached file.
      if (source.kind === "file" && !action.text.trim()) return source;
      return fromText(action.text);
    case "revert":
      if (source.kind !== "saved" || source.state !== "ready" || source.baseline === null) return source;
      return { ...source, text: source.baseline, edited: false };
    case "unlink":
      return source.kind === "saved" ? fromText(source.text) : source;
    case "attachFile":
      return { kind: "file", file: action.file };
    case "removeFile":
      return source.kind === "file" ? JD_NONE : source;
    case "clear":
      return JD_NONE;
    case "restore":
      return source.kind === "none" ? action.source : source;
  }
}

export type JdSubmission = { file: File | null; text: string; jdSlug: string | null };

/** Exactly what the submit sends. Never file+slug, never file+text, never a slug without its body. */
export function jdSubmission(source: JdSource): JdSubmission {
  switch (source.kind) {
    case "none":
      return { file: null, text: "", jdSlug: null };
    case "typed":
      return { file: null, text: source.text, jdSlug: null };
    case "file":
      return { file: source.file, text: "", jdSlug: null };
    case "saved":
      if (source.state === "ready") return { file: null, text: source.text, jdSlug: source.slug };
      // A loading pick sends nothing (the submit is held on jdLoading anyway); a failed
      // one sends the text it kept, unlinked.
      return { file: null, text: source.state === "failed" ? source.text : "", jdSlug: null };
  }
}

export function jdFile(source: JdSource): File | null {
  return source.kind === "file" ? source.file : null;
}

/** The slug the picker shows as selected: a pick in flight or landed, never a failed one. */
export function linkedSlug(source: JdSource): string | null {
  return source.kind === "saved" && source.state !== "failed" ? source.slug : null;
}

export function jdLoading(source: JdSource): boolean {
  return source.kind === "saved" && source.state === "loading";
}

export function jdLoadFailed(source: JdSource): boolean {
  return source.kind === "saved" && source.state === "failed";
}

export function jdEdited(source: JdSource): boolean {
  return source.kind === "saved" && source.state === "ready" && source.edited;
}

type LibraryEntry = { slug: string; title: string };

export type JdStatus =
  | { tone: "optional"; key: "optional" }
  | { tone: "attached"; key: "loadingJd" }
  | { tone: "attached"; key: "jdLinkedTo" | "jdEditedFrom"; title: string }
  | { tone: "attached"; key: "file"; name: string }
  | { tone: "attached"; key: "charsCount"; count: number };

/** The column (and collapsed summary) label: whether the run is role-linked, and to what. */
export function jdStatus(source: JdSource, jds: readonly LibraryEntry[]): JdStatus {
  if (source.kind === "file") return { tone: "attached", key: "file", name: source.file.name };
  if (source.kind === "saved" && source.state === "loading") return { tone: "attached", key: "loadingJd" };
  if (source.kind === "saved" && source.state === "ready") {
    const title = jds.find((jd) => jd.slug === source.slug)?.title || source.slug;
    return { tone: "attached", key: source.edited ? "jdEditedFrom" : "jdLinkedTo", title };
  }
  const count = jdText(source).trim().length;
  return count > 0 ? { tone: "attached", key: "charsCount", count } : { tone: "optional", key: "optional" };
}

export type JdLibraryView = { state: "loading" | "ready" | "failed"; truncated: boolean; jds: readonly { slug: string }[] };

/**
 * Re-check a link that came back from the draft. Absence is proven only by a
 * complete, loaded library: a still-loading, failed or truncated list keeps the link
 * (the role may simply be older than the newest page). A proven-gone link becomes
 * typed text plus a `linkGone` notice; a found one is marked verified, once.
 */
export function reconcileRestoredLink(
  source: JdSource,
  library: JdLibraryView,
): { source: JdSource; notice: "linkGone" | null } {
  if (source.kind !== "saved" || !source.restored) return { source, notice: null };
  if (library.state !== "ready" || library.truncated) return { source, notice: null };
  if (library.jds.some((jd) => jd.slug === source.slug)) return { source: { ...source, restored: false }, notice: null };
  return { source: fromText(source.text), notice: "linkGone" };
}
