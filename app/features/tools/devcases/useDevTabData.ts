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
  const buildNeed = () => {
    // Promoted-intake JD → the brief's structured fields fill the need (the
    // same fill runJdBuild does for JdBuildInput.brief — closing the dual-fill
    // asymmetry noted in app/_lib/devcase-run.ts / UAT L1-EVA-3): stack from
    // graded must-haves, responsibilities from 90-day outcomes, and the graded
    // requirements themselves ride along for role design. jdText stays the
    // prose anchor either way.
    const brief = jd?.brief ?? null;
    const musts = (brief?.requirements ?? []).filter((r) => r.kind === "must_have").map((r) => r.skill);
    return {
      title: (jd?.title ?? "").trim(),
      stack: musts.slice(0, 10),
      responsibilities: brief
        ? [...(brief.successCriteria ?? []), ...(brief.responsibilities ?? [])].filter(Boolean).slice(0, 12)
        : [],
      codebaseRefs: repoUrls
        .map((u) => u.trim())
        .filter(Boolean)
        .slice(0, MAX_CODEBASES)
        .map((ref) => ({ kind: "github", ref })),
      seniorityTarget: seniority,
      // roleFamily: the brief's classified family when an intake backs the JD
      // (the design/eval chain is domain-neutral since the rubric was
      // de-industry-locked); the software_engineering constant remains the
      // recorded default for JD-only needs, where nothing has classified them.
      roleFamily: brief?.roleFamily || "software_engineering",
      jdSlug: jd?.slug ?? "",
      jdText: jd?.body ?? "",
      ...(brief && (brief.requirements ?? []).length
        ? {
            statedRequirements: (brief.requirements ?? [])
              .filter((r) => r.skill)
              .map((r) => ({ skill: r.skill, kind: r.kind, hardness: r.hardness, weight: r.weight })),
          }
        : {}),
    };
  };

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
