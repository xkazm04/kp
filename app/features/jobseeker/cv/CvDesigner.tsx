"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { CV_ACCENTS, CV_TEMPLATES, type CvAccent, type CvDocument, type CvTemplate } from "./cvDocument";
import { CV_DESIGN_DEFAULT, cvDesignQuery, type CvDesign } from "./cvQuery";
import { CV_ACCENT_BTN, CV_LINK_BTN, CV_OPTION_BTN, CV_TEMPLATE_BTN } from "./cvRecipes";
import { tailorCvDocument, type CvCoverageWhere, type CvTailorTarget } from "./cvTailor";
import { DesignedCv } from "./DesignedCv";

// The designer: pick a layout and an accent, see the CV as a page, take it away as a PDF.
//
// Two homes, one component. INLINE is the /me flow's "Designed" face of the CV column: a
// scaled page that fits the column, the pickers above it, a link to the full page. PAGE is
// /me/cv/print: the sheet at real size and the same pickers in the (print-hidden) header,
// which is also the page headless Chromium prints — so preview, print and PDF are one
// render. The host passes its own button classes (`skin`), so the actions wear the Sieve's
// pills inside the flow and the product's buttons on the page.
//
// TAILORING (cvTailor.ts): with stated target titles, "Tailor for" reorders and
// emphasises the CV toward one of them — never adds a word. The moves are listed, and the
// coverage ("your CV shows 9 of the 14 skills AI Engineer postings ask for", the missing
// ones named) is for the seeker only: it lives here in the chrome, never on the sheet.
// The whole design rides in the URL (cvQuery.ts), so the full page and the PDF render the
// tailored sheet the preview shows.
//
// The PDF comes from the server when it has a browser (GET /api/jobseeker/cv.pdf); when it
// answers JOBSEEKER_PDF_UNAVAILABLE the notice offers Print -> Save as PDF instead, which
// carries the same layout. The choice of layout, accent and target is a per-viewer
// convenience, remembered in localStorage and, on the page, in the URL.

const A4_WIDTH_PX = 793.7; // 210mm at 96dpi
const A4_HEIGHT_PX = 1122.5; // 297mm at 96dpi
const STORE_KEY = "kp-me-cv-design";

export type CvDesignerSkin = { primary: string; ghost: string };

function readStored(): { template: CvTemplate; accent: CvAccent; tailor: number | null } | null {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? "null") as { template?: unknown; accent?: unknown; tailor?: unknown } | null;
    if (!raw) return null;
    return {
      template: (CV_TEMPLATES as readonly unknown[]).includes(raw.template) ? (raw.template as CvTemplate) : "sidebar",
      accent: (CV_ACCENTS as readonly unknown[]).includes(raw.accent) ? (raw.accent as CvAccent) : "navy",
      tailor: typeof raw.tailor === "number" && Number.isInteger(raw.tailor) && raw.tailor >= 0 ? raw.tailor : null,
    };
  } catch {
    return null;
  }
}

function Thumb({ template }: { template: CvTemplate }) {
  // A schematic of each layout — a picture of the page, not a word for it.
  return (
    <svg viewBox="0 0 42 56" aria-hidden className="cvdesk-thumb">
      <rect x="0.5" y="0.5" width="41" height="55" rx="2" className="pg" />
      {template === "sidebar" ? (
        <>
          <rect x="1" y="1" width="14" height="54" className="tint" />
          <rect x="1" y="1" width="40" height="2" className="ac" />
          <rect x="18" y="7" width="18" height="3" className="ac" />
          <rect x="18" y="14" width="20" height="1.6" className="ln" />
          <rect x="18" y="18" width="17" height="1.6" className="ln" />
          <rect x="18" y="24" width="20" height="1.6" className="ln" />
          <rect x="18" y="28" width="15" height="1.6" className="ln" />
          <rect x="4" y="8" width="8" height="1.6" className="ac" />
          <rect x="4" y="12" width="9" height="1.4" className="ln" />
          <rect x="4" y="15" width="7" height="1.4" className="ln" />
        </>
      ) : template === "editorial" ? (
        <>
          <rect x="5" y="6" width="24" height="4" className="ink" />
          <rect x="5" y="13" width="32" height="1" className="ac" />
          <rect x="5" y="18" width="6" height="1.4" className="ln" />
          <rect x="14" y="18" width="23" height="1.6" className="ln" />
          <rect x="14" y="22" width="20" height="1.6" className="ln" />
          <rect x="5" y="28" width="6" height="1.4" className="ln" />
          <rect x="14" y="28" width="23" height="1.6" className="ln" />
          <rect x="14" y="32" width="18" height="1.6" className="ln" />
        </>
      ) : (
        <>
          <rect x="1" y="1" width="40" height="11" className="acf" />
          <rect x="4" y="5" width="16" height="3" className="pgf" />
          <rect x="4" y="16" width="22" height="1.6" className="ln" />
          <rect x="4" y="20" width="20" height="1.6" className="ln" />
          <rect x="4" y="24" width="22" height="1.6" className="ln" />
          <rect x="29" y="16" width="0.6" height="30" className="ln" />
          <rect x="31" y="16" width="7" height="1.4" className="ac" />
          <rect x="31" y="20" width="8" height="1.4" className="ln" />
        </>
      )}
    </svg>
  );
}

