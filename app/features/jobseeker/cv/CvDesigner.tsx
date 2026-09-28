"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { createKeyedSaver, putJson, type SaveState } from "../serverDraft";
import { bulletLine, type CvDocument, type CvOwnerQuestion } from "./cvDocument";
import { CV_ACCENTS, CV_DESIGN_DEFAULT, CV_DESIGN_VERSION, CV_SINGLE_FLOW, CV_TEMPLATES, cvDesignQuery, migrateSavedCvDesign, parseSavedCvDesign, type CvAccent, type CvDesign, type CvTemplate } from "./cvQuery";
import { CV_ACCENT_BTN, CV_LINK_BTN, CV_OPTION_BTN, CV_TEMPLATE_BTN } from "./cvRecipes";
import { tailorCvDocument, type CvCoverageWhere, type CvTailorTarget } from "./cvTailor";
import { cvPageVerdict, cvYearsOf, measureSheetLengthMm } from "./cvPageBudget";
import { cvReadingLines } from "./cvRoundTrip";
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
// carries the same layout. The choice of layout, accent and target is kept for the
// seeker on the server (so it follows them to another browser), painted first from
// localStorage, and on the page carried in the URL.

const A4_WIDTH_PX = 793.7; // 210mm at 96dpi
/** What the printed sheet adds below its last section: nothing - in print the page's own
 *  10mm margin is the foot (cv.css drops the preview's bottom padding there). */
const SHEET_FOOT_MM = 0;
const STORE_KEY = "kp-me-cv-design";

export type CvDesignerSkin = { primary: string; ghost: string };

/** The owner questions, grouped in this order: the evidence a line lacks first, then a
 *  skill nothing shows, then the seeker's own self-descriptions. */
const QUESTION_KINDS: readonly CvOwnerQuestion["kind"][] = ["no_outcome", "missing_metric", "listed_only", "self_descriptor"];

/** This browser's remembered design, through the one validator, and MIGRATED: a copy
 *  saved under an earlier marker reads the default of its day (an old `sidebar` or
 *  `classic`, an old `navy`) as never chosen (cvQuery.ts migrateSavedCvDesign); the store
 *  effect below writes it back with the current marker on mount. */
function readStored(): CvDesign | null {
  try {
    const saved = parseSavedCvDesign(JSON.parse(localStorage.getItem(STORE_KEY) ?? "null"));
    return saved ? migrateSavedCvDesign(saved) : null;
  } catch {
    return null;
  }
}

/** One key per design, in a fixed field order, so "has it changed" is a string compare. */
function designKeyOf(d: CvDesign): string {
  return JSON.stringify([d.template, d.accent, d.tailor, d.compact, d.objective]);
}

/** The seeker's saved choice (GET /api/jobseeker/ui-state), validated server-side and
 *  again here, NOT yet migrated (the caller saves a migration back); null when none is
 *  kept, there is no profile, or the read failed. */
async function fetchSavedDesign(): Promise<CvDesign | null> {
  try {
    const res = await fetch("/api/jobseeker/ui-state");
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as { design?: unknown } | null;
    return parseSavedCvDesign(body?.design);
  } catch {
    /* offline: the remembered-in-this-browser choice stands */
    return null;
  }
}

// ── the layout picker's schematics ─────────────────────────────────────────────────
//
// A picture of each page, not a word for it: the page drawn as bars at A4's proportion,
// in the accent the seeker has picked (the picker carries it as `data-accent`, cv.css
// resolves the ink). Paper drawings, so they use the paper tokens, like the sheet.

/** The inks of a schematic (cv.css `.cvdesk-thumb .<ink>`): the sheet's text, its light
 *  lines, a muted grey, the accent full / soft / mid, and paper on an accent band. */
type ThumbInk = "ink" | "ln" | "mid" | "ac" | "acs" | "acm" | "pgf";
/** A bar: ink, x, y, width, height, corner radius (viewBox 60 x 84). */
type ThumbBar = readonly [ThumbInk, number, number, number, number, number?];
type ThumbSpec = { bars: readonly ThumbBar[]; dots?: readonly (readonly [number, number])[]; glow?: boolean };

