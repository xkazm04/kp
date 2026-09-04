"use client";

import { sharedGetJson } from "./sharedGet";
import type { ApiErrorPayload } from "@/app/_lib/use-error-message";
import type { Template } from "./renderTemplate";

// The client half of the JD template list.
//
// It lives beside `renderTemplate.ts` rather than inside it because that module
// is imported by the SERVER (app/api/templates/route.ts, app/_lib/templates-store.ts,
// app/_lib/jd-build-run.ts) for its pure rendering and validation, and this file
// is `"use client"` — a browser fetch reached through `sharedGet`. Keeping the
// two apart is what lets the shared helper be used at all.

/** What a template load ACTUALLY produced. `failed` is the whole point: the list
 *  used to swallow every failure into `[]`, so "this workspace has no templates
 *  yet" and "the template service is down" reached the two surfaces as the same
 *  empty array — and one of them then told the reader, in a provenance line whose
 *  entire job is to be truthful, that a JD had been built through a template it
 *  simply could not name.
 *
 *  `failed` carries an `ApiErrorPayload`, not a message, because the client never
 *  renders the server's English (app/_lib/use-error-message.ts): each caller
 *  resolves it through `useErrorMessage()` in the reader's language. */
export type TemplateListResult = { templates: Template[]; failed: ApiErrorPayload | null };

/** Load the company JD templates. One shared contract — the endpoint shape AND
 *  the failure shape — for every caller, so a change to either lives in one
 *  place. JdBuilder layers its default-selection reconciliation on top of
 *  `templates`; the ledger's provenance line reads a single name out of it.
 *
 *  Through `sharedGetJson`, so the builder and a provenance modal opening in the
 *  same tick make ONE request instead of two.
 *
 *  The code is pinned rather than read off the body: `sharedGetJson` rejects on a
 *  non-2xx before the body is parsed, and `TEMPLATE_LIST_FAILED` is the only code
 *  GET /api/templates emits (app/api/templates/route.ts). A transport failure is
 *  the same sentence to the reader — "could not load templates" — so pinning it
 *  invents nothing. */
export async function fetchTemplates(): Promise<TemplateListResult> {
  try {
    const payload = await sharedGetJson<{ templates?: Template[] }>("/api/templates");
    return { templates: payload.templates ?? [], failed: null };
  } catch {
    // Not an empty catch: the reason IS the return value. Nothing is logged —
    // both surfaces show the failure, and a console line would only duplicate it.
    return { templates: [], failed: { code: "TEMPLATE_LIST_FAILED" } };
  }
}