export function CvDesigner({
  doc,
  mode,
  initial,
  targets = [],
  skin,
}: {
  doc: CvDocument;
  mode: "inline" | "page";
  /** The page's design from its URL (cvQuery.ts `parseCvDesign`); inline starts from storage. */
  initial?: Partial<CvDesign>;
  /** The seeker's target titles with their demand (cvTailor.ts `tailorTargetsOf`); none = no "Tailor for". */
  targets?: CvTailorTarget[];
  skin: CvDesignerSkin;
}) {
  const t = useTranslations("me.designedCv");
  const errorMessage = useErrorMessage();
  // Inline mounts only after the seeker flips the column to "Designed" (post-hydration),
  // so reading storage in the initialiser cannot mismatch a server render. The page is
  // server-rendered, so it starts from its URL and only WRITES the remembered choice.
  const stored = useMemo(() => (mode === "inline" && !initial ? readStored() : null), [mode, initial]);
  const [template, setTemplate] = useState<CvTemplate>(() => initial?.template ?? stored?.template ?? CV_DESIGN_DEFAULT.template);
  const [accent, setAccent] = useState<CvAccent>(() => initial?.accent ?? stored?.accent ?? CV_DESIGN_DEFAULT.accent);
  const [tailorPick, setTailor] = useState<number | null>(() => (initial ? (initial.tailor ?? null) : (stored?.tailor ?? null)));
  const [compact, setCompact] = useState<boolean>(() => initial?.compact ?? false);
  const [objective, setObjective] = useState<boolean>(() => initial?.objective ?? true);
  const [pdf, setPdf] = useState<{ state: "idle" | "busy" } | { state: "failed"; message: string }>({ state: "idle" });
  const [showChanges, setShowChanges] = useState(false);
  const [showMoves, setShowMoves] = useState(false);
  const [showWhere, setShowWhere] = useState(false);

  // A remembered index the seeker's targets no longer reach reads as "not tailored".
  const tailor = tailorPick !== null && tailorPick < targets.length ? tailorPick : null;
  const target = tailor !== null ? targets[tailor]! : null;
  const tailored = useMemo(
    () => (target ? tailorCvDocument(doc, { target: target.title, demand: target.demand, options: { compactOffTarget: compact, objective } }) : null),
    [doc, target, compact, objective]
  );
  const sheetDoc = tailored?.doc ?? doc;

  const query = cvDesignQuery({ template, accent, tailor, compact, objective });

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ template, accent, tailor }));
    } catch {
      /* storage refused (private mode): the choice lives for this visit only */
    }
    if (mode === "page") window.history.replaceState(null, "", `${window.location.pathname}?${query}`);
  }, [template, accent, tailor, mode, query]);

  // The sheet is laid out at its true A4 width so line breaks match the PDF. Inline, only
  // a transform scales it to the column. Both modes measure whether it runs over one page:
  // that is when "one line for off-target roles" is worth offering.
  const frameRef = useRef<HTMLElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const [fit, setFit] = useState({ scale: 0.5, height: 561 });
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const box = sheetRef.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const sheet = box.firstElementChild as HTMLElement | null;
      setOverflows((sheet?.offsetHeight ?? 0) > A4_HEIGHT_PX + 2);
      const frame = frameRef.current;
      if (mode === "inline" && frame) {
        const scale = Math.min(1, frame.clientWidth / A4_WIDTH_PX);
        setFit({ scale, height: box.offsetHeight * scale });
      }
    });
    ro.observe(box);
    if (frameRef.current) ro.observe(frameRef.current);
    return () => ro.disconnect();
  }, [mode]);

  const downloadPdf = useCallback(async () => {
    setPdf({ state: "busy" });
    try {
      const res = await fetch(`/api/jobseeker/cv.pdf?${query}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { code?: string; error?: string } | null;
        setPdf({ state: "failed", message: errorMessage(body, t("pdfFailed")) });
        return;
      }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "cv.pdf";
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 10_000);
      setPdf({ state: "idle" });
    } catch {
      setPdf({ state: "failed", message: t("pdfFailed") });
    }
  }, [query, errorMessage, t]);

  // The wordings tidied are the document's own; the tailoring moves are listed apart.
  const changes = doc.improvements.filter((c) => c.kind !== "tailor");
  const moves = tailored?.moves ?? [];
  const coverage = tailored?.coverage ?? null;
  const whereLabel = (w: CvCoverageWhere) => (w.kind === "skills" ? t("coverage.inSkills") : w.kind === "summary" ? t("coverage.inSummary") : w.role);
  const offerCompact = !!tailored && tailored.offTargetRoles > 0 && (overflows || compact);

  const tailoring = targets.length ? (
    <div className="cvdesk-tailor">
      <div className="cvdesk-pick" role="group" aria-label={t("tailorLabel")}>
        <span className="cvdesk-label" aria-hidden>
          {t("tailorLabel")}
        </span>
        <button type="button" className={CV_OPTION_BTN} aria-pressed={tailor === null} onClick={() => setTailor(null)}>
          {t("tailorOff")}
        </button>
        {targets.map((tg, i) => (
          <button key={`${i}:${tg.title}`} type="button" className={CV_OPTION_BTN} aria-pressed={tailor === i} onClick={() => setTailor(i)}>
            {tg.title}
          </button>
        ))}
      </div>
      {target ? (
        <div className="cvdesk-pick">
          <button type="button" className={CV_OPTION_BTN} aria-pressed={objective} onClick={() => setObjective((v) => !v)}>
            {t("objectiveToggle")}
          </button>
          {offerCompact ? (
            <button type="button" className={CV_OPTION_BTN} aria-pressed={compact} onClick={() => setCompact((v) => !v)}>
              {t("compactToggle")}
            </button>
          ) : null}
          {offerCompact && overflows ? <span className="cvdesk-label">{t("compactHint")}</span> : null}
        </div>
      ) : null}
      {target && coverage ? (
        <div className="cvdesk-cover" role="status">
          {coverage.source === "none" ? (
            <p>{t("coverage.none", { target: target.title })}</p>
          ) : (
            <>
              <p>
                <b>
                  {coverage.source === "postings"
                    ? t("coverage.postings", { shown: coverage.shown.length, total: coverage.shown.length + coverage.missing.length, target: target.title })
                    : t("coverage.lexicon", { shown: coverage.shown.length, total: coverage.shown.length + coverage.missing.length, target: target.title })}
                </b>{" "}
                {coverage.source === "postings" ? t("coverage.from", { n: coverage.postings, target: target.title }) : t("coverage.lexiconNote", { target: target.title })}
              </p>
              {coverage.missing.length ? (
                <>
                  <p className="cvdesk-sub">{t("coverage.missingTitle")}</p>
                  <ul className="cvdesk-chips">
                    {coverage.missing.map((m) => (
                      <li key={m.skill}>{m.skill}</li>
                    ))}
                  </ul>
                  <p>{t("coverage.missingHint")}</p>
                </>
              ) : (
                <p>{t("coverage.allShown")}</p>
              )}
              {coverage.shown.length ? (
                <>
                  <button type="button" className={CV_LINK_BTN} aria-expanded={showWhere} onClick={() => setShowWhere((v) => !v)}>
                    {t("coverage.shownToggle")}
                  </button>
                  {showWhere ? (
                    <ul className="cvdesk-where">
                      {coverage.shown.map((s) => (
                        <li key={s.skill}>
                          <b>{s.skill}</b>
                          <span>{s.where.map(whereLabel).join(" · ")}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  ) : null;

  const controls = (
    <div className="cvdesk-bar">
      <div className="cvdesk-pick" role="group" aria-label={t("templateLabel")}>
        {CV_TEMPLATES.map((k) => (
          <button key={k} type="button" className={CV_TEMPLATE_BTN} aria-pressed={template === k} onClick={() => setTemplate(k)}>
            <Thumb template={k} />
            <span>{t(`template.${k}`)}</span>
          </button>
        ))}
      </div>
      <div className="cvdesk-pick" role="group" aria-label={t("accentLabel")}>
        {CV_ACCENTS.map((k) => (
          <button key={k} type="button" className={CV_ACCENT_BTN} data-accent={k} aria-pressed={accent === k} aria-label={t(`accent.${k}`)} onClick={() => setAccent(k)} />
        ))}
      </div>
      <div className="cvdesk-actions">
        <button type="button" className={skin.primary} onClick={downloadPdf} disabled={pdf.state === "busy"} aria-busy={pdf.state === "busy"}>
          {pdf.state === "busy" ? t("preparing") : t("downloadPdf")}
        </button>
        {mode === "inline" ? (
          <a className={skin.ghost} href={`/me/cv/print?${query}`}>
            {t("openPage")}
          </a>
        ) : (
          <button type="button" className={skin.ghost} onClick={() => window.print()}>
            {t("print")}
          </button>
        )}
      </div>
      {pdf.state === "failed" ? (
        <p className="cvdesk-note" role="alert">
          {pdf.message}{" "}
          {mode === "inline" ? (
            <a href={`/me/cv/print?${query}`}>{t("printInstead")}</a>
          ) : (
            <button type="button" className={CV_LINK_BTN} onClick={() => window.print()}>
              {t("printInstead")}
            </button>
          )}
        </p>
      ) : null}
      {tailoring}
      <div className="cvdesk-changes">
        <button type="button" className={CV_LINK_BTN} aria-expanded={showChanges} onClick={() => setShowChanges((v) => !v)} disabled={changes.length === 0}>
          {t("improvements", { n: changes.length })}
        </button>
        {showChanges && changes.length ? (
          <div className="cvdesk-list">
            <p>{t("improvementsHint")}</p>
            <ul>
              {changes.map((c, i) => (
                <li key={i}>
                  <span className="k">{t(`kind.${c.kind}`)}</span>
                  <s>{c.before}</s>
                  <span aria-hidden>→</span>
                  <b>{c.after}</b>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      {target ? (
        <div className="cvdesk-changes">
          <button type="button" className={CV_LINK_BTN} aria-expanded={showMoves} onClick={() => setShowMoves((v) => !v)} disabled={moves.length === 0}>
            {t("tailorMoves", { n: moves.length, target: target.title })}
          </button>
          {showMoves && moves.length ? (
            <div className="cvdesk-list">
              <p>{t("tailorMovesHint")}</p>
              <ul>
                {moves.map((m, i) => (
                  <li key={i}>
                    <span className="k">{t("kind.tailor")}</span>
                    <span>{t(`tailorMove.${m.move}`, { before: m.before, after: m.after, where: m.where ?? "", n: m.n, target: target.title })}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  if (mode === "page") {
    return (
      <>
        <div className="cvdesk cvdesk-chrome">{controls}</div>
        <div ref={sheetRef} className="cvdesk-page">
          <DesignedCv doc={sheetDoc} template={template} accent={accent} />
        </div>
      </>
    );
  }

  return (
    <div className="cvdesk">
      {controls}
      {/* A picture of the page: inert, so its links take no focus and a screen reader
          meets the CV once, in the "As dropped" column or on the full page. */}
      <figure ref={frameRef} className="cvdesk-frame" style={{ height: fit.height }} aria-label={t("previewLabel")}>
        <div ref={sheetRef} className="cvdesk-scale" style={{ transform: `scale(${fit.scale})` }} inert>
          <DesignedCv doc={sheetDoc} template={template} accent={accent} />
        </div>
      </figure>
    </div>
  );
}
