import type { ReactNode } from "react";
import { CV_HEADINGS, levelPips, type CvAccent, type CvContact, type CvDocument, type CvTemplate } from "./cvDocument";
import "./cv.css";

// The designed CV — one markup, three templates (cv.css). Pure and hook-free, so the
// server print page (/me/cv/print, which headless Chromium turns into the PDF) and the
// client preview in the /me flow render the SAME component: what the seeker sees in the
// preview is what the PDF carries.
//
// The headings are the CV's own language (CV_HEADINGS by `doc.lang`), not the reader's UI
// locale — they are part of the document, like its bullets. The DOM order is head ->
// experience -> side so text-order parsers (an ATS) read the name, then the work.

const ICON: Record<CvContact["kind"] | "location", ReactNode> = {
  email: <path d="M3 6h18v12H3zM3 7l9 6 9-6" />,
  phone: <path d="M6.5 3h3l1.5 4.5-2 1.2a11 11 0 0 0 6.3 6.3l1.2-2 4.5 1.5v3A2 2 0 0 1 19 20 16 16 0 0 1 4 5a2 2 0 0 1 2.5-2z" />,
  linkedin: <path d="M4 4h16v16H4zM8 10v6M8 7.5v.01M12 16v-3.5a2 2 0 0 1 4 0V16M12 10v6" />,
  github: <path d="M9 19c-4 1.3-4-2-6-2.5M15 21v-3.4a3 3 0 0 0-.8-2.3c2.7-.3 5.5-1.3 5.5-6A4.6 4.6 0 0 0 18.4 6 4.3 4.3 0 0 0 18.3 3S17.2 2.7 15 4.2a12.6 12.6 0 0 0-6 0C6.8 2.7 5.7 3 5.7 3a4.3 4.3 0 0 0-.1 3.2 4.6 4.6 0 0 0-1.3 3.2c0 4.7 2.8 5.7 5.5 6a3 3 0 0 0-.8 2.3V21" />,
  url: <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" />,
  location: <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" />,
};

function Glyph({ kind }: { kind: keyof typeof ICON }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ICON[kind]}
    </svg>
  );
}

export function DesignedCv({ doc, template, accent, id }: { doc: CvDocument; template: CvTemplate; accent: CvAccent; id?: string }) {
  const h = CV_HEADINGS[doc.lang];
  const detailed = doc.experience.filter((r) => r.bullets.length > 0);
  const short = doc.experience.filter((r) => r.bullets.length === 0);
  const titled = doc.skills.some((g) => g.title);

  return (
    <article id={id} className="cvsheet" data-template={template} data-accent={accent} lang={doc.lang}>
      <header className="cv-head">
        <p className="cv-name">{doc.name}</p>
        {doc.headline ? <p className="cv-headline">{doc.headline}</p> : null}
        {doc.contacts.length || doc.location ? (
          <ul className="cv-contacts" aria-label={h.contact}>
            {doc.location ? (
              <li>
                <Glyph kind="location" />
                {doc.location}
              </li>
            ) : null}
            {doc.contacts.map((c) => (
              <li key={`${c.kind}:${c.value}`}>
                <Glyph kind={c.kind} />
                <a href={c.href}>{c.value}</a>
              </li>
            ))}
          </ul>
        ) : null}
      </header>

      <div className="cv-main">
        {doc.summary ? (
          <section className="cv-sec">
            <h3 className="cv-sec-title">{h.summary}</h3>
            <p className="cv-summary">{doc.summary}</p>
          </section>
        ) : null}
        {doc.experience.length ? (
          <section className="cv-sec">
            <h3 className="cv-sec-title">{h.experience}</h3>
            {detailed.map((r, i) => (
              <div key={`d${i}`} className="cv-role">
                <div className="cv-role-head">
                  <h4 className="cv-role-title">{r.role}</h4>
                  {r.dates ? <span className="cv-dates">{r.dates}</span> : null}
                  {r.org ? <span className="cv-org">{r.org}</span> : null}
                </div>
                <ul className="cv-bullets">
                  {r.bullets.map((b, j) => (
                    <li key={j}>
                      {b.lead ? <b>{b.lead}: </b> : null}
                      {b.text}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {short.map((r, i) => (
              <div key={`s${i}`} className="cv-role is-short">
                <div className="cv-role-head">
                  <h4 className="cv-role-title">
                    {r.role}
                    {r.org ? <span className="cv-org"> · {r.org}</span> : null}
                  </h4>
                  {r.dates ? <span className="cv-dates">{r.dates}</span> : null}
                </div>
              </div>
            ))}
          </section>
        ) : null}
      </div>

      <div className="cv-side">
        {doc.skills.length ? (
          <section className="cv-sec is-skills">
            <h3 className="cv-sec-title">{h.skills}</h3>
            <div className="cv-groups">
              {doc.skills.map((g, i) => {
                const levelled = g.items.some((it) => it.level);
                return (
                  <div key={i} className="cv-group">
                    {titled && g.title ? <h4 className="cv-group-title">{g.title}</h4> : null}
                    {levelled ? (
                      <ul className="cv-skills">
                        {g.items.map((it) => {
                          const n = levelPips(it.level);
                          return (
                            <li key={it.name} className="cv-skill">
                              <span>{it.name}</span>
                              {n ? (
                                <span className="cv-pips" data-n={n}>
                                  <i />
                                  <i />
                                  <i />
                                  <span className="cv-level">({it.level})</span>
                                </span>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <ul className="cv-tags">
                        {g.items.map((it) => (
                          <li key={it.name}>{it.name}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}
        {doc.languages.length ? (
          <section className="cv-sec">
            <h3 className="cv-sec-title">{h.languages}</h3>
            <ul className="cv-tags">
              {doc.languages.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </section>
        ) : null}
        {doc.education.length ? (
          <section className="cv-sec">
            <h3 className="cv-sec-title">{h.education}</h3>
            {doc.education.map((e, i) => (
              <div key={i}>
                <p className="cv-edu-title">{e.title}</p>
                {e.detail ? <p>{e.detail}</p> : null}
                {e.dates ? <p className="cv-edu-meta">{e.dates}</p> : null}
              </div>
            ))}
          </section>
        ) : null}
      </div>
    </article>
  );
}