/** A run of bullet lines from `y`, 2.6 apart, each after its marker (or none). */
function bulletRows(x: number, y: number, widths: readonly number[], marker: "square" | "dash" | "disc" | "none"): ThumbBar[] {
  return widths.flatMap((w, i): ThumbBar[] => {
    const row = y + i * 2.6;
    const line: ThumbBar = ["ln", x + 2.6, row, w, 1.1];
    if (marker === "none") return [line];
    if (marker === "dash") return [["ac", x, row + 0.35, 1.3, 0.45], line];
    return [["ac", x + 0.4, row + 0.1, 0.9, 0.9, marker === "disc" ? 0.45 : 0], line];
  });
}

const THUMBS: Record<CvTemplate, ThumbSpec> = {
  studio: {
    glow: true,
    bars: [
      ["ac", 6, 6.5, 7, 1.6, 0.8],
      ["ink", 6, 10.4, 27, 4.4, 0.6],
      ["ac", 6, 17, 19, 1.8, 0.3],
      ["ln", 6, 21.2, 10, 1.1],
      ["ln", 18, 21.2, 14, 1.1],
      ["ln", 34, 21.2, 11, 1.1],
      ["mid", 6, 25, 48, 0.35],
      ["ac", 6, 28.2, 1.8, 1.8, 0.4],
      ["ink", 9.4, 28.2, 12, 1.8, 0.3],
      ["ink", 6, 32.4, 21, 1.5],
      ["mid", 46, 32.4, 8, 1.5],
      ...bulletRows(6, 35.3, [42, 37, 40], "square"),
      ["ink", 6, 44.6, 18, 1.5],
      ["mid", 46, 44.6, 8, 1.5],
      ...bulletRows(6, 47.5, [39, 33], "square"),
      ["ac", 6, 55, 1.8, 1.8, 0.4],
      ["ink", 9.4, 55, 11, 1.8, 0.3],
      ["ink", 6, 59.2, 24, 1.5],
      ["mid", 46, 59.2, 8, 1.5],
      ["ac", 6, 64, 1.8, 1.8, 0.4],
      ["ink", 9.4, 64, 8, 1.8, 0.3],
      ["ink", 6, 68.2, 7, 1.1],
      ["ln", 14, 68.2, 34, 1.1],
      ["ink", 6, 71, 9, 1.1],
      ["ln", 16, 71, 24, 1.1],
    ],
  },
  signal: {
    dots: [
      [7.3, 29.95],
      [7.3, 41.45],
      [7.3, 50.95],
    ],
    bars: [
      ["ink", 6, 7, 25, 4.2, 0.3],
      ["mid", 6, 13.2, 21, 1.6],
      ["ln", 6, 17, 38, 1.1],
      ["ink", 6, 20.8, 48, 0.6],
      ["ac", 6, 24.5, 1.4, 1.4],
      ["ink", 9, 24.4, 11, 1.6],
      ["acm", 7.05, 29.95, 0.5, 21],
      ["ink", 10.5, 29.2, 20, 1.5],
      ["mid", 46, 29.2, 8, 1.5],
      ...bulletRows(9.9, 32.3, [38, 34, 36], "none"),
      ["ink", 10.5, 40.7, 17, 1.5],
      ["mid", 46, 40.7, 8, 1.5],
      ...bulletRows(9.9, 43.8, [37, 30], "none"),
      ["ink", 10.5, 50.2, 19, 1.5],
      ["mid", 46, 50.2, 8, 1.5],
      ["ac", 6, 56.5, 1.4, 1.4],
      ["ink", 9, 56.4, 9, 1.6],
      ["ac", 6, 61, 8, 1.1],
      ["ln", 18, 61, 32, 1.1],
      ["ac", 6, 63.8, 11, 1.1],
      ["ln", 18, 63.8, 26, 1.1],
      ["ac", 6, 66.6, 6, 1.1],
      ["ln", 18, 66.6, 22, 1.1],
      ["ac", 6, 71, 1.4, 1.4],
      ["ink", 9, 70.9, 10, 1.6],
      ["ln", 6, 74.8, 30, 1.1],
    ],
  },
  folio: {
    bars: [
      ["ink", 6, 6, 48, 1.1],
      ["ink", 6, 9.6, 29, 4.4, 0.2],
      ["ac", 6, 16, 20, 1.7],
      ["ln", 6, 19.8, 9, 1.1],
      ["ln", 17, 19.8, 13, 1.1],
      ["ln", 32, 19.8, 10, 1.1],
      ["ink", 6, 23.4, 48, 0.35],
      ["ac", 6, 26.6, 10, 1.8],
      ["mid", 6, 30.3, 48, 1.5],
      ["mid", 6, 32.9, 41, 1.5],
      ["ac", 6, 37.4, 14, 1.8],
      ["ink", 6, 41.2, 22, 1.5],
      ["mid", 46, 41.2, 8, 1.5],
      ...bulletRows(6, 44.2, [42, 36, 39], "dash"),
      ["ink", 6, 52.8, 18, 1.5],
      ["mid", 46, 52.8, 8, 1.5],
      ...bulletRows(6, 55.8, [38], "dash"),
      ["ac", 6, 60.6, 11, 1.8],
      ["ink", 6, 64.4, 24, 1.5],
      ["mid", 46, 64.4, 8, 1.5],
      ["ac", 6, 69.2, 9, 1.8],
      ["ink", 6, 72.8, 7, 1.1],
      ["ln", 14, 72.8, 32, 1.1],
    ],
  },
  classic: {
    bars: [
      ["ac", 6, 7, 26, 4, 0.2],
      ["ink", 6, 13, 18, 1.5],
      ["ln", 6, 16.6, 12, 1.1],
      ["ln", 20, 16.6, 16, 1.1],
      ["ac", 6, 20.4, 48, 0.5],
      ["ac", 6, 24.2, 11, 1.7],
      ["acm", 19, 24.85, 35, 0.4],
      ["ink", 6, 28.4, 22, 1.5],
      ["mid", 46, 28.4, 8, 1.5],
      ...bulletRows(6, 31.4, [42, 36, 39], "disc"),
      ["ink", 6, 40.6, 19, 1.5],
      ["mid", 46, 40.6, 8, 1.5],
      ...bulletRows(6, 43.6, [38], "disc"),
      ["ac", 6, 48.6, 9, 1.7],
      ["acm", 17, 49.25, 37, 0.4],
      ["ink", 6, 52.8, 24, 1.5],
      ["mid", 46, 52.8, 8, 1.5],
      ["ac", 6, 57.6, 8, 1.7],
      ["acm", 16, 58.25, 38, 0.4],
      ["ink", 6, 61.6, 7, 1.1],
      ["ln", 14, 61.6, 34, 1.1],
      ["ink", 6, 64.4, 9, 1.1],
      ["ln", 16, 64.4, 24, 1.1],
    ],
  },
  editorial: {
    bars: [
      ["ink", 6, 7, 31, 5, 0.2],
      ["ac", 6, 14.6, 21, 1.7],
      ["ln", 6, 18.4, 12, 1.1],
      ["ln", 20, 18.4, 16, 1.1],
      ["ac", 6, 22, 48, 1],
      ["ac", 6, 26.4, 12, 1.9],
      ["mid", 6, 30.4, 48, 1.4],
      ["mid", 6, 32.9, 40, 1.4],
      ["ac", 6, 37.4, 14, 1.9],
      ["ink", 6, 41.4, 22, 1.5],
      ["mid", 46, 41.4, 8, 1.5],
      ...bulletRows(6, 44.4, [42, 36], "disc"),
      ["ink", 6, 51, 19, 1.5],
      ["mid", 46, 51, 8, 1.5],
      ...bulletRows(6, 54, [38], "disc"),
      ["ac", 6, 58.8, 11, 1.9],
      ["ink", 6, 62.8, 24, 1.5],
      ["mid", 46, 62.8, 8, 1.5],
    ],
  },
  sidebar: {
    bars: [
      ["acs", 0.5, 0.5, 19.5, 83],
      ["ac", 0.5, 0.5, 59, 2],
      ["ac", 24, 7.5, 24, 4, 0.2],
      ["ink", 24, 13.6, 16, 1.4],
      ["ln", 24, 16.8, 28, 1.1],
      ["ac", 24, 21.4, 12, 1.6],
      ["ink", 24, 25, 20, 1.4],
      ...bulletRows(21.4, 27.9, [30, 26, 29], "none"),
      ["ink", 24, 36.6, 18, 1.4],
      ...bulletRows(21.4, 39.5, [28, 24], "none"),
      ["ac", 24, 46.4, 11, 1.6],
      ["ink", 24, 50, 22, 1.4],
      ["ac", 4, 8, 11, 1.6],
      ...bulletRows(1.4, 11.6, [13, 10, 12], "none"),
      ["ac", 4, 22, 10, 1.6],
      ...bulletRows(1.4, 25.6, [12, 9], "none"),
    ],
  },
  compact: {
    bars: [
      ["ac", 0.5, 0.5, 59, 15],
      ["pgf", 5, 5, 22, 3.6, 0.2],
      ["pgf", 5, 10.2, 14, 1.3],
      ["pgf", 42, 5, 13, 1.1],
      ["pgf", 45, 7.4, 10, 1.1],
      ["pgf", 43, 9.8, 12, 1.1],
      ["ac", 5, 19.5, 11, 1.6],
      ["ink", 5, 23, 22, 1.4],
      ...bulletRows(2.4, 25.9, [30, 27, 29], "none"),
      ["ink", 5, 34.6, 19, 1.4],
      ...bulletRows(2.4, 37.5, [28, 24], "none"),
      ["mid", 39.8, 19, 0.4, 50],
      ["ac", 42.5, 19.5, 10, 1.6],
      ...bulletRows(39.9, 23, [12, 10, 12], "none"),
      ["ac", 42.5, 32, 9, 1.6],
      ...bulletRows(39.9, 35.5, [11], "none"),
    ],
  },
};

