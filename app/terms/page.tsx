import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SALES_EMAIL } from "@/app/_lib/sales-contact";
import { CARD_PAD, EYEBROW, INTRO, PANEL, PANEL_SUNKEN, TITLE_DISPLAY } from "@/app/_components/ui/recipes";

/*
 * /terms — the public terms of service, in all four locales (the /about
 * generateMetadata pattern). Like /privacy, the content documents SHIPPED
 * behavior rather than aspiration: billing runs through Polar as merchant of
 * record (billing/polar.ts, /api/billing/portal), meters are human units
 * (billing/plans.ts), the controller/processor split and the EU AI Act
 * deployer duties mirror what /trust states article by article, and the
 * sealed-decision erasure carve-out is the one enforced in pipeline.ts.
 */

// The date of the last substantive copy change. Bump when the terms change
// meaning, not on refactors.
const UPDATED = "2026-08-05";

// Brand name, not copy — never localized (the Wordmark rule in
// docs/features/marketing/README.md), held as a constant so the i18n lint can
// tell it apart from translatable text.
const BRAND = "KandiDate";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legal.terms.meta");
  const title = t("title");
  const description = t("description");
  return { title, description, openGraph: { title, description } };
}

// Renders under the per-request locale layout (cookies), so Block it under
// Cache Components like /about and /trust.
export const instant = false;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="font-serif text-h2 text-ink">{title}</h2>
      {children}
    </section>
  );
}

export default async function TermsPage() {
  const t = await getTranslations("legal");
  return (
    <main className="mx-auto max-w-4xl px-6 py-12 lg:py-16">
      <header className="border-b border-stone-200 pb-8">
        <p className={EYEBROW}>{BRAND}</p>
        <h1 className={`mt-1 ${TITLE_DISPLAY}`}>{t("terms.title")}</h1>
        <p className={`mt-3 max-w-2xl ${INTRO}`}>{t("terms.intro")}</p>
        <p className="mt-3 text-sm text-steel">{t("updated", { date: UPDATED })}</p>
      </header>

      <Section title={t("terms.service.title")}>
        <p className="mt-2 text-body text-steel">{t("terms.service.body")}</p>
      </Section>

      <Section title={t("terms.accounts.title")}>
        <p className="mt-2 text-body text-steel">{t("terms.accounts.body")}</p>
      </Section>

      <Section title={t("terms.billing.title")}>
        <div className={`mt-4 ${PANEL} ${CARD_PAD} space-y-3`}>
          <p className="text-body text-steel">{t("terms.billing.polar")}</p>
          <p className="text-body text-steel">{t("terms.billing.meters")}</p>
        </div>
      </Section>

      <Section title={t("terms.customerData.title")}>
        <div className={`mt-4 ${PANEL} ${CARD_PAD} space-y-3`}>
          <p className="text-body text-steel">{t("terms.customerData.controller")}</p>
          <p className="text-body text-steel">{t("terms.customerData.processor")}</p>
        </div>
      </Section>

      <Section title={t("terms.ai.title")}>
        <div className={`mt-4 ${PANEL} ${CARD_PAD} space-y-3`}>
          <p className="text-body text-steel">{t("terms.ai.highRisk")}</p>
          <p className="text-body text-steel">{t("terms.ai.deployer")}</p>
        </div>
      </Section>

      <Section title={t("terms.use.title")}>
        <ul className={`mt-4 ${PANEL} ${CARD_PAD} list-disc space-y-2 pl-8`}>
          {(t.raw("terms.use.items") as string[]).map((line) => (
            <li key={line} className="text-body text-steel">
              {line}
            </li>
          ))}
        </ul>
      </Section>

      <Section title={t("terms.ip.title")}>
        <p className="mt-2 text-body text-steel">{t("terms.ip.body")}</p>
      </Section>

      <Section title={t("terms.warranty.title")}>
        <p className="mt-2 text-body text-steel">{t("terms.warranty.body")}</p>
      </Section>

      <Section title={t("terms.liability.title")}>
        <p className="mt-2 text-body text-steel">{t("terms.liability.body")}</p>
      </Section>

      <Section title={t("terms.termination.title")}>
        <p className="mt-2 text-body text-steel">{t("terms.termination.body")}</p>
      </Section>

      <Section title={t("terms.law.title")}>
        <p className="mt-2 text-body text-steel">{t("terms.law.body")}</p>
      </Section>

      <Section title={t("terms.changes.title")}>
        <p className="mt-2 text-body text-steel">{t("terms.changes.body")}</p>
      </Section>

      <Section title={t("terms.contact.title")}>
        <p className="mt-2 text-body text-steel">{t("terms.contact.body", { email: SALES_EMAIL })}</p>
      </Section>

      <footer className={`mt-10 ${PANEL_SUNKEN} ${CARD_PAD}`}>
        <p className="text-body text-steel">{t("disclaimer")}</p>
      </footer>
    </main>
  );
}
