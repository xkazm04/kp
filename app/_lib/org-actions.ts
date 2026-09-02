"use server";

import { cookies } from "next/headers";
import { isLocale, LOCALE_COOKIE, type Locale } from "@/i18n/locales";
import { requireOrgCapability } from "./auth/current-user";
import { currentWorkspace } from "./auth/current-workspace";
import { setWorkspaceDefaultLocale } from "./db/workspaces";
import { ORG_NAME_COOKIE, sanitizeOrgName } from "./org-settings";

// One year — the org identity should persist across sessions, matching the
// NEXT_LOCALE cookie's lifetime (i18n/actions.ts).
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** What an org setting write answers with. A server action cannot hand back a
 *  NextResponse, so the refusal travels as the same machine CODE every route uses
 *  (`useErrorMessage` resolves `errors.<CODE>`); the caller never renders English
 *  of its own. */
export type OrgSettingResult = { ok: true } | { ok: false; code: "ORG_SETTINGS_FORBIDDEN" | "ORG_LANGUAGE_INVALID" };

/**
 * The authority gate both settings below share.
 *
 * These two actions are the ONLY writes on the Organization tab, and until now
 * neither asked who was calling: every route beside them (`/api/workspace/export`,
 * `/api/workspace/import`, `/api/org/*`) resolves a capability first, but a server
 * action is reachable by any signed-in recruiter with a POST, and `setOrgLanguage`
 * writes `workspaces.default_locale` — a SHARED row that decides the language of
 * background automation passes and every candidate email sent without a request
 * cookie. Changing it is an org-wide act, so it takes the org-wide capability.
 *
 * `requireOrgCapability` is the same helper the export route uses (export/route.ts):
 * it resolves the caller's capabilities from live memberships ACROSS the org rather
 * than from the session's team, so an admin of one team cannot be a recruiter here.
 * It answers with a NextResponse, which an action has no use for — a non-null
 * answer is the refusal, and that is all we read from it.
 */
async function orgManageDenied(): Promise<boolean> {
  return (await requireOrgCapability("org:manage")) !== null;
}

/** Persist the organization name in the `kp_org_name` cookie. Called from the
 *  Organization settings page. Sanitized (trim + clamp) before write so the
 *  cookie can't hold an oversized or whitespace-only value; the effective read
 *  falls back to the default when it's empty.
 *
 *  The name's STORAGE is deliberately a per-browser cookie (owner decision, kept):
 *  that is not what the gate is about. Branding the company is an administrator's
 *  act whatever it is stored in, and leaving one of the tab's two settings ungated
 *  would teach the next reader that the check is decorative. */
export async function setOrgName(name: string): Promise<OrgSettingResult> {
  if (await orgManageDenied()) return { ok: false, code: "ORG_SETTINGS_FORBIDDEN" };
  (await cookies()).set(ORG_NAME_COOKIE, sanitizeOrgName(name), {
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
    sameSite: "lax",
  });
  return { ok: true };
}

/** Set the organization's app language. Writes it to BOTH authorities so every
 *  LLM output follows it, not just the ones that read a request cookie:
 *   • the NEXT_LOCALE cookie — the UI + request-scoped recruiter generation
 *     (getServerLocale: CV analysis, JD build, match reasoning, on-demand HR tasks);
 *   • the workspace default locale — background automation passes + candidate-comms
 *     fallback (getWorkspaceDefaultLocale), which run with no request cookie.
 *  The caller follows with router.refresh() so the app re-renders under it. */
export async function setOrgLanguage(locale: Locale): Promise<OrgSettingResult> {
  // A malformed locale is a bad ARGUMENT, not a refused one: it answers its own
  // code rather than borrowing the authority refusal's, so the console can never
  // tell a recruiter they lack a permission when they actually sent nonsense.
  if (!isLocale(locale)) return { ok: false, code: "ORG_LANGUAGE_INVALID" };
  if (await orgManageDenied()) return { ok: false, code: "ORG_SETTINGS_FORBIDDEN" };
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
    sameSite: "lax",
  });
  setWorkspaceDefaultLocale(locale, await currentWorkspace());
  return { ok: true };
}
