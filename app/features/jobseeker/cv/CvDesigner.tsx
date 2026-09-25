"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { CV_ACCENTS, CV_TEMPLATES, type CvAccent, type CvDocument, type CvTemplate } from "./cvDocument";
import { CV_ACCENT_BTN, CV_LINK_BTN, CV_TEMPLATE_BTN } from "./cvRecipes";
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
// The PDF comes from the server when it has a browser (GET /api/jobseeker/cv.pdf); when it
// answers JOBSEEKER_PDF_UNAVAILABLE the notice offers Print -> Save as PDF instead, which
// carries the same layout. The choice of layout and accent is a per-viewer convenience,
// remembered in localStorage and, on the page, in the URL.

const A4_WIDTH_PX = 793.7; // 210mm at 96dpi
const STORE_KEY = "kp-me-cv-design";

export type CvDesignerSkin = { primary: string; ghost: string };

function readStored(): { template: CvTemplate; accent: CvAccent } | null {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? "null") as { template?: unknown; accent?: unknown } | null;
    if (!raw) return null;
    return {
      template: (CV_TEMPLATES as readonly unknown[]).includes(raw.template) ? (raw.template as CvTemplate) : "sidebar",
      accent: (CV_ACCENTS as readonly unknown[]).includes(raw.accent) ? (raw.accent as CvAccent) : "navy",
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
  initialTemplate,
  initialAccent,
  skin,
}: {
  doc: CvDocument;
  mode: "inline" | "page";
  initialTemplate?: CvTemplate;
  initialAccent?: CvAccent;
  skin: CvDesignerSkin;
}) {
  const t = useTranslations("me.designedCv");
  const errorMessage = useErrorMessage();
  // Inline mounts only after the seeker flips the column to "Designed" (post-hydration),
  // so reading storage in the initialiser cannot mismatch a server render. The page is
  // server-rendered, so it starts from its URL and only WRITES the remembered choice.
  const [template, setTemplate] = useState<CvTemplate>(() => initialTemplate ?? (mode === "inline" ? readStored()?.template : undefined) ?? "sidebar");
  const [accent, setAccent] = useState<CvAccent>(() => initialAccent ?? (mode === "inline" ? readStored()?.accent : undefined) ?? "navy");
  const [pdf, setPdf] = useState<{ state: "idle" | "busy" } | { state: "failed"; message: string }>({ state: "idle" });
  const [showChanges, setShowChanges] = useState(false);

  const query = `template=${template}&accent=${accent}`;

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ template, accent }));
    } catch {
      /* storage refused (private mode): the choice lives for this visit only */
    }
    if (mode === "page") window.history.replaceState(null, "", `${window.location.pathname}?${query}`);
  }, [template, accent, mode, query]);

  // Inline: scale the real A4 sheet to the column. The sheet is laid out at its true
  // width so line breaks match the PDF; only the transform changes.
  const frameRef = useRef<HTMLElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const [fit, setFit] = useState({ scale: 0.5, height: 561 });
  useEffect(() => {
    if (mode !== "inline") return;
    const frame = frameRef.current;
    const sheet = sheetRef.current;
    if (!frame || !sheet || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const scale = Math.min(1, frame.clientWidth / A4_WIDTH_PX);
      setFit({ scale, height: sheet.offsetHeight * scale });
    });
    ro.observe(frame);
    ro.observe(sheet);
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

  const changes = doc.improvements;

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
    </div>
  );

  if (mode === "page") {
    return (
      <>
        <div className="cvdesk cvdesk-chrome">{controls}</div>
        <div className="cvdesk-page">
          <DesignedCv doc={doc} template={template} accent={accent} />
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
          <DesignedCv doc={doc} template={template} accent={accent} />
        </div>
      </figure>
    </div>
  );
}
