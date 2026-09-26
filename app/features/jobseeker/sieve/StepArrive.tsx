"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { useTranslations } from "next-intl";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";
import type { JobseekerCvListItem, JobseekerProfile } from "@/app/_lib/jobseeker/types";
import { ACCEPT_EXTENSIONS, MAX_FILE_MB } from "@/app/_lib/upload-constraints";
import { classifyApiFailure, TRANSPORT_FAILURE, type ClassifiedFailure } from "../apiFailure";
import { FailureNotice } from "../FailureNotice";
import { importCv, IMPORT_STAGES, rememberDraftSource, type DraftSource, type ImportFailure, type ImportStage, type ResponseLike } from "../importOutcome";
import { initialsOf } from "./sieveModel";
import { cx, SV_BTN_ACCENT, SV_BTN_SM_GHOST, SV_LINK_BTN } from "./sieveRecipes";

// Step 1 — Arrive. The CV goes in here, for real: a file → text (POST /api/extract-text)
// → a structured profile draft (POST /api/profile/draft, the recruiter-side
// profile_draft, so a seeker's profile is the shape the matcher already scores) → the
// seeker's row (POST /api/jobseeker/cvs, which also REMEMBERS the CV). The draft hop may
// run the AI model this install is configured with (the fixed parser otherwise), and the
// privacy line says so: nothing goes to a job board, but "it stays on this install" would
// not be true. What ended a hop is decided in importOutcome.ts (`importCv`) and only
// painted here; the three hops tick as a checklist so a stall says WHERE, and "read
// without AI" is remembered for the "You" step to disclose.
//
// A CV READ BEFORE is not read again: between the text and the draft, importCv asks
// /api/jobseeker/cvs/reuse whether this seeker's store holds the same text (whitespace
// aside), and on a hit the stored draft is applied — no model call — and this step says
// so with the date it was first read, offering "Read it again" (a fresh draft). Earlier
// CVs are listed under the fold with "Use this one", which makes one active again
// through the same profile write an import makes.
//
// Before the first CV the step is the hero — the drop, the promise in numerals, the
// three stops ahead. After it, the step folds to one line with a quiet "replace" drop:
// a returning seeker came for the sieve, not for the welcome.

type Stage = "idle" | ImportStage | "saved" | "error";
const MAX_BYTES = MAX_FILE_MB * 1024 * 1024;

async function postJson(url: string, init: RequestInit): Promise<{ res: ResponseLike; body: Record<string, unknown> | null }> {
  try {
    const res = await fetch(url, init);
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return { res, body };
  } catch {
    /* offline or a killed tab: classified as transport, never as "that file could not be read" */
    return { res: { ok: false }, body: null };
  }
}

/** The seeker's earlier CVs: GET /api/jobseeker/cvs, metadata only. */
async function fetchCvs(): Promise<{ ok: true; cvs: JobseekerCvListItem[] } | { ok: false; fail: ClassifiedFailure }> {
  try {
    const res = await fetch("/api/jobseeker/cvs");
    const body = (await res.json().catch(() => null)) as { cvs?: JobseekerCvListItem[]; code?: string } | null;
    if (!res.ok || !Array.isArray(body?.cvs)) return { ok: false, fail: classifyApiFailure(res, body) };
    return { ok: true, cvs: body.cvs };
  } catch {
    return { ok: false, fail: TRANSPORT_FAILURE };
  }
}

