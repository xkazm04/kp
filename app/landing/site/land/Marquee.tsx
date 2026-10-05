import { getTranslations } from "next-intl/server";

/*
 * The coral ribbon under the hero (prototype `.ribbon`): today's eight claims
 * (`landing.marquee`, the language claim pinned by MarketingClaims.test.ts),
 * scrolled by CSS (`mkl-marquee`, paused on hover and focus). The list is
 * doubled for a seamless loop; the copy is aria-hidden so a screen reader reads
 * the claims once. Reduced motion stops it and wraps the one list (land-landing.css).
 * No section id: nothing links to it.
 */
export default async function Marquee() {
  const t = await getTranslations("landing");
  const ts = await getTranslations("siteLand");
  const items = t.raw("marquee") as string[];
  const list = (hidden: boolean) => (
    <ul aria-hidden={hidden || undefined}>
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
  return (
    <div className="ribbon" role="group" aria-label={ts("marquee.label")}>
      <div className="ribbon-in">
        {list(false)}
        {list(true)}
      </div>
    </div>
  );
}
