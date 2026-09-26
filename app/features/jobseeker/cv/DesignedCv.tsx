import type { ReactNode } from "react";
import { levelPips, type CvBullet, type CvContact, type CvDocument, type CvRole } from "./cvDocument";
import type { CvAccent, CvTemplate } from "./cvQuery";
import { CV_ORG_SEPARATOR, cssString, cvHeadingsOf } from "./cvSheet";
import "./cv.css";

// The designed CV — one markup, four templates (cv.css). Pure and hook-free, so the
// server print page (/me/cv/print, which headless Chromium turns into the PDF) and the
// client preview in the /me flow render the SAME component: what the seeker sees in the
// preview is what the PDF carries.
//
// The headings are the CV's own language (CV_HEADINGS by `doc.lang`), not the reader's UI
// locale — they are part of the document, like its bullets.
//
// READING ORDER IS CONTENT (registry recruiting/cv-presentation-and-parseability,
// parse-safe-reading-order). The DOM order is the order a content-order extractor reads
// back from the PDF, on every template: head (name, headline, contacts) -> summary ->
// experience -> projects -> education -> skills -> languages. Every dated entry opens
// with ONE line - title, employer, dates - so a parser pairs a title with its own
// interval. Nothing with text on the sheet is positioned: Chromium paints positioned
// boxes after the flow and the PDF's text follows paint order (a `position: relative`
// bullet once sent every bullet to the end of the extracted text). cvRoundTrip.ts
// `cvReadingLines` is this order as text; `npm run cv:roundtrip` checks the two agree.

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

/** A bullet's text with its emphasis ranges (a term the tailored target asks for) bolded. */
function Emphasised({ text, ranges }: { text: string; ranges: CvBullet["emphasis"] }) {
  if (!ranges?.length) return <>{text}</>;
  const out: ReactNode[] = [];
  let at = 0;
  ranges.forEach(([s, e], i) => {
    if (s < at || e > text.length) return;
    if (s > at) out.push(text.slice(at, s));
    out.push(
      <strong key={i} className="cv-em">
        {text.slice(s, e)}
      </strong>
    );
    at = e;
  });
  if (at < text.length) out.push(text.slice(at));
  return <>{out}</>;
}

/** An entry's first line: title — employer, and the dates at the end of the SAME line. */
function EntryHead({ title, org, dates }: { title: string; org: string | null; dates: string | null }) {
  return (
    <div className="cv-role-head">
      <h4 className="cv-role-title">
        {title}
        {org ? (
          <span className="cv-org">
            {CV_ORG_SEPARATOR}
            {org}
          </span>
        ) : null}
      </h4>
      {dates ? <span className="cv-dates">{dates}</span> : null}
    </div>
  );
}

/** A dated entry. `compact` (the document's recency compression) or no bullets: the one
 *  line alone, in its place - the history keeps its date order. */
function Role({ r }: { r: CvRole }) {
  const oneLine = r.compact || r.bullets.length === 0;
  return (
    <div className={oneLine ? "cv-role is-short" : "cv-role"}>
      <EntryHead title={r.role} org={r.org} dates={r.dates} />
      {oneLine ? null : (
        <ul className="cv-bullets">
          {r.bullets.map((b, j) => (
            <li key={j}>
              {b.lead ? <b>{b.lead}: </b> : null}
              <Emphasised text={b.text} ranges={b.emphasis} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DesignedCv({ doc, template, accent, id }: { doc: CvDocument; template: CvTemplate; accent: CvAccent; id?: string }) {
  const h = cvHeadingsOf(doc);
  const projects = doc.projects ?? [];
  const titled = doc.skills.some((g) => g.title);

  return (
    <article id={id} className="cvsheet" data-template={template} data-accent={accent} lang={doc.lang}>
      {/* The running head of a continuation page: the name, repeated IN ADDITION to the one
          in the flow (registry type-scale-density-and-page-budget). Its look is cv.css's
          `@page cv`; only the words are the seeker's. The `:first` reset rides in the same
          sheet, after the name, so no stylesheet order can put the name on page one,
          where the margin is zero and it would sit off the paper but in the text layer. */}
      <style>{`@page cv{@top-left{content:${cssString(doc.name)}}}@page cv:first{@top-left{content:none}}`}</style>
      <header className="cv-head">
        <p className="cv-name">{doc.name}</p>
        {doc.headline ? <p className="cv-headline">{doc.headline}</p> : null}
        {doc.objective ? <p className="cv-objective">{doc.objective}</p> : null}
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
            {doc.experience.map((r, i) => (
              <Role key={i} r={r} />
            ))}
          </section>
        ) : null}
        {projects.length ? (
          <section className="cv-sec">
            <h3 className="cv-sec-title">{h.projects}</h3>
            {projects.map((r, i) => (
              <Role key={i} r={r} />
            ))}
          </section>
        ) : null}
        {/* Education is among the first things read: it stays in the flow on every
            template, never in a side column. */}
        {doc.education.length ? (
          <section className="cv-sec">
            <h3 className="cv-sec-title">{h.education}</h3>
            {doc.education.map((e, i) => (
              <div key={i} className="cv-role is-short">
                <EntryHead title={e.title} org={e.detail} dates={e.dates} />
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
                              {it.emphasis ? <strong className="cv-em">{it.name}</strong> : <span>{it.name}</span>}
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
                          <li key={it.name}>{it.emphasis ? <strong className="cv-em">{it.name}</strong> : it.name}</li>
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
      </div>
    </article>
  );
}