function Thumb({ template }: { template: CvTemplate }) {
  const spec = THUMBS[template];
  return (
    <svg viewBox="0 0 60 84" aria-hidden className="cvdesk-thumb">
      <rect x="0.5" y="0.5" width="59" height="83" rx="2" className="pg" />
      {/* studio's corner light: two nested quarter ellipses in the page's corner, a soft
          falloff without a gradient definition (no id to collide between two pickers) */}
      {spec.glow ? (
        <>
          <path d="M33 0.5A26.5 18 0 0 0 59.5 18.5V2.5Q59.5 0.5 57.5 0.5Z" className="acs" />
          <path d="M44 0.5A15.5 10.5 0 0 0 59.5 11V2.5Q59.5 0.5 57.5 0.5Z" className="acs" />
        </>
      ) : null}
      {spec.bars.map(([ink, x, y, w, h, r], i) => (
        <rect key={i} x={x} y={y} width={w} height={h} rx={r || undefined} className={ink} />
      ))}
      {(spec.dots ?? []).map(([cx, cy], i) => (
        <g key={`d${i}`}>
          <circle cx={cx} cy={cy} r={1.8} className="pgf" />
          <circle cx={cx} cy={cy} r={1.25} className="ac" />
        </g>
      ))}
    </svg>
  );
}