export function StepArrive({
  profile,
  sourcesOn,
  onSaved,
}: {
  profile: JobseekerProfile | null;
  /** How many sources feed the sieve right now — the promise states it as a numeral. */
  sourcesOn: number;
  onSaved(profile: JobseekerProfile, source: DraftSource): void;
}) {
  const t = useTranslations("me.sieve.arrive");
  const tImport = useTranslations("me.import");
  const fmt = useDateFormat();
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [failure, setFailure] = useState<ImportFailure | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  // Was a CV already in when this file was chosen? Only then is there a score for the
  // replace note to speak about - a first import has none yet.
  const [replacing, setReplacing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const busy = stage === "extracting" || stage === "drafting" || stage === "saving";
  // The file the last import read, kept after it succeeded so "Read it again" can draft
  // it afresh without asking the seeker to find it twice. Set only while `reused` is.
  const [reused, setReused] = useState<{ cv: JobseekerCvListItem; file: File } | null>(null);

  // Earlier CVs. Reads are free, so the list loads with the step; a failure is said in
  // one quiet line with a retry rather than passed off as "no earlier CVs".
  const [cvs, setCvs] = useState<JobseekerCvListItem[] | null>(null);
  const [cvsFailed, setCvsFailed] = useState(false);
  const [showCvs, setShowCvs] = useState(false);
  const [using, setUsing] = useState<string | null>(null);
  const [useFailure, setUseFailure] = useState<{ id: string; fail: ClassifiedFailure } | null>(null);
  const [switched, setSwitched] = useState(false);
  const hasProfile = profile !== null;
  const loadCvs = useCallback(async () => {
    const r = await fetchCvs();
    setCvsFailed(!r.ok);
    if (r.ok) setCvs(r.cvs);
  }, []);
  useEffect(() => {
    if (!hasProfile) return;
    let live = true;
    void fetchCvs().then((r) => {
      if (!live) return;
      setCvsFailed(!r.ok);
      if (r.ok) setCvs(r.cvs);
    });
    return () => {
      live = false;
    };
  }, [hasProfile]);

  const choose = (next: File | null) => {
    setFailure(null);
    setStage("idle");
    setReused(null);
    setSwitched(false);
    if (next && next.size > MAX_BYTES) {
      setRefusal(t("tooBig", { max: MAX_FILE_MB }));
      setFile(null);
      return;
    }
    setRefusal(null);
    setReplacing(profile !== null);
    setFile(next);
  };

  async function run(opts: { fresh?: boolean; again?: File } = {}) {
    const source = opts.again ?? file;
    if (!source || busy) return;
    setFailure(null);
    setReused(null);
    setSwitched(false);
    if (opts.again) {
      setFile(opts.again);
      setReplacing(profile !== null);
    }
    const out = await importCv(source, { post: postJson, fileName: source.name, fresh: opts.fresh, onStage: setStage });
    if (!out.ok) {
      setFailure(out);
      setStage("error");
      return;
    }
    rememberDraftSource(out.profile.id, out.source);
    setStage("saved");
    setFile(null);
    if (out.reused && out.cv) setReused({ cv: out.cv, file: source });
    onSaved(out.profile, out.source);
    void loadCvs();
  }

  async function pickCv(cv: JobseekerCvListItem) {
    if (busy || using) return;
    setUsing(cv.id);
    setUseFailure(null);
    setReused(null);
    try {
      const res = await fetch(`/api/jobseeker/cvs/${encodeURIComponent(cv.id)}/use`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as { profile?: JobseekerProfile; cv?: JobseekerCvListItem; code?: string } | null;
      if (!res.ok || !body?.profile?.id) {
        setUseFailure({ id: cv.id, fail: classifyApiFailure(res, body) });
        return;
      }
      rememberDraftSource(body.profile.id, cv.draftSource);
      setStage("idle");
      setSwitched(true);
      onSaved(body.profile, cv.draftSource);
      void loadCvs();
    } catch {
      setUseFailure({ id: cv.id, fail: TRANSPORT_FAILURE });
    } finally {
      setUsing(null);
    }
  }

  const onDrag = (e: DragEvent<HTMLLabelElement>, entering: boolean) => {
    e.preventDefault();
    setOver(entering);
  };
  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setOver(false);
    choose(e.dataTransfer.files?.[0] ?? null);
  };

  const stageFallback: Record<ImportStage, string> = { extracting: tImport("errExtract"), drafting: tImport("errDraft"), saving: tImport("errSave") };
  const failureKind = failure?.reason === "transport" ? ("transport" as const) : undefined;
  const failureFallback = !failure ? "" : failure.reason === "noTextLayer" ? tImport("errNoTextLayer") : stageFallback[failure.stage];

  const dropZone = (compact: boolean) => (
    <>
      <label
        className={cx("drop", compact && "compact", over && "over")}
        onDragEnter={(e) => onDrag(e, true)}
        onDragOver={(e) => onDrag(e, true)}
        onDragLeave={(e) => onDrag(e, false)}
        onDrop={onDrop}
      >
        <span className="big">{compact ? t("replace") : t("dropBig")}</span>
        <span className="note">{t("dropNote", { max: MAX_FILE_MB })}</span>
        {file ? <span className="note">{t("chosen", { name: file.name })}</span> : null}
        {refusal ? <span className="note warn">{refusal}</span> : null}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_EXTENSIONS}
          aria-label={t("chooseLabel")}
          disabled={busy}
          onChange={(e) => choose(e.target.files?.[0] ?? null)}
        />
      </label>
      {file || busy ? (
        <div className="arrived-row drop-actions">
          <button type="button" className={SV_BTN_ACCENT} disabled={!file || busy} onClick={() => void run()} aria-busy={busy || undefined}>
            {busy ? t("reading") : t("read")}
          </button>
          {file && !busy ? (
            <button type="button" className={SV_BTN_SM_GHOST} onClick={() => choose(null)}>
              {t("clear")}
            </button>
          ) : null}
          <span className="small muted">{t("privacy")}</span>
        </div>
      ) : null}
      {/* A new CV re-reads the person, not the postings: the scores on screen were
          computed against the old one until the next scan (StepWant says the same). */}
      {compact && replacing && (file || busy || stage === "saved") ? <p className="small muted">{t("replaceNote")}</p> : null}
      {busy || stage === "saved" ? (
        <ol className="stages" aria-live="polite">
          {IMPORT_STAGES.map((s) => {
            const idx = IMPORT_STAGES.indexOf(s);
            const cur = stage === "saved" ? IMPORT_STAGES.length : IMPORT_STAGES.indexOf(stage as ImportStage);
            const cls = idx < cur ? "ok" : idx === cur ? "on" : "";
            return (
              <li key={s} className={cls}>
                <span className="dot" aria-hidden>
                  {idx < cur ? "✓" : ""}
                </span>
                {t(`stage.${s}`)}
              </li>
            );
          })}
        </ol>
      ) : null}
      {failure ? <FailureNotice failure={{ kind: failureKind, code: failure.code }} fallback={failureFallback} retrying={busy} onRetry={() => void run()} className="mt-3" /> : null}
      {/* A CV read before was not drafted again: said plainly, with the way to insist. */}
      {reused && !busy ? (
        <p className="small muted mt-2" role="status">
          {t("reused", { date: fmt.date(reused.cv.createdAt) })}{" "}
          <button type="button" className={SV_LINK_BTN} onClick={() => void run({ fresh: true, again: reused.file })}>
            {t("readAgain")}
          </button>
        </p>
      ) : null}
    </>
  );

  const others = (cvs ?? []).filter((cv) => !cv.active);
  const earlier = cvsFailed ? (
    <p className="small muted mt-3">
      {t("earlier.loadFailed")}{" "}
      <button type="button" className={SV_LINK_BTN} onClick={() => void loadCvs()}>
        {t("earlier.retry")}
      </button>
    </p>
  ) : others.length > 0 || switched ? (
    <div className="mt-3">
      {switched ? (
        <p className="small muted" role="status">
          {t("switched")} {t("replaceNote")}
        </p>
      ) : null}
      {others.length > 0 ? (
        <button type="button" className={SV_LINK_BTN} aria-expanded={showCvs} aria-controls="sv-earlier-cvs" onClick={() => setShowCvs((v) => !v)}>
          {t("earlier.toggle", { count: others.length })}
        </button>
      ) : null}
      {showCvs && others.length > 0 ? (
        <ul id="sv-earlier-cvs" className="mt-2 flex flex-col gap-2">
          {others.map((cv) => (
            <li key={cv.id} className="flex flex-wrap items-center gap-3">
              <b className="min-w-0 break-words">{cv.fileName ?? t("earlier.unnamed")}</b>
              <span className="small muted">
                {t("earlier.readOn", { date: fmt.date(cv.createdAt) })}
                {cv.draftSource ? ` · ${t(`earlier.how.${cv.draftSource}`)}` : ""}
              </span>
              <button
                type="button"
                className={SV_BTN_SM_GHOST}
                disabled={busy || using !== null}
                aria-busy={using === cv.id || undefined}
                onClick={() => void pickCv(cv)}
              >
                {using === cv.id ? t("earlier.using") : t("earlier.use")}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {useFailure ? (
        <FailureNotice
          failure={useFailure.fail}
          fallback={t("earlier.useFailed")}
          retrying={using !== null}
          onRetry={() => {
            const cv = others.find((c) => c.id === useFailure.id);
            if (cv) void pickCv(cv);
          }}
          onDismiss={() => setUseFailure(null)}
          className="mt-3"
        />
      ) : null}
    </div>
  ) : null;

  if (profile) {
    const name = profile.profile.displayName?.trim() || t("you");
    return (
      <section className="step" id="s-arrive" data-step="arrive" aria-labelledby="h-arrive">
        <div className="arrived-row">
          <span className="arrived-id">
            <span className="av" aria-hidden>
              {initialsOf(profile.profile.displayName)}
            </span>
            <span>
              <p className="eyebrow">{t("eyebrow")}</p>
              <h2 id="h-arrive">{t("inTitle", { name: name.split(/\s+/)[0] ?? name })}</h2>
            </span>
          </span>
          <div className="arrived-drop">{dropZone(true)}</div>
        </div>
        {earlier}
      </section>
    );
  }

  return (
    <section className="step" id="s-arrive" data-step="arrive" aria-labelledby="h-arrive">
      <div className="arrive">
        <div>
          <p className="eyebrow">{t("eyebrow")}</p>
          <h1 id="h-arrive">{t.rich("title", { br: () => <br />, em: (chunks) => <em>{chunks}</em> })}</h1>
          <p className="lede">{t("lede")}</p>
          {dropZone(false)}
          <div className="promise">
            <div>
              <b>{sourcesOn}</b>
              {t("promiseSources", { count: sourcesOn })}
            </div>
            <div>
              <b>5</b>
              {t("promiseChecks")}
            </div>
            <div>
              <b>0</b>
              {t("promiseSent")}
            </div>
          </div>
        </div>
        <div className="personas">
          <h4>{t("aheadTitle")}</h4>
          {(["you", "want", "sieve"] as const).map((k, i) => (
            <div key={k} className="pcard">
              <span className="av" aria-hidden>
                {i + 1}
              </span>
              <span>
                <span className="nm">
                  {t(`ahead.${k}.title`)}
                </span>
                <span className="sub">
                  {t(`ahead.${k}.sub`)}
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
