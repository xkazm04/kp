import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { consentRetentionMonths } from "@/app/_lib/consent";
import { SALES_EMAIL } from "@/app/_lib/sales-contact";
import { SUBPROCESSORS } from "@/app/_lib/trust-posture";
import { CARD_PAD, EYEBROW, INTRO, PANEL, PANEL_SUNKEN, TITLE_DISPLAY } from "@/app/_components/ui/recipes";
import { LanguageSwitcher } from "@/app/_components/LanguageSwitcher";
import LegalRow from "@/app/landing/spark/sections/LegalRow";

/*
 * /privacy — the public privacy policy, in all four locales (the /about
 * generateMetadata pattern). The content documents SHIPPED behavior and is
 * single-sourced from the code that enforces it wherever a figure could drift:
 *   - the retention window is derived from consentRetentionMonths() (consent.ts),
 *     never typed by hand — the REC-08 lesson (the copy once hardcoded
 *     "12 months" while KP_CONSENT_TTL_DAYS was tunable);
 *   - the subprocessor set comes from trust-posture.ts SUBPROCESSORS (names
 *     are brands, so they read the same in every locale);
 *   - the contact address is the same configurable NEXT_PUBLIC_SALES_EMAIL the
 *     rest of the marketing surface uses.
 * The candidate-facing mechanisms it describes are real routes: /data/[token]
 * (access + erasure), the interview consent gate (interview-consent.ts), the
 * AiDisclosure component (Art. 50), and the sealed-decision erasure carve-out
 * (pipeline.ts, Art. 17(3)(b)/(e)).
 */

// The date of the last substantive copy change. Bump when the policy text
// changes meaning, not on refactors.
const UPDATED = "2026-09-04";

// Brand name, not copy — never localized (the Wordmark rule in
// docs/features/marketing/README.md), held as a constant so the i18n lint can
// tell it apart from translatable text.
const BRAND = "KandiDate";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legal.privacy.meta");
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

