// Case/posting/lifecycle/outbox loaders + the JD picker + the codebase-refs form
// fields, split out of DevTab.tsx. Everything here is read/intake state; the
// write actions (publish/source/approve/lifecycle-run) stay in useDevTabActions.
import { useCallback, useEffect, useRef, useState } from "react";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { useTranslations } from "next-intl";
import { useLoader } from "@/app/_lib/useLoader";
import { MAX_CODEBASES } from "@/app/_lib/devcase-constraints";
import type { DevCaseDetail, JdSummary, Lifecycle, OutboxItem, Posting, SelectedJd } from "./DevTypes";
import { buildNeed } from "./buildNeed";
import { shouldReloadOnReturn } from "./outboxRefresh";

export function useDevTabData() {
  const t = useTranslations("devcase.studio.jds");
  const errorMessage = useErrorMessage();
  // JD-first intake: the saved job description IS the need's metadata (title +
  // stack + responsibilities live in its body); the form only adds codebases +
  // a seniority target on top.
  const [jds, setJds] = useState<JdSummary[]>([]);
  const [jd, setJd] = useState<SelectedJd | null>(null);
  const [jdLoading, setJdLoading] = useState(false);
  // The picker is REQUIRED intake — nothing on the Define tab can run without a JD —
  // so a failed fetch used to leave the entrance looking like an empty library and
  // pointed the operator at "save one" in a library that already had some. The
  // failure is now named, in the reader's language, with a way back.
  const [jdsError, setJdsError] = useState<string | null>(null);
  const [repoUrls, setRepoUrls] = useState<string[]>([""]);
  const [seniority, setSeniority] = useState("medior");

  // Each loader tracks its own failure + last-updated so an outage renders an
  // explicit banner/stale pill instead of looking identical to an empty pipeline.
  // /api/devcase returns FULL records (role/case/scenario JSON), so the detail
  // reader opens instantly from the already-loaded list — no second fetch.
  // The read is PAGED, and the payload says whether the page was cut. It used to take
  // the store's default of 50 silently, so a studio past fifty approved cases showed
  // fifty newest and gave the reader no way to know the rest existed. The loader keeps
  // the whole envelope so `truncated` survives to the table that has to say so.
  const { data: casesPage, state: casesState, reload: loadCases } = useLoader<{ items: DevCaseDetail[]; truncated: boolean }>(
    "/api/devcase",
    (p) => ({ items: (p.cases as DevCaseDetail[]) ?? [], truncated: p.truncated === true }),
    { items: [], truncated: false },
  );
  const cases = casesPage.items;
  const { data: postings, reload: loadPostings } = useLoader<Posting[]>(
    "/api/devcase/postings",
    (p) => (p.postings as Posting[]) ?? [],
    [],
  );
  const { data: lifecycles, state: lifecyclesState, reload: loadLifecycles } = useLoader<Lifecycle[]>(
    "/api/devcase/lifecycle",
    (p) => (p.lifecycles as Lifecycle[]) ?? [],
    [],
  );
  const { data: outbox, state: outboxState, reload: loadOutbox } = useLoader<OutboxItem[]>(
    "/api/devcase/comms",
    (p) => (p.outbox as OutboxItem[]) ?? [],
    [],
  );
  // When the outbox last STARTED a load. Read by the return-to-tab refresh below to
  // collapse the focus/visibilitychange double-fire and to throttle an alt-tabbing
  // reader; a ref, not state, because changing it must not re-render the tab.
  const outboxAttemptAt = useRef<number | null>(null);
  const reloadOutbox = useCallback(() => {
    outboxAttemptAt.current = Date.now();
    return loadOutbox();
  }, [loadOutbox]);

  useEffect(() => {
    loadCases();
    loadPostings();
    loadLifecycles();
    reloadOutbox();
  }, [loadCases, loadPostings, loadLifecycles, reloadOutbox]);

  // Refresh the outbox when the reader COMES BACK to the tab. Dead letters and bounce
  // receipts are produced by the relay long after the click that queued the message,
  // so a tab left open showed a snapshot from before the failure existed. Returning is
  // the one moment we know the reader is about to trust what is on screen. The
  // decision (which event, how often) is the pure `shouldReloadOnReturn`; staleness
  // semantics are untouched, because this goes through the same loader as every other
  // read — a failed refresh keeps the last good rows and leaves the stale pill up.
  useEffect(() => {
    const onReturn = (event: "focus" | "visibilitychange") => () => {
      if (
        !shouldReloadOnReturn({
          event,
          visibility: document.visibilityState === "visible" ? "visible" : "hidden",
          lastAttemptAt: outboxAttemptAt.current,
          now: Date.now(),
        })
      ) {
        return;
      }
      reloadOutbox();
    };
    const onFocus = onReturn("focus");
    const onVisibility = onReturn("visibilitychange");
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [reloadOutbox]);

  // The saved-JD library backing the picker (same source as the Analyze tab).
  const [jdsReloadKey, setJdsReloadKey] = useState(0);
  const reloadJds = useCallback(() => setJdsReloadKey((n) => n + 1), []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/jds");
        const body = (await r.json().catch(() => null)) as
          | ({ jds?: unknown } & { code?: string | null })
          | null;
        if (cancelled) return;
        if (!r.ok) {
          setJdsError(errorMessage(body, t("failed")));
          return;
        }
        setJdsError(null);
        if (body?.jds) setJds(body.jds as JdSummary[]);
      } catch {
        // Not silent: without the library the whole Define flow is unreachable, so
        // the operator is told and offered a retry rather than shown an empty picker.
        if (!cancelled) setJdsError(t("failed"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jdsReloadKey, errorMessage, t]);

  // Picking a JD fetches its full body — that body travels as need.jdText, the
  // primary statement of the need the analyze step extracts metadata from.
  const pickJd = async (slug: string) => {
    if (!slug) {
      setJd(null);
      return;
    }
    setJdLoading(true);
    try {
      // ?brief=1 — also fetch the promoted role-intake brief behind this JD
      // (workspace-gated server-side; null when the JD has no intake behind it).
      const r = await fetch(`/api/jds/${encodeURIComponent(slug)}?brief=1`);
      if (r.ok) {
        const p = (await r.json()) as SelectedJd & { intakeBrief?: SelectedJd["brief"] };
        setJd({ slug: p.slug, title: p.title, body: p.body, brief: p.intakeBrief ?? null });
        // The brief's confirmed seniority seeds the selector (still editable).
        if (p.intakeBrief?.seniority && p.intakeBrief?.spineProvenance?.seniority === "stated") {
          setSeniority(p.intakeBrief.seniority);
        }
      }
    } finally {
      setJdLoading(false);
    }
  };

  const setRepoUrl = (index: number, value: string) =>
    setRepoUrls((urls) => urls.map((u, i) => (i === index ? value : u)));
  const addRepo = () => setRepoUrls((urls) => (urls.length < MAX_CODEBASES ? [...urls, ""] : urls));
  const removeRepo = (index: number) =>
    setRepoUrls((urls) => (urls.length > 1 ? urls.filter((_, i) => i !== index) : [""]));

  // A selected JD is REQUIRED — the single recorded contract for the need. NeedForm
  // marks the picker `*`, sets aria-invalid while nothing is selected, and disables
  // both Run and Analyze until a JD body has loaded, so buildNeed only ever runs
  // with a real title + jdText. Stack/responsibilities are deliberately empty: the
  // analyze step extracts them from the JD body (the old free-text metadata fields
  // duplicated what every JD already says).
  // The fold itself lives in buildNeed.ts, pure and tested: everything the analyze
  // and design chain sees is built here, and inside a hook nothing could reach it.
  const build = () => buildNeed({ jd, repoUrls, seniority });

  return {
    jds, jd, jdLoading, pickJd, jdsError, reloadJds,
    repoUrls, setRepoUrl, addRepo, removeRepo,
    seniority, setSeniority,
    cases, casesTruncated: casesPage.truncated, casesState, loadCases,
    postings, loadPostings,
    lifecycles, lifecyclesState, loadLifecycles,
    outbox, outboxState, loadOutbox: reloadOutbox,
    buildNeed: build,
  };
}
