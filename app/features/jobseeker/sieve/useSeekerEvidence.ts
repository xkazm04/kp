"use client";

// The seeker's two outside sources of evidence, as the flow reads them:
//   useRoleResearch   - what their target titles ask for NOW, researched on the web
//                       (/api/jobseeker/research; roleResearch.ts)
//   useGithubEvidence - their own GitHub account (/api/jobseeker/github; githubEvidence.ts)
// Both are loaded once by SieveFlow and handed to the steps that show or use them (StepWant
// shows the research, StepYou the GitHub read, and both feed the designed CV), so the CV
// preview and the flow never read two different copies.

import { useCallback, useEffect, useState } from "react";
import type { GithubState } from "@/app/_lib/jobseeker/githubEvidence";
import type { RoleResearchRecord } from "@/app/_lib/jobseeker/roleResearch";
import type { JobseekerProfile } from "@/app/_lib/jobseeker/types";
import { callJson, type ApiFailure } from "../sourcesApi";

export type ResearchView = { record: RoleResearchRecord | null; titles: string[]; markets: string[]; fresh: boolean };
export type ResearchAttempt = { source: "llm" | "deterministic"; fallbackReason: string | null };

export type RoleResearchApi = ResearchView & {
  loaded: boolean;
  running: boolean;
  /** The last run's answer when it did NOT produce a research (keyless, failed): shown as
   *  the install's state, beside whatever research is still on record. */
  attempt: ResearchAttempt | null;
  error: ApiFailure | null;
  run(force: boolean): Promise<void>;
};

const EMPTY_VIEW: ResearchView = { record: null, titles: [], markets: [], fresh: false };

export function useRoleResearch(profile: JobseekerProfile | null, locale: string): RoleResearchApi {
  const [view, setView] = useState<ResearchView>(EMPTY_VIEW);
  const [loaded, setLoaded] = useState(false);
  const [running, setRunning] = useState(false);
  const [attempt, setAttempt] = useState<ResearchAttempt | null>(null);
  const [error, setError] = useState<ApiFailure | null>(null);
  // The question changes when the titles or markets do; the answer is re-read then.
  const question = profile ? JSON.stringify([profile.id, profile.preferences.targetTitles ?? [], profile.preferences.countries ?? []]) : null;

  useEffect(() => {
    if (!question) return;
    let live = true;
    void callJson<ResearchView>("/api/jobseeker/research").then((r) => {
      if (!live) return;
      setLoaded(true);
      if (r.ok) setView({ ...EMPTY_VIEW, ...r.body });
    });
    return () => {
      live = false;
    };
  }, [question]);

  const run = useCallback(
    async (force: boolean) => {
      setRunning(true);
      setError(null);
      setAttempt(null);
      try {
        const r = await callJson<ResearchView & { attempt: ResearchAttempt | null }>(`/api/jobseeker/research?lang=${encodeURIComponent(locale)}`, {
          method: "POST",
          body: JSON.stringify({ force }),
        });
        if (!r.ok) {
          setError(r.fail);
          return;
        }
        setView({ record: r.body.record, titles: r.body.titles, markets: r.body.markets, fresh: r.body.fresh });
        setAttempt(r.body.attempt && r.body.attempt.source === "deterministic" ? r.body.attempt : null);
      } finally {
        setRunning(false);
      }
    },
    [locale]
  );

  return { ...view, loaded, running, attempt, error, run };
}

export type GithubOutcome = "ok" | "invalid_handle" | "not_found" | "not_a_person" | "throttled" | "offline" | "unreachable" | "failed";
export type GithubChoice = { confirmed?: boolean; use?: boolean; projects?: string[] };

export type GithubEvidenceApi = {
  state: GithubState | null;
  suggestion: string | null;
  loaded: boolean;
  busy: "read" | "save" | null;
  /** The last read's outcome when it did not produce a snapshot (never "no evidence"). */
  outcome: { outcome: GithubOutcome; retryAfterSec?: number } | null;
  error: ApiFailure | null;
  read(handle: string): Promise<void>;
  choose(choice: GithubChoice): Promise<void>;
  forget(): Promise<void>;
};

export function useGithubEvidence(profileId: string | null): GithubEvidenceApi {
  const [state, setState] = useState<GithubState | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<"read" | "save" | null>(null);
  const [outcome, setOutcome] = useState<GithubEvidenceApi["outcome"]>(null);
  const [error, setError] = useState<ApiFailure | null>(null);

  useEffect(() => {
    if (!profileId) return;
    let live = true;
    void callJson<{ state: GithubState | null; suggestion: string | null }>("/api/jobseeker/github").then((r) => {
      if (!live) return;
      setLoaded(true);
      if (r.ok) {
        setState(r.body.state);
        setSuggestion(r.body.suggestion);
      }
    });
    return () => {
      live = false;
    };
  }, [profileId]);

  const read = useCallback(async (handle: string) => {
    setBusy("read");
    setError(null);
    setOutcome(null);
    try {
      const r = await callJson<{ state: GithubState | null; outcome: GithubOutcome; retryAfterSec?: number }>("/api/jobseeker/github", {
        method: "POST",
        body: JSON.stringify({ handle }),
      });
      if (!r.ok) {
        setError(r.fail);
        return;
      }
      setState(r.body.state);
      setOutcome(r.body.outcome === "ok" ? null : { outcome: r.body.outcome, retryAfterSec: r.body.retryAfterSec });
    } finally {
      setBusy(null);
    }
  }, []);

  const choose = useCallback(async (choice: GithubChoice) => {
    setBusy("save");
    setError(null);
    try {
      const r = await callJson<{ state: GithubState | null }>("/api/jobseeker/github", { method: "PUT", body: JSON.stringify(choice) });
      if (!r.ok) {
        setError(r.fail);
        return;
      }
      setState(r.body.state);
    } finally {
      setBusy(null);
    }
  }, []);

  const forget = useCallback(async () => {
    setBusy("save");
    setError(null);
    try {
      const r = await callJson<{ state: null }>("/api/jobseeker/github", { method: "DELETE" });
      if (!r.ok) {
        setError(r.fail);
        return;
      }
      setState(null);
      setOutcome(null);
    } finally {
      setBusy(null);
    }
  }, []);

  return { state, suggestion, loaded, busy, outcome, error, read, choose, forget };
}
