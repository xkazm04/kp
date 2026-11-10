import type { Metadata } from "next";
import { headers } from "next/headers";
import { LOCALES } from "@/i18n/locales";
import { isOpenMode, openEntryOffered } from "@/app/_lib/auth/open-entry";
import { signupEnabled } from "@/app/_lib/workspace-lock";
import SparkHome from "@/app/landing/spark/SparkHome";

// The public landing's own route: what an anonymous '/' serves. proxy.ts REWRITES '/'
// here (app/_lib/auth/root-surface.ts decides), so the browser URL stays '/' and this
// path is never linked; a direct hit is redirected back to '/'. A route of its own is
// the point: app/page.tsx no longer imports SparkHome, so an operator's '/' does not
// download the landing and a visitor's does not download the workspace
// (docs/architecture/app-structure.md, "First load of '/'").
//
// Reads the Host header (open-entry offer) and the request locale: request-time, so it
// cannot be prerendered under Cache Components. Block it, as '/' always was.
export const instant = false;

// The root layout's canonical and hreflang are relative ("./"), resolved against the
// RENDERED pathname, which under the rewrite is this route's. Pin them to '/', the
// address the visitor actually sees and the one robots.ts and sitemap.ts publish.
export function generateMetadata(): Metadata {
  return {
    alternates: {
      canonical: "/",
      languages: {
        ...Object.fromEntries(LOCALES.map((l) => [l, `/?lang=${l}`])),
        "x-default": "/",
      },
    },
  };
}

export default async function LandingHome() {
  // `signupOpen`: whether /signup exists on this deploy (KP_SIGNUP_ENABLED), resolved
  // with the same predicate the page and the register route use, never from a
  // NEXT_PUBLIC_ mirror. `openEntry`: a local open-mode install, where the landing
  // leads into the app (cx T2). Both are pure env/header reads: the landing stays DB-free.
  const openEntry = openEntryOffered({ openMode: isOpenMode(), host: (await headers()).get("host") });
  return <SparkHome signupOpen={signupEnabled()} openEntry={openEntry} />;
}
