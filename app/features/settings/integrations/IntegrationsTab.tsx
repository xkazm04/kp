"use client";

import { useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import { EYEBROW, INTRO, SECTION } from "@/app/_components/ui/recipes";
import { SectionTitle } from "@/app/_components/ui/SectionTitle";
import { Defer } from "@/app/_components/ui/Defer";
import { IntegrationsCalendarPanel } from "./IntegrationsCalendarPanel";

// connect-the-integrations — the credential surface for the two integrations W1 shipped
// engines for and no door to: Google Calendar (OAuth, app/_lib/calendar/**) and the
// inbound ATS connections (app/_lib/ats/connections-store.ts). The OUTBOUND write-back
// webhook (kp.ats.v1) joined them here from the Background-tasks tab: reading
// applications in and writing outcomes back are the two halves of one ATS seam, and an
// operator looks for both under "what can this connect to".
//
// ONE tab rather than one per integration, deliberately: an operator setting kp up asks
// "what can this connect to", not "where is the calendar page". Every panel obeys the same
// contract — the credential is write-only over the API, and a deployment with no
// credentials configured SAYS SO instead of offering a button that cannot work.
//
// The calendar panel is first and eager: it is also the landing target of the OAuth
// callback (`/?tab=integrations&calendar=<code>`), so it must be mounted on the frame the
// redirect lands on or the outcome banner would appear a beat late.

// Tier 3 (docs/design/loading-choreography.md): the ATS panel is secondary to the
// calendar one on the frame the OAuth callback lands on — own chunk, mounted an idle
// beat later.
const IntegrationsAtsPanel = dynamic(
  () => import("./IntegrationsAtsPanel").then((m) => ({ default: m.IntegrationsAtsPanel })),
  { loading: () => <div className="reveal-quiet min-h-[16rem]" aria-hidden /> }
);
// The Personas bridge card (agent-candidate bridge) — same Tier 3 treatment as
// the ATS panel: not on the OAuth-callback critical path, own chunk, idle mount.
const IntegrationsPersonasPanel = dynamic(
  () => import("./IntegrationsPersonasPanel").then((m) => ({ default: m.IntegrationsPersonasPanel })),
  { loading: () => <div className="reveal-quiet min-h-[12rem]" aria-hidden /> }
);
// The outbound ATS/HRIS write-back webhook — same Tier 3 treatment, and rendered
// directly under the inbound ATS panel it mirrors.
const IntegrationsWebhookPanel = dynamic(
  () => import("./IntegrationsWebhookPanel").then((m) => ({ default: m.IntegrationsWebhookPanel })),
  { loading: () => <div className="reveal-quiet min-h-[20rem]" aria-hidden /> }
);

export function IntegrationsTab() {
  const t = useTranslations("integrations.tab");

  return (
    <section className={`stagger-children ${SECTION}`}>
      <header>
        <p className={EYEBROW}>{t("eyebrow")}</p>
        <SectionTitle className="mt-1">{t("title")}</SectionTitle>
        <p className={`mt-2 max-w-2xl ${INTRO}`}>{t("intro")}</p>
      </header>

      <IntegrationsCalendarPanel />

      <Defer strategy="idle">
        <IntegrationsAtsPanel />
      </Defer>

      <Defer strategy="idle">
        <IntegrationsWebhookPanel />
      </Defer>

      <Defer strategy="idle">
        <IntegrationsPersonasPanel />
      </Defer>
    </section>
  );
}
