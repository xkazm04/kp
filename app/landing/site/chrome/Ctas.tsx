"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { enterWorkspace } from "@/app/_lib/auth/session-nav";
import { track } from "@/app/_lib/analytics/plausible";
import { GLYPH } from "./glyphs";

/*
 * The site's three actions, with today's real behaviour (the prototype's were
 * placeholders). Every "start" and "demo" button on the landing and About is one
 * of these, whatever it looks like: the look is the `className` (`btn btn-sm
 * primary`, `btn btn-lg`, ...), the behaviour never varies.
 *
 * StartCta: "Start hiring free". A link to the sign-in surface this deploy
 * offers a stranger (/signup when `signupOpen`, else /login; that is also the
 * no-script path). With scripts it first tries the credential-less entry
 * (enterWorkspace): open mode lands on the dashboard, a gated deploy is handed to
 * the same /signup or /login. `plan` carries a picked pricing tier through: into
 * the href, into enterWorkspace, and into the `landing_cta_click` payload.
 * `signupOpen` is resolved on the server (app/page.tsx, AboutHome) and passed
 * down; never re-read on the client.
 *
 * DemoCta: "Watch the live demo". A plain navigation to /api/demo, which mints a
 * demo workspace and lands on /?sim=auto (or back here with ?demo=unavailable,
 * which DemoUnavailableNotice explains).
 *
 * SignIn: today's sign-in (enterWorkspace with no fallback -> /login).
 */

type CtaLook = { className?: string; children?: ReactNode };

export function StartCta({
  signupOpen,
  placement,
  plan,
  arrow = false,
  className = "btn btn-sm primary",
  children
}: CtaLook & {
  signupOpen: boolean;
  /** Analytics placement, e.g. "header", "hero", "dock", "about-hero". */
  placement: string;
  plan?: string;
  /** Append the prototype's → after the label. */
  arrow?: boolean;
}) {
  const t = useTranslations("landing");
  const fallback = signupOpen ? "/signup" : "/login";
  const href = plan ? `${fallback}?plan=${encodeURIComponent(plan)}` : fallback;
  // enterWorkspace always navigates away; the only way back to a live copy of this
  // button is the bfcache, which replays no click, so that is where pending clears.
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setPending(false);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);
  return (
    <a
      className={className}
      href={href}
      aria-busy={pending || undefined}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        if (pending) return;
        setPending(true);
        // Placement + plan attribution, as the retired pricing band sent it (the
        // downstream workspace_entered event carries the plan too).
        track("landing_cta_click", plan ? { placement, plan } : { placement });
        void enterWorkspace(plan, { fallback });
      }}
    >
      {pending ? t("hero.ctaPending") : (children ?? t("hero.ctaPrimary"))}
      {arrow ? <span aria-hidden="true">{GLYPH.next}</span> : null}
    </a>
  );
}

export function DemoCta({
  play = false,
  className = "btn btn-sm",
  children
}: CtaLook & {
  /** Append the prototype's ▶ after the label. */
  play?: boolean;
}) {
  const t = useTranslations("landing");
  return (
    <a className={className} href="/api/demo" onClick={() => track("landing_demo_click")}>
      {children ?? t("hero.ctaDemo")}
      {play ? (
        <span className="ply" aria-hidden="true">
          {GLYPH.play}
        </span>
      ) : null}
    </a>
  );
}

export function SignIn({ className, onDone }: { className?: string; onDone?: () => void }) {
  const t = useTranslations("landing");
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        onDone?.();
        void enterWorkspace();
      }}
    >
      {t("nav.signIn")}
    </button>
  );
}
