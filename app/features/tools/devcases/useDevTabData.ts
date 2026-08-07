// Case/posting/lifecycle/outbox loaders + the JD picker + the codebase-refs form
// fields, split out of DevTab.tsx. Everything here is read/intake state; the
// write actions (publish/source/approve/lifecycle-run) stay in useDevTabActions.
import { useEffect, useState } from "react";
import { useLoader } from "@/app/_lib/useLoader";
import { MAX_CODEBASES } from "@/app/_lib/devcase-constraints";
import type { DevCaseDetail, JdSummary, Lifecycle, OutboxItem, Posting, SelectedJd } from "./DevTypes";

export function useDevTabData() {
  // JD-first intake: the saved job description IS the need's metadata (title +
  // stack + responsibilities live in its body); the form only adds codebases +
  // a seniority target on top.
  const [jds, setJds] = useState<JdSummary[]>([]);
  const [jd, setJd] = useState<SelectedJd | null>(null);
  const [jdLoading, setJdLoading] = useState(false);
  const [repoUrls, setRepoUrls] = useState<string[]>([""]);
  const [seniority, setSeniority] = useState("medior");

  // Each loader tracks its own failure + last-updated so an outage renders an
  // explicit banner/stale pill instead of looking identical to an empty pipeline.
  // /api/devcase returns FULL records (role/case/scenario JSON), so the detail
  // reader opens instantly from the already-loaded list — no second fetch.
  const { data: cases, state: casesState, reload: loadCases } = useLoader<DevCaseDetail[]>(
    "/api/devcase",
    (p) => (p.cases as DevCaseDetail[]) ?? [],
    [],
  );
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
  useEffect(() => {
    loadCases();
    loadPostings();
    loadLifecycles();
    loadOutbox();
  }, [loadCases, loadPostings, loadLifecycles, loadOutbox]);

  // The saved-JD library backing the picker (same source as the Analyze tab).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/jds")
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => {
        if (!cancelled && p?.jds) setJds(p.jds as JdSummary[]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Picking a JD fetches its full body — that body travels as need.jdText, the
  // primary statement of the need the analyze step extracts metadata from.
  const pickJd = async (slug: string) => {
    if (!slug) {
      setJd(null);
      return;
    }
    setJdLoading(true);
    try {
      const r = await fetch(`/api/jds/${encodeURIComponent(slug)}`);
      if (r.ok) {
        const p = (await r.json()) as SelectedJd;
        setJd({ slug: p.slug, title: p.title, body: p.body });
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
  const buildNeed = () => ({
    title: (jd?.title ?? "").trim(),
    stack: [],
    responsibilities: [],
    codebaseRefs: repoUrls
      .map((u) => u.trim())
      .filter(Boolean)
      .slice(0, MAX_CODEBASES)
      .map((ref) => ({ kind: "github", ref })),
    seniorityTarget: seniority,
    // Intentionally FIXED for now (recorded decision, not a config knob): the Dev
    // case flow only supports engineering roles end-to-end (design + eval backend),
    // so roleFamily is a constant rather than a NeedForm selector like
    // seniorityTarget. Add a selector here and thread the value through if/when
    // other families become real.
    roleFamily: "software_engineering",
    jdSlug: jd?.slug ?? "",
    jdText: jd?.body ?? "",
  });

  return {
    jds, jd, jdLoading, pickJd,
    repoUrls, setRepoUrl, addRepo, removeRepo,
    seniority, setSeniority,
    cases, casesState, loadCases,
    postings, loadPostings,
    lifecycles, lifecyclesState, loadLifecycles,
    outbox, outboxState, loadOutbox,
    buildNeed,
  };
}