/** The picker's two groups: every one-column layout, then the columned ones - the group's
 *  label says in words what the columned ones are (CV_SINGLE_FLOW, from the round trip). */
const LAYOUT_GROUPS = [
  { kind: "single", templates: CV_TEMPLATES.filter((k) => CV_SINGLE_FLOW[k]) },
  { kind: "columned", templates: CV_TEMPLATES.filter((k) => !CV_SINGLE_FLOW[k]) },
] as const;

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
  const uid = useId();
  // Inline mounts only after the seeker flips the column to "Designed" (post-hydration),
  // so reading storage in the initialiser cannot mismatch a server render. The page is
  // server-rendered, so it starts from its URL and only WRITES the remembered choice.
  const stored = useMemo(() => (mode === "inline" && !initial ? readStored() : null), [mode, initial]);
  const [template, setTemplate] = useState<CvTemplate>(() => initial?.template ?? stored?.template ?? CV_DESIGN_DEFAULT.template);
  const [accent, setAccent] = useState<CvAccent>(() => initial?.accent ?? stored?.accent ?? CV_DESIGN_DEFAULT.accent);
  const [tailorPick, setTailor] = useState<number | null>(() => (initial ? (initial.tailor ?? null) : (stored?.tailor ?? null)));
  const [compact, setCompact] = useState<boolean>(() => initial?.compact ?? stored?.compact ?? false);
  const [objective, setObjective] = useState<boolean>(() => initial?.objective ?? stored?.objective ?? true);
  const [pdf, setPdf] = useState<{ state: "idle" | "busy" } | { state: "failed"; message: string }>({ state: "idle" });
  const [showChanges, setShowChanges] = useState(false);
  const [showQuestions, setShowQuestions] = useState(false);
  const [showPlain, setShowPlain] = useState(false);
  const [showHeld, setShowHeld] = useState(false);
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
  // A columned layout is the owner's choice; the single-flow copy rides beside it for any
  // upload (registry parse-safe-reading-order: "ship the plain version beside it").
  const columned = !CV_SINGLE_FLOW[template];

  // The choice FOLLOWS THE SEEKER (PUT /api/jobseeker/ui-state): every change is saved
  // debounced and retried (serverDraft.ts); this browser's localStorage is only the
  // instant first paint, and inline the server's saved choice replaces it when it
  // arrives — unless the seeker already picked something in the meantime, which then
  // stands and is the one saved. The page keeps its URL as the truth (cvQuery.ts: the
  // print page and the PDF route read their query), so it saves changes but never reads.
  const design: CvDesign = { template, accent, tailor: tailorPick, compact, objective };
  const designKey = designKeyOf(design);
  const firstKey = useRef(designKey);
  const latestKey = useRef(designKey);
  const syncedKey = useRef(designKey);
  const [saveState, setSaveState] = useState<SaveState | null>(null);
  const [saver] = useState(() => createKeyedSaver<CvDesign>((_key, d) => putJson("/api/jobseeker/ui-state", { design: d }), (_key, s) => setSaveState(s)));
  useEffect(() => () => saver.dispose(), [saver]);
  useEffect(() => {
    if (mode !== "inline" || initial) return;
    let live = true;
    void fetchSavedDesign().then((saved) => {
      if (!live || !saved || latestKey.current !== firstKey.current) return;
      // A copy from before the current marker is migrated ONCE: the migrated design is
      // saved back with the marker, so the next read passes it through untouched.
      const design = migrateSavedCvDesign(saved);
      if (design !== saved) saver.push("design", design);
      syncedKey.current = designKeyOf(design);
      setTemplate(design.template);
      setAccent(design.accent);
      setTailor(design.tailor);
      setCompact(design.compact);
      setObjective(design.objective);
    });
    return () => {
      live = false;
    };
  }, [mode, initial, saver]);

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ template, accent, tailor: tailorPick, compact, objective, v: CV_DESIGN_VERSION }));
    } catch {
      /* storage refused (private mode): the server copy still carries the choice */
    }
    if (mode === "page") window.history.replaceState(null, "", `${window.location.pathname}?${query}`);
    latestKey.current = designKey;
    if (designKey !== syncedKey.current) {
      syncedKey.current = designKey;
      saver.push("design", { template, accent, tailor: tailorPick, compact, objective, v: CV_DESIGN_VERSION });
    }
  }, [template, accent, tailorPick, compact, objective, mode, query, designKey, saver]);

  // The sheet is laid out at its true A4 width so line breaks match the PDF. Inline, only
  // a transform scales it to the column. Both modes measure the sheet's printed length
  // against the page budget (cvPageBudget.ts): over budget, or a last page holding a few
  // lines, is when "one line" for a role is worth offering - the type never shrinks.
  const frameRef = useRef<HTMLElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const [fit, setFit] = useState({ scale: 0.5, height: 561 });
  const [lengthMm, setLengthMm] = useState<number | null>(null);
  useEffect(() => {
    const box = sheetRef.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const sheet = box.firstElementChild as HTMLElement | null;
      // Measured in the sheet's own millimetres, so the inline preview's scale cancels out.
      if (sheet) setLengthMm(measureSheetLengthMm(sheet, SHEET_FOOT_MM) || null);
      const frame = frameRef.current;
      if (mode === "inline" && frame) {
        const scale = Math.min(1, frame.clientWidth / A4_WIDTH_PX);
        setFit({ scale, height: box.offsetHeight * scale });
      }
    });
    ro.observe(box);
    if (frameRef.current) ro.observe(frameRef.current);
    return () => ro.disconnect();
    // A new layout or document can keep the box's size (the A4 minimum height) while its
    // length changes: re-observe, and the observer's first call measures again.
  }, [mode, template, sheetDoc]);

  const downloadPdf = useCallback(async (as?: CvTemplate) => {
    setPdf({ state: "busy" });
    try {
      const res = await fetch(`/api/jobseeker/cv.pdf?${as ? cvDesignQuery({ template: as, accent, tailor, compact, objective }) : query}`);
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
  }, [query, accent, tailor, compact, objective, errorMessage, t]);

  // The wordings tidied are the document's own; the tailoring moves are listed apart.
  const changes = doc.improvements.filter((c) => c.kind !== "tailor");
  // The owner questions of the sheet being shown (a tailored sheet recomputes its own):
  // what the rules could not decide without the seeker. Designer-only - never printed.
  const questions = sheetDoc.questions;
  const questionGroups = QUESTION_KINDS.map((kind) => ({ kind, items: questions.filter((q) => q.kind === kind) })).filter((g) => g.items.length);
  // The lines the recency budget held back (cvContent.ts): still the seeker's, never
  // deleted - listed per role so a cut is visible and a line worth keeping can be asked for.
  const held = sheetDoc.experience.map((r) => ({ role: r.role, lines: (r.trimmed ?? []).map(bulletLine) })).filter((r) => r.lines.length);
  const heldCount = held.reduce((n, r) => n + r.lines.length, 0);
  const moves = tailored?.moves ?? [];
  const coverage = tailored?.coverage ?? null;
  const whereLabel = (w: CvCoverageWhere) => (w.kind === "skills" ? t("coverage.inSkills") : w.kind === "summary" ? t("coverage.inSummary") : w.role);
  const years = useMemo(() => cvYearsOf(sheetDoc), [sheetDoc]);
  const pages = lengthMm !== null ? cvPageVerdict(lengthMm, years) : null;
  const overBudget = !!pages && (pages.over || pages.sparse);
  const offerCompact = !!tailored && tailored.offTargetRoles > 0 && (overBudget || compact);

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
                  {coverage.source === "research"
                    ? t("coverage.research", { shown: coverage.shown.length, total: coverage.shown.length + coverage.missing.length, target: target.title })
                    : coverage.source === "postings"
                      ? t("coverage.postings", { shown: coverage.shown.length, total: coverage.shown.length + coverage.missing.length, target: target.title })
                      : t("coverage.lexicon", { shown: coverage.shown.length, total: coverage.shown.length + coverage.missing.length, target: target.title })}
                </b>{" "}
                {coverage.source === "research"
                  ? t("coverage.researchNote", { date: coverage.asOf ?? "" })
                  : coverage.source === "postings"
                    ? t("coverage.from", { n: coverage.postings, target: target.title })
                    : t("coverage.lexiconNote", { target: target.title })}
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
      <div className="cvdesk-layouts" role="group" aria-label={t("templateLabel")} data-accent={accent}>
        {LAYOUT_GROUPS.map((g) => (
          <div key={g.kind} className="cvdesk-lgroup" role="group" aria-labelledby={`${uid}-${g.kind}`}>
            <p id={`${uid}-${g.kind}`} className="cvdesk-lgroup-label">
              {t(`templateGroup.${g.kind}`)}
            </p>
            <div className="cvdesk-tpls">
              {g.templates.map((k) => (
                <button key={k} type="button" className={CV_TEMPLATE_BTN} aria-pressed={template === k} onClick={() => setTemplate(k)}>
                  <Thumb template={k} />
                  <span>{t(`template.${k}`)}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="cvdesk-pick" role="group" aria-label={t("accentLabel")}>
        {CV_ACCENTS.map((k) => (
          <button key={k} type="button" className={CV_ACCENT_BTN} data-accent={k} aria-pressed={accent === k} aria-label={t(`accent.${k}`)} onClick={() => setAccent(k)} />
        ))}
      </div>
      <div className="cvdesk-actions">
        <button type="button" className={skin.primary} onClick={() => void downloadPdf()} disabled={pdf.state === "busy"} aria-busy={pdf.state === "busy"}>
          {pdf.state === "busy" ? t("preparing") : t("downloadPdf")}
        </button>
        {columned ? (
          <button type="button" className={skin.ghost} onClick={() => void downloadPdf(CV_DESIGN_DEFAULT.template)} disabled={pdf.state === "busy"}>
            {t("downloadSingleFlow")}
          </button>
        ) : null}
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
      {pages ? (
        <p className={overBudget ? "cvdesk-note" : "cvdesk-hint"} role="status">
          {pages.over ? t("pages.over", { pages: pages.pages, budget: pages.budget }) : pages.sparse ? t("pages.sparse", { page: pages.pages }) : t("pages.fits", { pages: pages.pages })}
          {/* The cut that would fix it, where the designer holds one: tailoring folds the
              roles with nothing for the target onto one line (the toggle below). */}
          {overBudget && !target && targets.length ? ` ${t("pages.tailorHint")}` : null}
        </p>
      ) : null}
      {columned ? <p className="cvdesk-hint">{t("columnsNote", { layout: t(`template.${template}`) })}</p> : null}
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
      {saveState === "failed" ? (
        <p className="cvdesk-note" role="status">
          {t("saveFailed")}
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
      <div className="cvdesk-changes">
        <button type="button" className={CV_LINK_BTN} aria-expanded={showQuestions} onClick={() => setShowQuestions((v) => !v)} disabled={questions.length === 0}>
          {t("questions.toggle", { n: questions.length })}
        </button>
        {showQuestions && questions.length ? (
          <div className="cvdesk-list">
            <p>{t("questions.hint")}</p>
            {questionGroups.map((g) => (
              <div key={g.kind} className="cvdesk-qgroup">
                <p className="cvdesk-sub">{t(`questions.kind.${g.kind}`)}</p>
                <ul>
                  {g.items.map((q, i) => (
                    <li key={i}>
                      <q>{q.text}</q>
                      {q.roleIndex !== null && sheetDoc.experience[q.roleIndex] ? <span className="k">{t("questions.inRole", { role: sheetDoc.experience[q.roleIndex]!.role })}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <div className="cvdesk-changes">
        <button type="button" className={CV_LINK_BTN} aria-expanded={showHeld} onClick={() => setShowHeld((v) => !v)} disabled={heldCount === 0}>
          {t("held.toggle", { n: heldCount })}
        </button>
        {showHeld && heldCount ? (
          <div className="cvdesk-list">
            <p>{t("held.hint")}</p>
            {held.map((r, i) => (
              <div key={i} className="cvdesk-qgroup">
                <p className="cvdesk-sub">{r.role}</p>
                <ul>
                  {r.lines.map((line, j) => (
                    <li key={j}>{line}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      {/* "The owner sees what a machine will see" (registry export-format-and-round-trip-
          verification): the sheet's text in the order the PDF carries it - the order
          `npm run cv:roundtrip` holds equal to pypdf's extraction on every template. */}
      <div className="cvdesk-changes">
        <button type="button" className={CV_LINK_BTN} aria-expanded={showPlain} onClick={() => setShowPlain((v) => !v)}>
          {t("plainText.toggle")}
        </button>
        {showPlain ? (
          <div className="cvdesk-list">
            <p>{columned ? t("plainText.columns", { layout: t(`template.${template}`) }) : t("plainText.hint")}</p>
            <pre className="cvdesk-plain" lang={sheetDoc.lang}>
              {cvReadingLines(sheetDoc).join("\n")}
            </pre>
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