export default async function PrivacyPage() {
  const t = await getTranslations("legal");
  const months = consentRetentionMonths();
  const subprocessorList = SUBPROCESSORS.map((s) => s.name).join(", ");
  return (
    <main className="mx-auto max-w-4xl px-6 py-12 lg:py-16">
      <header className="border-b border-stone-200 pb-8">
        <p className={EYEBROW}>{BRAND}</p>
        <h1 className={`mt-1 ${TITLE_DISPLAY}`}>{t("privacy.title")}</h1>
        <p className={`mt-3 max-w-2xl ${INTRO}`}>{t("privacy.intro")}</p>
        <p className="mt-3 text-sm text-steel">{t("updated", { date: UPDATED })}</p>
      </header>

      <Section title={t("privacy.roles.title")}>
        <div className={`mt-4 ${PANEL} ${CARD_PAD} space-y-3`}>
          <p className="text-body text-steel">{t("privacy.roles.controller")}</p>
          <p className="text-body text-steel">{t("privacy.roles.processor")}</p>
          <p className="text-body text-steel">{t("privacy.roles.account")}</p>
        </div>
      </Section>

      <Section title={t("privacy.data.title")}>
        <p className="mt-2 text-body text-steel">{t("privacy.data.intro")}</p>
        <ul className={`mt-4 ${PANEL} ${CARD_PAD} list-disc space-y-2 pl-8`}>
          {(t.raw("privacy.data.items") as string[]).map((line) => (
            <li key={line} className="text-body text-steel">
              {line}
            </li>
          ))}
        </ul>
      </Section>

      <Section title={t("privacy.consent.title")}>
        <div className={`mt-4 ${PANEL} ${CARD_PAD} space-y-3`}>
          <p className="text-body text-steel">{t("privacy.consent.gate")}</p>
          {/* {months} is computed from the live KP_CONSENT_TTL_DAYS config — see the
              header comment for why this figure must never be a literal. */}
          <p className="text-body text-ink">{t("privacy.consent.retention", { months })}</p>
          <p className="text-body text-steel">{t("privacy.consent.expiry")}</p>
          <p className="text-body text-steel">{t("privacy.consent.readGate")}</p>
        </div>
      </Section>

      <Section title={t("privacy.rights.title")}>
        <p className="mt-2 text-body text-steel">{t("privacy.rights.intro")}</p>
        <ul className={`mt-4 ${PANEL} ${CARD_PAD} list-disc space-y-2 pl-8`}>
          {(t.raw("privacy.rights.items") as string[]).map((line) => (
            <li key={line} className="text-body text-steel">
              {line}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-body text-steel">{t("privacy.rights.erasure")}</p>
        <p className="mt-3 border-l-2 border-stone-200 pl-3 text-body text-steel">{t("privacy.rights.carveout")}</p>
      </Section>

      <Section title={t("privacy.voice.title")}>
        <p className="mt-2 text-body text-steel">{t("privacy.voice.body")}</p>
      </Section>

      <Section title={t("privacy.ai.title")}>
        <div className={`mt-4 ${PANEL} ${CARD_PAD} space-y-3`}>
          <p className="text-body text-steel">{t("privacy.ai.oversight")}</p>
          <p className="text-body text-steel">{t("privacy.ai.sealed")}</p>
        </div>
      </Section>

      <Section title={t("privacy.subprocessors.title")}>
        <p className="mt-2 text-body text-steel">{t("privacy.subprocessors.body", { list: subprocessorList })}</p>
        <p className="mt-2 text-body text-steel">
          <a href="/trust" className="font-semibold text-ink underline underline-offset-2">
            {t("privacy.subprocessors.trustLink")}
          </a>
        </p>
      </Section>

      <Section title={t("privacy.billing.title")}>
        <p className="mt-2 text-body text-steel">{t("privacy.billing.body")}</p>
      </Section>

      <Section title={t("privacy.security.title")}>
        <ul className={`mt-4 ${PANEL} ${CARD_PAD} list-disc space-y-2 pl-8`}>
          {(t.raw("privacy.security.items") as string[]).map((line) => (
            <li key={line} className="text-body text-steel">
              {line}
            </li>
          ))}
        </ul>
      </Section>

      {/* What the app puts in the reader's browser, and the analytics this very
          page's site fires. Neither was named anywhere: the policy described what
          the product does with candidate data and said nothing about the four
          storage items it sets, nor about Plausible, which the root layout mounts
          on every public page including this one. The items are described here in
          prose; the names they carry are in the catalog copy so a reader can match
          them against what their browser shows. */}
      <Section title={t("privacy.cookies.title")}>
        <p className="mt-2 text-body text-steel">{t("privacy.cookies.intro")}</p>
        <ul className={`mt-4 ${PANEL} ${CARD_PAD} list-disc space-y-2 pl-8`}>
          {(t.raw("privacy.cookies.items") as string[]).map((line) => (
            <li key={line} className="text-body text-steel">
              {line}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-body text-steel">{t("privacy.cookies.analytics")}</p>
        <p className="mt-2 text-body text-steel">{t("privacy.cookies.noConsentBanner")}</p>
      </Section>

      <Section title={t("privacy.contact.title")}>
        <p className="mt-2 text-body text-steel">{t("privacy.contact.body", { email: SALES_EMAIL })}</p>
      </Section>

      {/* The same legal row and language control every other public front door
          carries. These three pages had exactly one link between them (privacy to
          trust) and no way to change language at all, so a reader who arrived on
          /terms from a search result in German had no route to the policy beside it
          and no way to read either one in their own language. */}
      <footer className={`mt-10 ${PANEL_SUNKEN} ${CARD_PAD} space-y-4`}>
        <p className="text-body text-steel">{t("disclaimer")}</p>
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-stone-200 pt-4">
          <LegalRow tone="studio" />
          <LanguageSwitcher />
        </div>
      </footer>
    </main>
  );
}
