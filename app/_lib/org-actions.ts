"use server";

import { cookies } from "next/headers";
import { isLocale, LOCALE_COOKIE, type Locale } from "@/i18n/locales";
import { currentWorkspace } from "./auth/current-workspace";
import { setWorkspaceDefaultLocale } from "./db/workspaces";
import { ORG_NAME_COOKIE, sanitizeOrgName } from "./org-settings";

// One year — the org identity should persist across sessions, matching the
// NEXT_LOCALE cookie's lifetime (i18n/actions.ts).
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** Persist the organization name in the `kp_org_name` cookie. Called from the
 *  Organization settings page. Sanitized (trim + clamp) before write so the
 *  cookie can't hold an oversized or whitespace-only value; the effective read
 *  falls back to the default when it's empty. */
export async function setOrgName(name: string): Promise<void> {
  (await cookies()).set(ORG_NAME_COOKIE, sanitizeOrgName(name), {
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
    sameSite: "lax",
  });
}

/** Set the organization's app language. Writes it to BOTH authorities so every
 *  LLM output follows it, not just the ones that read a request cookie:
 *   • the NEXT_LOCALE cookie — the UI + request-scoped recruiter generation
 *     (getServerLocale: CV analysis, JD build, match reasoning, on-demand HR tasks);
 *   • the workspace default locale — background automation passes + candidate-comms
 *     fallback (getWorkspaceDefaultLocale), which run with no request cookie.
 *  The caller follows with router.refresh() so the app re-renders under it. */
export async function setOrgLanguage(locale: Locale): Promise<void> {
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
    sameSite: "lax",
  });
  setWorkspaceDefaultLocale(locale, await currentWorkspace());
}
