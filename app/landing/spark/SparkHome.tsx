import "../site/land/styles";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { DemoUnavailableNotice } from "./DemoUnavailableNotice";
import MkRoot from "../site/chrome/MkRoot";
import Header from "../site/chrome/Header";
import Footer from "../site/chrome/Footer";
import CtaDock from "../site/chrome/CtaDock";
import LandingPage from "../site/land/LandingPage";

/*
 * The signed-out homepage ('/', server-gated in app/page.tsx): the fused
 * prototype's landing (app/landing/site/, see its README). The route shell only:
 * the site root with its fonts, the shared header / footer / phone dock, and the
 * landing's bands. `../site/land/styles` is imported first on purpose: it is the
 * landing's whole stylesheet list, in cascade order.
 *
 * `signupOpen` is resolved SERVER-SIDE by the caller (app/page.tsx) from
 * `workspace-lock.signupEnabled` and threaded to every "Start hiring free"
 * (chrome/Ctas StartCta), which needs it to pick /signup over /login on a gated
 * deploy. A single serializable boolean: the env never crosses to the client.
 */
export default async function SparkHome({ signupOpen = false }: { signupOpen?: boolean }) {
  const t = await getTranslations("siteChrome");
  return (
    <>
      <MkRoot mode="land">
        <a className="skip" href="#features">
          {t("skip.land")}
        </a>
        <Header page="land" signupOpen={signupOpen} />
        <LandingPage signupOpen={signupOpen} />
        <Footer page="land" />
        <CtaDock signupOpen={signupOpen} placement="dock" />
      </MkRoot>
      {/* Demo-CTA honesty: /api/demo lands here with ?demo=unavailable when a
          gated deploy refuses the public demo; say so instead of a silent
          reload. Outside the site root on purpose: it is drawn with the app's
          Tailwind utilities, which the root's user-agent reset would undo.
          Suspense: useSearchParams in a client child of this server-rendered page. */}
      <Suspense fallback={null}>
        <DemoUnavailableNotice signupOpen={signupOpen} />
      </Suspense>
    </>
  );
}
