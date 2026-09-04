"use client";

// The optional GitHub deep-dive, split out of analyzeRunAnalysis.ts. The split is
// not cosmetic: analyzeRunAnalysis.ts takes a VALUE import from
// AnalysisProgress.tsx, and Node's type-stripping test runner cannot load a .tsx
// file — so this half, which owns two network hops and the abort contract over
// them, was unreachable by any unit test while it lived there. Nothing here
// touches the stage machinery, so it costs nothing to keep it loadable.

import { githubAnalysisSchema, type GithubAnalysis } from "@/app/_lib/schemas";
import { AnalyzeClientError, extractFileText } from "./AnalyzeApi";
import type { AnalyzeErrorInfo } from "./AnalyzeTypes";
import { isAbort, toErrorInfo } from "./analyzeRunDelivery";

export type GithubCallbacks = {
  onLoading: () => void;
  onResult: (analysis: GithubAnalysis) => void;
  onError: (error: AnalyzeErrorInfo) => void;
  /**
   * A non-fatal degradation note: the deep-dive still produced a result, but it
   * ran with less than the user supplied (e.g. JD-blind because the attached JD
   * couldn't be read). Surfaced as a warning, not an error, so the result still
   * shows alongside it.
   */
  onWarning?: (warning: AnalyzeErrorInfo) => void;
};

// The JD as the form holds it: textarea/library text plus the optional uploaded
// file. The GitHub deep-dive must read the same JD source as the main analysis,
// so a file-only JD is extracted to text before the route is called.
export type GithubJdSource = {
  jobDescriptionText: string;
  jobDescriptionFile: File | null;
};

export async function executeGithubAnalysis(
  profile: string,
  jd: GithubJdSource,
  callbacks: GithubCallbacks,
  // The run's abort signal. Without it a superseded deep-dive (a second Retry, a
  // fresh submit, the tab unmounting) kept the GitHub route busy until the server
  // answered — the launch site only *ignored* the late callbacks, so the request
  // itself ran to completion and its extract-text hop with it. Threaded into both
  // network hops and into the catch, so an intentional abort is silent instead of
  // surfacing "GitHub analysis failed" on a surface nobody is watching.
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted) return;
  callbacks.onLoading();
  try {
    // Read the JD from the same source the main analysis does. That pipeline
    // prefers the uploaded file over the textarea (see analyze-run cliArgs), so
    // extract the file's text first; otherwise buildJobFitSignals would run
    // against an empty JD — a JD-blind result shown beside a main analysis that
    // DID use the JD. Extraction failure/empties fall back to the typed text, so
    // this never blocks the optional GitHub analysis or does worse than before.
    let jobDescriptionText = jd.jobDescriptionText.trim();
    if (jd.jobDescriptionFile) {
      const extracted = (await extractFileText(jd.jobDescriptionFile, signal).catch(() => "")).trim();
      if (signal?.aborted) return;
      if (extracted) jobDescriptionText = extracted;
    }
    // The user supplied a JD but we ended up with no usable text — the only way
    // this happens is a JD file that wouldn't extract and no typed fallback, so
    // the deep-dive below is about to run JD-blind. Tell the user the JD was
    // dropped instead of showing a result that quietly ignored it.
    const jdSupplied = Boolean(jd.jobDescriptionFile) || jd.jobDescriptionText.trim().length > 0;
    if (jdSupplied && !jobDescriptionText) {
      callbacks.onWarning?.({ code: "githubJdDropped" });
    }
    const response = await fetch("/api/github-analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile, jobDescriptionText }),
      signal,
    });
    const payload = await response.json();
    // Treat any payload carrying `error` as a soft failure — the GitHub deep-dive
    // is optional and the route returns 200 + { error, code } to keep the browser
    // console clean when GitHub rate-limits us, so the field's presence (not the
    // HTTP status) is the discriminator.
    if (payload && typeof payload === "object" && "error" in payload) {
      // The route's machine code (results.github.errors.*) is what the surface
      // shows; the English `error` rides along only as the log-side detail.
      throw new AnalyzeClientError("errGithubFailed", undefined, payload.code);
    }
    if (!response.ok) throw new AnalyzeClientError("errGithubFailed");
    if (signal?.aborted) return;
    callbacks.onResult(githubAnalysisSchema.parse(payload));
  } catch (caught) {
    // An intentional abort is not a failure — same rule the main run already
    // follows. Without it, cancelling a deep-dive surfaced "GitHub analysis
    // failed" from the fetch's own AbortError.
    if (isAbort(signal, caught)) return;
    callbacks.onError(toErrorInfo(caught, "errGithubFailed"));
  }
}
