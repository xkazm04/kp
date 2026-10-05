import { getTranslations } from "next-intl/server";
import { salesContactHref } from "@/app/_lib/sales-contact";
import { GLYPH } from "../chrome/glyphs";
import { Edge } from "./art/Edge";
import { EnterpriseArt } from "./art/PricingArt";
import { TrackedLink } from "./art/TrackedLink";

/*
 * The enterprise band (prototype `.sec.enterprise#enterprise`): what an org-scale
 * buyer gets, with each capability marked honestly as in the repository today,
 * delivered by us, or planned; then the three sourced recruiting-time figures.
 * Copy of record is today's `landing.pricing.enterprise.*` (MarketingClaims.test.ts
 * pins that SSO is listed exactly once and marked planned in every locale). "Talk
 * to sales" is today's mailto (salesContactHref), not the prototype's #start.
 *
 * The capability list is the catalog's. A trailing parenthetical, "(planned)" in
 * each language, becomes the prototype's dashed "planned" tag and marks the row
 * planned; the others take their kind from CAPABILITY_KIND by position.
 */
const CAPABILITY_KIND = ["repo", "repo", "repo", "deliv", "deliv", "deliv"] as const;

const TRAILING_NOTE = /^(.*?)\s*\(([^()]+)\)\s*$/;

export default async function Enterprise() {
  const t = await getTranslations("landing");
  const ts = await getTranslations("siteLand");
  const tCommon = await getTranslations("common");
  const capabilities = t.raw("pricing.enterprise.capabilities") as string[];

  return (
    <section className="sec enterprise" id="enterprise" aria-labelledby="entH">
      <Edge d="M0 60V24Q240 50 500 20T980 22T1300 32T1600 10V60Z" />
      <div className="wrap">
        <div className="ent-grid">
          <div className="ent-l">
            <p className="eyebrow-s">{t("pricing.enterprise.eyebrow")}</p>
            <h2 id="entH">{t("pricing.enterprise.heading")}</h2>
            <p className="lead">{t("pricing.enterprise.blurb")}</p>
            <div className="ent-cta">
              <TrackedLink
                className="btn primary"
                href={salesContactHref(tCommon("salesEnquirySubject"))}
                placement="pricing"
                plan="enterprise"
              >
                {t("pricing.enterprise.cta")} <span aria-hidden="true">{GLYPH.next}</span>
              </TrackedLink>
            </div>
            <p className="ent-note">{t("pricing.enterprise.roadmapNote")}</p>
          </div>
          <div className="ent-r">
            <EnterpriseArt />
            <ul className="ent-list">
              {capabilities.map((cap, i) => {
                const note = TRAILING_NOTE.exec(cap);
                const kind = note ? "planned" : (CAPABILITY_KIND[i] ?? "deliv");
                return (
                  <li key={i} className={kind}>
                    <span className="k" aria-hidden="true" />
                    {note ? note[1] : cap}
                    {note ? <em>{note[2]}</em> : null}
                  </li>
                );
              })}
            </ul>
            <p className="ent-legend">
              <span className="k repo" aria-hidden="true" />
              {ts("enterprise.legendRepo")} <span className="k deliv" aria-hidden="true" />
              {ts("enterprise.legendDelivered")} <span className="k planned" aria-hidden="true" />
              {ts("enterprise.legendPlanned")}
            </p>
          </div>
        </div>
        <div className="stats" role="group" aria-label={ts("enterprise.statsLabel")}>
          {([1, 2, 3] as const).map((n) => (
            <div key={n}>
              <b>{t(`pricing.enterprise.stat${n}Value`)}</b>
              <span>{t(`pricing.enterprise.stat${n}Label`)}</span>
            </div>
          ))}
        </div>
        <p className="src">{t("pricing.enterprise.source")}</p>
      </div>
    </section>
  );
}
