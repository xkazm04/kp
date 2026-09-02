// Candidate-source options, the match run itself, the shortlist-to-group-eval ledger,
// and the deep-link auto-run — split out of MatchTab.tsx so the component is left with
// just the picker/result markup.
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { useTranslations } from "next-intl";
import type { AnalysisRow, MatchRef, MatchResponse, ProfileRow, WeightVector } from "@/app/features/shared/matchTypes";
import { candidateOptionsPlaceholder, selectMatchView } from "./matchView";
import { createRunSequence } from "./matchRunSequence";
import { useErrorMessage } from "@/app/_lib/use-error-message";

type Translator = ReturnType<typeof useTranslations>;

export function useMatchTabRun(t: Translator) {
  // Resolve API failures from the machine `code`, never from the server's
  // English `error` — see app/_lib/use-error-message.ts.
  const errMsg = useErrorMessage();
  const [source, setSource] = useState<"profile" | "analysis">("profile");
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  // profile id → newer same-CV analysis (GET /api/profile `stale`). Lets a matched
  // profile-sourced candidate flag "a newer CV analysis exists since this was built".
  const [stale, setStale] = useState<Record<string, { newerSlug: string; newerAnalyzedAt: string }>>({});
  const [analyses, setAnalyses] = useState<AnalysisRow[]>([]);
  const [optionsLoaded, setOptionsLoaded] = useState(false);
  // Per-list load failure. A 500 from either options route resolves to a body with
  // no rows, so without this an outage rendered as "No saved profiles/analyses" —
  // an empty state asserting a cause it cannot know (the account is not empty; the
  // read failed). Tracked separately per list because either can fail alone.
  const [profilesFailed, setProfilesFailed] = useState(false);
  const [analysesFailed, setAnalysesFailed] = useState(false);
  const [selProfile, setSelProfile] = useState("");
  const [selAnalysis, setSelAnalysis] = useState("");

  // One sequence per hook instance; the ref keeps it stable across re-renders.
  const runSeq = useRef(createRunSequence());
  const [result, setResult] = useState<MatchResponse | null>(null);
  const [matchRef, setMatchRef] = useState<MatchRef>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // shortlist-to-group-eval — session ledger of pipeline entries filed FROM MATCH,
  // keyed by jobId. Lives here (not in MatchResults) because it must accumulate ACROSS
  // candidates: MatchResults remounts per candidate (key in MatchTab) so its
  // added/selected state stays candidate-scoped, while this ledger is what notices "two
  // different candidates are now in the pipeline for the same role" and powers the
  // "Compare N in group eval" handoff. Session-local on purpose — a fresh visit starts a
  // fresh shortlist; the Decisions cohort itself is the durable record.
  const [filed, setFiled] = useState<Record<string, { jobTitle: string; entryIds: string[] }>>({});
  const recordFiled = (jobId: string, jobTitle: string, entryId: string) =>
    setFiled((cur) => {
      const role = cur[jobId] ?? { jobTitle, entryIds: [] };
      // Dedup by entry id: a re-add of the same candidate (idempotent server-side)
      // must not inflate the count toward the compare CTA.
      if (role.entryIds.includes(entryId)) return cur;
      return { ...cur, [jobId]: { jobTitle, entryIds: [...role.entryIds, entryId] } };
    });

  const search = useSearchParams();
  const profileParam = search.get("profile");
  const analysisParam = search.get("analysis");
  const [autoRan, setAutoRan] = useState(false);

  useEffect(() => {
    let alive = true;
    // Track when BOTH option fetches have settled so the candidate <select> can show a
    // loading placeholder instead of "No saved profiles/analyses" (which conflated the
    // in-flight fetch with a genuinely empty account).
    // Both reads check `r.ok` BEFORE trusting the body: a failed fetch must land in
    // the failed branch, never in the "genuinely empty account" one — which also
    // means a profile-read outage no longer silently flips the source segment to
    // "Saved analysis" the way a truly empty profile list legitimately does.
    Promise.allSettled([
      fetch("/api/profile")
        .then(async (r) => {
          const p = (await r.json().catch(() => ({}))) as {
            profiles?: ProfileRow[];
            stale?: Record<string, { newerSlug: string; newerAnalyzedAt: string }>;
          };
          if (!r.ok) throw new Error("profile options");
          return p;
        })
        .then((p) => {
          if (!alive) return;
          const rows = p.profiles ?? [];
          setProfiles(rows);
          setStale(p.stale ?? {});
          if (rows.length) setSelProfile(rows[0].id);
          else setSource("analysis");
        })
        .catch(() => {
          if (alive) setProfilesFailed(true);
        }),
      fetch("/api/analyses")
        .then(async (r) => {
          const p = (await r.json().catch(() => ({}))) as { analyses?: AnalysisRow[] };
          if (!r.ok) throw new Error("analysis options");
          return p;
        })
        .then((p) => {
          if (!alive) return;
          const rows = p.analyses ?? [];
          setAnalyses(rows);
          if (rows.length) setSelAnalysis(rows[0].slug);
        })
        .catch(() => {
          if (alive) setAnalysesFailed(true);
        }),
    ]).finally(() => {
      if (alive) setOptionsLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  // `weights` (MAT1) is the recruiter's optional override for a re-rank; omitted on
  // a fresh run (server uses the archetype baseline) and on a reset.
  const runMatchFor = async (ref: MatchRef, weights?: WeightVector) => {
    if (!ref.profileId && !ref.analysisSlug) return;
    // grid-narrative-says-what-it-is: last-write-wins. /api/match spawns Python, so a run
    // over a big role set can outlast the next candidate's run — and the SLOWER, EARLIER
    // response used to call setResult last, painting one candidate's name over another
    // candidate's ranking with nothing on screen to suspect. `loading` and `error` are
    // guarded too: a superseded run must not clear the newer one's spinner.
    const ticket = runSeq.current.start();
    const current = () => runSeq.current.isCurrent(ticket);
    setLoading(true);
    setError(null);
    // Don't clear the prior result on a re-rank/re-weight: clearing unmounts <MatchResults>
    // (and the MatchWeightsPanel the user is dragging) to the empty placeholder until the
    // fetch returns. Keeping it mounted lets <MatchResults loading> show its in-place busy
    // state; a fresh run with no prior result falls to the loading branch in the gate below.
    try {
      const r = await fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...ref, limit: 25, ...(weights ? { weights } : {}) }),
      });
      const payload = await r.json();
      // An unknown deep-linked id resolves to 404 (Profile/Analysis not found) —
      // surface an honest, localized message rather than leaking the raw server
      // string or letting a doomed auto-run fail silently.
      if (r.status === 404) throw new Error(t("candidateNotFound"));
      if (!r.ok) throw new Error(errMsg(payload, t("matchFailedStatus", { status: r.status })));
      if (!current()) return; // a newer run owns the screen
      setResult(payload as MatchResponse);
      setMatchRef(ref);
    } catch (caught) {
      // A superseded run's failure is not the reader's problem either: showing it would
      // put an error over a newer run that is still in flight or already succeeded.
      if (current()) setError(caught instanceof Error ? caught.message : t("matchFailed"));
    } finally {
      if (current()) setLoading(false);
    }
  };

  const runMatch = () =>
    runMatchFor(source === "profile" ? { profileId: selProfile } : { analysisSlug: selAnalysis });

  // Deep link into candidate focus: ?tab=matrix&profile=<id> OR ?tab=matrix&analysis=<slug>
  // (legacy ?tab=match resolves here via LEGACY_TAB_ALIASES) — preselect the matching
  // source and auto-run once. The SAME params also tell MatrixTab to open this mode
  // rather than the grid. Analysis deep-links are supported symmetrically with
  // profiles so a persisted CV analysis lands here exactly like a saved profile does. Deferred kick-off (0 ms timer): the
  // preselect setters and runMatchFor's loading flag would otherwise fire
  // synchronously in the effect body and cascade a render before the first
  // commit settles. An unknown id surfaces the honest 404 message from runMatchFor.
  useEffect(() => {
    if (autoRan) return;
    const ref: MatchRef | null = profileParam
      ? { profileId: profileParam }
      : analysisParam
        ? { analysisSlug: analysisParam }
        : null;
    if (!ref) return;
    const timer = window.setTimeout(() => {
      setAutoRan(true);
      if (ref.profileId) {
        setSource("profile");
        setSelProfile(ref.profileId);
      } else {
        setSource("analysis");
        setSelAnalysis(ref.analysisSlug ?? "");
      }
      void runMatchFor(ref);
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileParam, analysisParam, autoRan]);

  // A prior ranking always wins over a transient error: selectMatchView keeps
  // <MatchResults> mounted on a failed re-rank and demotes the error to a
  // non-destructive inline banner (job-ui #2). The full-panel error branch is
  // reserved for when there is no ranking to protect.
  const view = selectMatchView({ hasResult: result !== null, error, loading });

  // Which of "loading" / "failed" / "empty" the candidate <select> may claim — never
  // more than the fetch actually proved.
  const profilePlaceholder = candidateOptionsPlaceholder({
    loaded: optionsLoaded,
    failed: profilesFailed,
    count: profiles.length,
  });
  const analysisPlaceholder = candidateOptionsPlaceholder({
    loaded: optionsLoaded,
    failed: analysesFailed,
    count: analyses.length,
  });

  return {
    source, setSource,
    profiles, stale,
    analyses,
    optionsLoaded,
    profilePlaceholder, analysisPlaceholder,
    selProfile, setSelProfile,
    selAnalysis, setSelAnalysis,
    result, matchRef,
    loading,
    filed, recordFiled,
    runMatchFor, runMatch,
    view,
  };
}
