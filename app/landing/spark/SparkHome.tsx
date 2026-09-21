import { Suspense } from "react";
import { Bricolage_Grotesque, Gabarito, Shantell_Sans } from "next/font/google";
import { DemoUnavailableNotice } from "./DemoUnavailableNotice";
import SparkLanding from "./SparkLanding";
import { TYPE_SCALE } from "./tokens";

/*
 * Spark landing + its scoped type system. The fonts load here (not in the route
 * page) so the same wrapper can be reused both at /landing/spark and as the
 * signed-out homepage slot ('/', server-gated in app/page.tsx). The font
 * variables are scoped to this subtree so the workspace fonts stay untouched:
 * Bricolage for display punch, Gabarito for friendly body text, Shantell for
 * the hand-drawn margin notes. TYPE_SCALE rides along on the same wrapper —
 * the marketing pages also run their own, larger size scale.
 */
const display = Bricolage_Grotesque({
  subsets: ["latin", "latin-ext"],
  variable: "--font-spark-display",
  display: "swap"
});

const body = Gabarito({
  subsets: ["latin", "latin-ext"],
  variable: "--font-spark-body",
  display: "swap"
});

const hand = Shantell_Sans({
  subsets: ["latin", "latin-ext"],
  variable: "--font-spark-hand",
  weight: ["400", "500"],
  display: "swap"
});

/** `signupOpen` is resolved SERVER-SIDE by the caller (app/page.tsx) from
 *  `workspace-lock.signupEnabled` and threaded straight through to the hero,
 *  whose primary CTA needs it to pick /signup over /login on a gated deploy.
 *  A single serializable boolean, so this wrapper stays a server component and
 *  the env never crosses to the client. */
export default function SparkHome({ signupOpen = false }: { signupOpen?: boolean }) {
  return (
    <div className={`${TYPE_SCALE} ${display.variable} ${body.variable} ${hand.variable}`}>
      {/* Demo-CTA honesty: /api/demo lands here with ?demo=unavailable when a
          gated deploy refuses the public demo — say so instead of a silent
          reload. Suspense: useSearchParams in a client child of this
          server-rendered page. */}
      <Suspense fallback={null}>
        <DemoUnavailableNotice />
      </Suspense>
      <SparkLanding signupOpen={signupOpen} />
    </div>
  );
}
