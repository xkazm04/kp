// Pure, React-free core of the JD-template manager's CRUD — the request shapes,
// the response→outcome classification, the history-free list load and the
// validation-code→catalog-key map. Extracted from jdsTemplateManagerLogic.ts (a
// hook, and therefore untestable on this node:test harness) because the template
// CRUD was the one write path in the library with no test at all: a template list
// that failed to load painted its skeleton forever, and a refusal arrived as
// English prose.
//
// Same split, same reason as jdsEditClient.ts for the JD editors.

import type { TemplateFieldError } from "@/app/features/shared/renderTemplate";

export type TemplateFetch = (input: string, init?: RequestInit) => Promise<Response>;

/** A template as the MANAGER needs it: the shared `Template` projection plus the
 *  `updatedAt` stamp the row already carries on the wire and nothing read. It is
 *  the CAS token — an edit sends back the stamp it loaded, so a second recruiter's
 *  save is refused (409) instead of erasing the first. Optional because a store
 *  predating the CAS, or a hand-rolled client, may not carry one. */
export type ManagedTemplate = {
  id: string;
  name: string;
  body: string;
  isDefault: boolean;
  scope: "org" | "team";
  updatedAt?: string;
};

/** The draft being edited. `updatedAt` is the stamp of the row it was opened
 *  from — absent for a create. */
export type TemplateDraft = { id?: string; name: string; body: string; scope: "org" | "team"; updatedAt?: string };

/** What a template write resolved to. `gate` = the operator door refused (401/403);
 *  `conflict` = someone else saved first (409); `error` = anything else non-2xx. */
export type TemplateWriteOutcome = "ok" | "gate" | "conflict" | "error";

export type TemplateResponseBody = { code?: string; error?: string; template?: ManagedTemplate | null } | null;

export function classifyTemplateResponse(status: number, body: TemplateResponseBody): TemplateWriteOutcome {
  if (status === 401 || status === 403) return "gate";
  // Belt-and-suspenders on the code as well as the status, the same shape
  // classifyJdWriteResponse uses: a stale save is a conflict however it arrives.
  if (status === 409 || body?.code === "TEMPLATE_STALE") return "conflict";
  if (status < 200 || status >= 300) return "error";
  return "ok";
}

/** The catalog key (and ICU values) for a client-side validation refusal. The
 *  hook binds `t` to it; keeping the MAP pure is what lets a test prove every
 *  TemplateFieldError code has a key — a switch that silently fell through used
 *  to be possible only in review. */
export function templateErrorKey(reason: TemplateFieldError): { key: string; values?: Record<string, string | number> } {
  switch (reason.code) {
    case "bothRequired":
      return { key: "errBothRequired" };
    case "nameEmpty":
      return { key: "errNameEmpty" };
    case "bodyEmpty":
      return { key: "errBodyEmpty" };
    case "tooLong":
      return { key: reason.field === "name" ? "errNameTooLong" : "errBodyTooLong", values: { max: reason.max } };
    case "unknownTokens":
      return { key: "errUnknownTokens", values: { count: reason.tokens.length } };
  }
}

/** The write a draft turns into. A create POSTs and carries its scope (publishing
 *  to the org library is chosen once, at creation); an edit PUTs name/body plus
 *  the CAS stamp and never re-sends scope. */
export function templateSaveRequest(
  draft: { id?: string; scope: "org" | "team"; updatedAt?: string },
  fields: { name: string; body: string }
): { url: string; method: "POST" | "PUT"; payload: Record<string, unknown> } {
  if (!draft.id) {
    return { url: "/api/templates", method: "POST", payload: { name: fields.name, body: fields.body, scope: draft.scope } };
  }
  return {
    url: `/api/templates/${encodeURIComponent(draft.id)}`,
    method: "PUT",
    payload: { name: fields.name, body: fields.body, ...(draft.updatedAt ? { expectedUpdatedAt: draft.updatedAt } : {}) },
  };
}

/** One template write, classified. */
export async function sendTemplateWrite(
  req: { url: string; method: "POST" | "PUT" | "DELETE"; payload?: Record<string, unknown> },
  fetchImpl: TemplateFetch = fetch
): Promise<{ outcome: TemplateWriteOutcome; body: TemplateResponseBody }> {
  const r = await fetchImpl(req.url, {
    method: req.method,
    ...(req.payload ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(req.payload) } : {}),
  });
  const body = (await r.json().catch(() => null)) as TemplateResponseBody;
  return { outcome: classifyTemplateResponse(r.status, body), body };
}

/** Load the manager's list. THROWS on a failed request or an unusable body — the
 *  shared `fetchTemplates` swallows to `[]`, which is right for the builder's
 *  picker (a missing list is not worth blocking a build) and wrong here: the
 *  manager rendered `null` as a skeleton, so a rejected load left it pulsing
 *  forever with no error and an unhandled rejection in the console. */
/** The list plus the server's own statement that it is PARTIAL. The manager is the one
 *  surface that claims to show a team its whole library, so a bounded read it cannot
 *  see would be a quiet lie about what exists. */
export type ManagedTemplateList = { templates: ManagedTemplate[]; truncated: boolean };

export async function loadManagedTemplates(fetchImpl: TemplateFetch = fetch): Promise<ManagedTemplateList> {
  const r = await fetchImpl("/api/templates");
  if (!r.ok) throw new Error(`templates ${r.status}`);
  const p = (await r.json()) as { templates?: ManagedTemplate[]; truncated?: boolean } | null;
  if (!p || !Array.isArray(p.templates)) throw new Error("templates: unexpected body");
  return { templates: p.templates, truncated: p.truncated === true };
}
