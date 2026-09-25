"use client";

import { useRef, useState, type DragEvent } from "react";
import { useTranslations } from "next-intl";
import type { JobseekerProfile } from "@/app/_lib/jobseeker/types";
import { ACCEPT_EXTENSIONS, MAX_FILE_MB } from "@/app/_lib/upload-constraints";
import { useRelativeTime } from "@/app/_lib/use-relative-time";
import { FailureNotice } from "../FailureNotice";
import { classifyDraft, classifyExtract, classifySave, IMPORT_STAGES, rememberDraftSource, type DraftSource, type ImportFailure, type ImportStage, type ResponseLike } from "../importOutcome";
import { initialsOf } from "./sieveModel";
import { cx, SV_BTN_ACCENT, SV_BTN_SM_GHOST } from "./sieveRecipes";

// Step 1 — Arrive. The CV goes in here, for real: a file → text (POST /api/extract-text)
// → a structured profile draft (POST /api/profile/draft, the recruiter-side
// profile_draft, so a seeker's profile is the shape the matcher already scores) → the
// seeker's row (PUT /api/jobseeker/profile). What ended a hop is decided in
// importOutcome.ts and only painted here; the three hops tick as a checklist so a stall
// says WHERE, and "read without AI" is remembered for the "You" step to disclose.
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
  const rel = useRelativeTime();
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [failure, setFailure] = useState<ImportFailure | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const busy = stage === "extracting" || stage === "drafting" || stage === "saving";

  const choose = (next: File | null) => {
    setFailure(null);
    setStage("idle");
    if (next && next.size > MAX_BYTES) {
      setRefusal(t("tooBig", { max: MAX_FILE_MB }));
      setFile(null);
      return;
    }
    setRefusal(null);
    setFile(next);
  };

  async function run() {
    if (!file || busy) return;
    setFailure(null);
    const stop = (f: ImportFailure) => {
      setFailure(f);
      setStage("error");
    };
    setStage("extracting");
    const form = new FormData();
    form.append("file", file);
    const extracted = await postJson("/api/extract-text", { method: "POST", body: form });
    const extract = classifyExtract(extracted.res, extracted.body);
    if (!extract.ok) return stop(extract);
    setStage("drafting");
    const drafted = await postJson("/api/profile/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: extract.text }) });
    const draft = classifyDraft(drafted.res, drafted.body);
    if (!draft.ok) return stop(draft);
    setStage("saving");
    const saved = await postJson("/api/jobseeker/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile: draft.profile, cvSourceText: extract.text }),
    });
    const stored = classifySave(saved.res, saved.body);
    if (!stored.ok) return stop(stored);
    rememberDraftSource(stored.profile.id, draft.source);
    setStage("saved");
    setFile(null);
    onSaved(stored.profile, draft.source);
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
    </>
  );

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
              <span className="small muted" suppressHydrationWarning>
                {t("inMeta", { when: rel(profile.updatedAt) })}
              </span>
            </span>
          </span>
          <div className="arrived-drop">{dropZone(true)}</div>
        </div>
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
