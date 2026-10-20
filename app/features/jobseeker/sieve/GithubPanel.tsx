"use client";

// The seeker's own GitHub account in the You column (useSeekerEvidence.ts, /api/jobseeker/
// github). Registry recruiting/public-work-evidence-bounding, as the seeker meets it:
//   - identity is a gate: nothing is used until they say "this is my account";
//   - the budget is said in words: which labels were read, how many repositories, never code;
//   - an unavailable read (throttled, offline, unreachable) is said as the install's state,
//     never as "nothing there";
//   - it corroborates: a skill the CV already names is marked "on your CV too", one only the
//     repositories show is "not on your CV" - nothing on the CV is ever lowered by it.
// The projects the seeker ticks become their CV's Projects entries (githubEvidence.ts cvProfile).

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRelativeTime } from "@/app/_lib/use-relative-time";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { GITHUB_PROJECTS_MAX } from "@/app/_lib/jobseeker/githubEvidence";
import type { GithubEvidenceApi } from "./useSeekerEvidence";
import { ProvMark } from "./marks";
import { cx, SV_BTN_PRIMARY, SV_BTN_SM_GHOST, SV_SWITCH } from "./sieveRecipes";

const SKILLS_SHOWN = 14;

export function GithubPanel({ api }: { api: GithubEvidenceApi }) {
  const t = useTranslations("me.sieve.github");
  const rel = useRelativeTime();
  const resolveError = useErrorMessage();
  const [handle, setHandle] = useState("");
  const { state, suggestion, busy, outcome, error } = api;
  const typed = handle.trim() || suggestion || "";

  const outcomeNote = outcome ? (
    <p className="gh-outcome" role="status">
      {outcome.outcome === "throttled" && outcome.retryAfterSec
        ? t("outcome.throttledWait", { minutes: Math.max(1, Math.ceil(outcome.retryAfterSec / 60)) })
        : t(`outcome.${outcome.outcome}`)}
    </p>
  ) : null;
  const errorNote = error ? (
    <p className="gh-outcome" role="alert">
      {resolveError(error, t("error"))}
    </p>
  ) : null;

  // 1. Nothing read yet: the handle (the CV's own, when it names one), and what a read does.
  if (!state) {
    return (
      <div className="gh" aria-labelledby="gh-title">
        <p className="eyebrow">{t("eyebrow")}</p>
        <h4 id="gh-title">{t("title")}</h4>
        <p className="gh-lede">{suggestion ? t.rich("ledeSuggested", { handle: suggestion, b: (c) => <b>{c}</b> }) : t("lede")}</p>
        <form
          className="gh-read"
          onSubmit={(e) => {
            e.preventDefault();
            if (typed) void api.read(typed);
          }}
        >
          <input value={handle} placeholder={suggestion ?? t("placeholder")} onChange={(e) => setHandle(e.target.value)} aria-label={t("handleLabel")} maxLength={120} />
          <button type="submit" className={SV_BTN_PRIMARY} disabled={!typed || busy !== null} aria-busy={busy === "read" || undefined}>
            {busy === "read" ? t("reading") : t("read")}
          </button>
        </form>
        <p className="gh-budget">{t("promise")}</p>
        {outcomeNote}
        {errorNote}
      </div>
    );
  }

  const partial = state.derived.budget.partial;
  const skills = state.derived.skills.slice(0, SKILLS_SHOWN);
  const chosen = new Set(state.projects);
  // The repositories the seeker can pick from: the chosen ones first, then the rest, newest first.
  const pickable = [...state.repos].sort((a, b) => Number(chosen.has(b.name)) - Number(chosen.has(a.name)) || (b.pushedAt ?? "").localeCompare(a.pushedAt ?? ""));
  const toggle = (name: string) => {
    const next = chosen.has(name) ? state.projects.filter((n) => n !== name) : [...state.projects, name];
    if (next.length <= GITHUB_PROJECTS_MAX) void api.choose({ projects: next });
  };

  return (
    <div className="gh" aria-labelledby="gh-title">
      <p className="eyebrow">{t("eyebrow")}</p>
      <h4 id="gh-title">
        {t("titleRead")}{" "}
        <a href={state.htmlUrl} target="_blank" rel="noopener noreferrer">
          {state.htmlUrl.replace(/^https:\/\//, "")}
        </a>
      </h4>

      {/* 2. The identity gate. */}
      {!state.confirmed ? (
        <div className="gh-id">
          <p>{t.rich("isThisYou", { name: state.name ?? state.login, n: state.publicRepos, b: (c) => <b>{c}</b> })}</p>
          <div className="gh-actions">
            <button type="button" className={SV_BTN_PRIMARY} disabled={busy !== null} onClick={() => void api.choose({ confirmed: true, use: true })}>
              {t("confirm")}
            </button>
            <button type="button" className={SV_BTN_SM_GHOST} disabled={busy !== null} onClick={() => void api.forget()}>
              {t("notMine")}
            </button>
          </div>
        </div>
      ) : (
        <div className="gh-use">
          <button
            type="button"
            role="switch"
            className={SV_SWITCH}
            aria-checked={state.use}
            aria-label={t("useLabel")}
            disabled={busy !== null}
            onClick={() => void api.choose({ use: !state.use })}
          />
          <div>
            <b>{t("useLabel")}</b>
            <span>{state.use ? t("useOn") : t("useOff")}</span>
          </div>
        </div>
      )}

      {/* What the repositories show: corroborated, and what the CV does not name. */}
      {skills.length ? (
        <div className="gh-skills">
          <p className="gh-sub">{t("skillsTitle")}</p>
          <ul>
            {skills.map((s) => (
              <li key={s.skill} className={cx("gh-skill", s.corroborates ? "on-cv" : "new")}>
                <ProvMark mark="half" size={14} />
                <b>{s.skill}</b>
                <span>{t("repos", { n: s.repos })}</span>
                <em>{s.corroborates ? t("onCv") : t("notOnCv")}</em>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="gh-sub">{t("noSkills")}</p>
      )}

      {/* The CV's Projects: the seeker's pick, at most GITHUB_PROJECTS_MAX. */}
      {state.confirmed && state.repos.length ? (
        <div className="gh-projects">
          <p className="gh-sub">{t("projectsTitle", { n: state.projects.length, max: GITHUB_PROJECTS_MAX })}</p>
          <ul>
            {pickable.slice(0, 12).map((r) => (
              <li key={r.name} className={cx(chosen.has(r.name) && "picked")}>
                <label>
                  <input
                    type="checkbox"
                    checked={chosen.has(r.name)}
                    disabled={busy !== null || (!chosen.has(r.name) && state.projects.length >= GITHUB_PROJECTS_MAX)}
                    onChange={() => toggle(r.name)}
                  />
                  <span className="gh-repo">
                    <b>{r.name}</b>
                    {r.description ? <span>{r.description}</span> : <span className="muted">{t("noDescription")}</span>}
                    <small suppressHydrationWarning>
                      {[r.language, r.pushedAt ? t("pushed", { when: rel(r.pushedAt) }) : null, r.archived ? t("archived") : null].filter(Boolean).join(" · ")}
                    </small>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* The budget, in the artifact's own words. */}
      <p className="gh-budget" suppressHydrationWarning>
        {t("budget", { repos: state.derived.budget.repos || state.repos.length, read: state.derived.budget.languageReads.read, when: rel(state.readAt) })}
        {partial ? ` ${t("partial")}` : ""}
        {state.derived.budget.truncated ? ` ${t("truncated")}` : ""}
      </p>
      {outcomeNote}
      {errorNote}
      <div className="gh-actions">
        <button type="button" className={SV_BTN_SM_GHOST} disabled={busy !== null} onClick={() => void api.read(state.handle)} aria-busy={busy === "read" || undefined}>
          {busy === "read" ? t("reading") : t("readAgain")}
        </button>
        <button type="button" className={SV_BTN_SM_GHOST} disabled={busy !== null} onClick={() => void api.forget()}>
          {t("forget")}
        </button>
      </div>
    </div>
  );
}
