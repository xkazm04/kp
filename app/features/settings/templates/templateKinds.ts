// The pipeline STATE a message template belongs to — and the naming convention
// that carries it, because the store does not.
//
// GAP, stated once so nobody has to rediscover it: `jd_templates`
// (app/_lib/templates-store.ts) has exactly four content columns — id, name,
// body, is_default — plus the workspace_id tenant tier. There is NO kind/state
// column, and adding one is a schema + tenancy-manifest change this prototype is
// explicitly out of scope for. So the kind rides in the NAME, as a bracketed
// prefix the manager writes and reads back:
//
//     [interview] First-round invite
//
// The prefix is a convention, not a constraint: a template whose name carries no
// recognised prefix is real data and lands in the `unsorted` bucket rather than
// being hidden. Nothing outside this surface is affected — the JD builder's
// picker and the library manager render `name` verbatim, so a prefixed template
// simply reads as a prefixed template there.
//
// Literal array + derived union + runtime guard: the same closed-vocabulary shape
// as tabs.ts and i18n/locales.ts, so the type and the parser cannot drift.

/** The five pipeline states this prototype groups by. Hard-coded on purpose —
 *  the real stage vocabulary lives in app/_lib/pipeline-stages.ts, and coupling a
 *  prototype to it would make a prototype a dependency of the pipeline. */
export const TEMPLATE_KINDS = ["received", "screened", "interview", "offer", "rejected"] as const;

export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

/** Where a template with no recognised prefix goes. Visible, never hidden. */
export const UNSORTED = "unsorted" as const;

/** A kind, or the bucket for everything that declares none. */
export type TemplateBucket = TemplateKind | typeof UNSORTED;

/** Every bucket the UI renders, in pipeline order with `unsorted` last. */
export const TEMPLATE_BUCKETS: readonly TemplateBucket[] = [...TEMPLATE_KINDS, UNSORTED];

const KINDS: ReadonlySet<string> = new Set(TEMPLATE_KINDS);

export function isTemplateKind(value: string | null | undefined): value is TemplateKind {
  return typeof value === "string" && KINDS.has(value);
}

/** The prefix grammar, in one place: `[kind] title`, case-insensitive on the
 *  kind, tolerant of the spacing an author actually types. */
const PREFIX_RE = /^\s*\[([a-z]+)\]\s*(.*)$/i;

export type ParsedTemplateName = { bucket: TemplateBucket; title: string };

/** Split a stored name into its bucket and the title a recruiter reads.
 *
 *  An UNRECOGNISED prefix (`[draft] Something`) is deliberately left ON the
 *  title: it is the author's own text, and silently eating it would make the
 *  round-trip through this editor lossy. Only a prefix naming a real kind is
 *  consumed, because only that one is being re-emitted by `formatTemplateName`. */
export function parseTemplateName(name: string): ParsedTemplateName {
  const m = PREFIX_RE.exec(name ?? "");
  if (!m) return { bucket: UNSORTED, title: (name ?? "").trim() };
  const kind = m[1].toLowerCase();
  if (!isTemplateKind(kind)) return { bucket: UNSORTED, title: (name ?? "").trim() };
  return { bucket: kind, title: m[2].trim() };
}

/** The stored name for a (bucket, title) pair — the exact inverse of the parse
 *  for every recognised kind, so an edit that changes neither field rewrites the
 *  name byte-for-byte. `unsorted` emits a bare title, never `[unsorted] …`: the
 *  bucket means "this template declares no state", and writing that down would
 *  turn an absence into a claim. */
export function formatTemplateName(bucket: TemplateBucket, title: string): string {
  const clean = (title ?? "").trim();
  return bucket === UNSORTED ? clean : `[${bucket}] ${clean}`;
}
