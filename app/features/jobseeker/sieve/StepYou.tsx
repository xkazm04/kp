"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { CvPolishArtifact, JobseekerDialog, JobseekerPostingSummary, JobseekerProfile } from "@/app/_lib/jobseeker/types";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { CvDesigner } from "../cv/CvDesigner";
import { buildCvDocument } from "../cv/cvDocument";
import { tailorTargetsOf } from "../cv/cvTailor";
import type { DraftSource } from "../importOutcome";
import { ProvMark } from "./marks";
import { initialsOf, levelOf, provenanceOf, type ProvenanceKey, type ProvenanceMark } from "./sieveModel";
import { cx, SV_BTN, SV_BTN_GHOST, SV_BTN_PRIMARY, SV_BTN_SM_GHOST, SV_TILE } from "./sieveRecipes";

// Step 2 — "This is how your CV reads", and Step 3 — "You", side by side.
//
// The left column is the CV as the seeker dropped it; the right is the person the
// product read out of it. On the first look after an import the phrases the reading
// used LIGHT UP in the CV and FLY into their place in the portrait — the name onto
// the avatar, each skill onto its tile, each job title onto its line in the timeline —
// so the seeker watches their CV become a profile instead of being told it did.
//
// Honesty lives in the marks: a skill tile's SHAPE is where the claim comes from (done
// at work, a side project, study, or merely stated), and a stated-only claim is dashed
// and italic with a STATED tag, so it can never pass for a checked one. "No AI read
// this" is said once, calmly, when the draft came from the fixed parser.

type Term = { term: string; key: string };
type Piece = { text: string; key: string | null };
type Line = { kind: "name" | "sec" | "line"; pieces: Piece[] };

const HEADINGS = new Set(
  [
    "experience", "work experience", "employment", "projects", "education", "skills", "languages", "summary", "profile", "certifications", "interests",
    "zkušenosti", "pracovní zkušenosti", "praxe", "projekty", "vzdělání", "dovednosti", "jazyky", "shrnutí", "profil", "certifikace",
    "berufserfahrung", "erfahrung", "projekte", "ausbildung", "bildung", "kenntnisse", "fähigkeiten", "sprachen", "profil",
    "expérience", "expérience professionnelle", "projets", "formation", "compétences", "langues", "profil",
  ].map((h) => h.toLowerCase())
);

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The phrases worth lighting up, longest first so "Spring Boot" wins over "Spring". */
function termsOf(profile: JobseekerProfile): Term[] {
  const p = profile.profile;
  const out: Term[] = [];
  if (p.displayName?.trim()) out.push({ term: p.displayName.trim(), key: "name" });
  // The whole place first ("Brno, Czech Republic"), then its first part: one key lights
  // once, so a language named inside the place ("Czech") is never lit as a language.
  if (p.location?.trim()) {
    out.push({ term: p.location.trim(), key: "loc" });
    out.push({ term: p.location.trim().split(",")[0]!.trim(), key: "loc" });
  }
  if (p.educationDetail?.trim()) out.push({ term: p.educationDetail.trim().split(/[—,(]/)[0]!.trim(), key: "edu" });
  for (const lang of p.languages ?? []) {
    const bare = lang.split("(")[0]!.trim();
    if (bare) out.push({ term: bare, key: "lang" });
  }
  for (const c of p.skillClaims ?? []) if (c.skill?.trim()) out.push({ term: c.skill.trim(), key: `sk:${c.skill.trim()}` });
  (p.evidence ?? []).forEach((e, i) => {
    const head = (e.title ?? "").split(/\s[—–-]\s|:/)[0]!.trim();
    if (head.length >= 3) out.push({ term: head, key: `ev:${i}` });
  });
  return out.filter((t) => t.term.length >= 2).sort((a, b) => b.term.length - a.term.length);
}

/** Split the CV into lines, each cut into plain text and highlighted phrases. Every key
 *  lights ONCE (its first occurrence): the flight is one phrase to one place. */
export function readCv(source: string, terms: Term[]): Line[] {
  const used = new Set<string>();
  const lines: Line[] = [];
  const res = terms.map((t) => ({ ...t, re: new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(t.term)}(?![\\p{L}\\p{N}])`, "iu") }));
  let first = true;
  for (const raw of source.split(/\r?\n/)) {
    const text = raw.trimEnd();
    if (!text.trim()) continue;
    const bare = text.trim().replace(/[:：]$/, "").toLowerCase();
    if (!first && bare.length <= 40 && HEADINGS.has(bare)) {
      lines.push({ kind: "sec", pieces: [{ text: text.trim().replace(/[:：]$/, ""), key: null }] });
      continue;
    }
    // Greedy, non-overlapping: longest phrase first, then shorter ones in the gaps.
    const spans: { start: number; end: number; key: string }[] = [];
    for (const t of res) {
      if (used.has(t.key)) continue;
      const m = t.re.exec(text);
      if (!m) continue;
      const start = m.index;
      const end = start + m[0].length;
      if (spans.some((s) => start < s.end && end > s.start)) continue;
      spans.push({ start, end, key: t.key });
      used.add(t.key);
    }
    spans.sort((a, b) => a.start - b.start);
    const pieces: Piece[] = [];
    let at = 0;
    for (const s of spans) {
      if (s.start > at) pieces.push({ text: text.slice(at, s.start), key: null });
      pieces.push({ text: text.slice(s.start, s.end), key: s.key });
      at = s.end;
    }
    if (at < text.length) pieces.push({ text: text.slice(at), key: null });
    lines.push({ kind: first && spans.some((s) => s.key === "name") ? "name" : "line", pieces });
    first = false;
  }
  return lines;
}

const PROV_KINDS: { key: ProvenanceKey; mark: ProvenanceMark }[] = [
  { key: "work", mark: "solid" },
  { key: "project", mark: "half" },
  { key: "study", mark: "ring" },
  { key: "stated", mark: "dashed" },
];

/** Once per CV: keyed on the CV's hash (written by the profile PUT), never on
 *  updatedAt, which every preference save bumps. A profile saved before the hash was
 *  written falls back to the text's length, which a preference save does not touch. */
function flownKey(profile: JobseekerProfile): string {
  return `kp-me-flown:${profile.id}:${profile.cvHash ?? `len${profile.cvSourceText?.length ?? 0}`}`;
}

export function StepYou({
  profile,
  draftSource,
  cvDialog,
  postingsWaiting,
  polishing,
  onPolish,
  reduceMotion,
  postings,
}: {
  profile: JobseekerProfile | null;
  draftSource: DraftSource;
  cvDialog: JobseekerDialog | null;
  postingsWaiting: number;
  polishing: boolean;
  onPolish(): void;
  reduceMotion: boolean;
  /** The sieve's rows (every posting, decided and gone included): the designed CV's
   *  "Tailor for" reads what postings at each stated target ask for. Null while loading. */
  postings?: JobseekerPostingSummary[] | null;
}) {
  const t = useTranslations("me.sieve.you");
  const enumLabel = useEnumLabel();
  const sectionRef = useRef<HTMLElement | null>(null);
  const [skillOpen, setSkillOpen] = useState<string | null>(null);
  const [provFilter, setProvFilter] = useState<ProvenanceKey | null>(null);
  const [flying, setFlying] = useState(false);
  // The CV column's two faces: the CV as dropped (where the flight starts) and the same
  // CV designed as a page (../cv). The flight needs the dropped face, so it is the default.
  const [face, setFace] = useState<"dropped" | "designed">("dropped");
  const tCv = useTranslations("me.designedCv");

  const lines = useMemo(() => (profile?.cvSourceText ? readCv(profile.cvSourceText, termsOf(profile)) : []), [profile]);
  const designed = useMemo(
    () =>
      profile && (profile.cvSourceText || (profile.profile.evidence ?? []).length)
        ? buildCvDocument({ profile: profile.profile, preferences: profile.preferences, cvSourceText: profile.cvSourceText })
        : null,
    [profile]
  );
  // The seeker's stated targets, each with its demand, for the designer's "Tailor for".
  const tailorTargets = useMemo(() => (profile ? tailorTargetsOf(profile.preferences.targetTitles, postings) : []), [profile, postings]);

  // The flight: once per CV per browser session, when the step first scrolls into view.
  const fly = useCallback(() => {
    const root = sectionRef.current;
    if (!root || !profile) return;
    try {
      if (sessionStorage.getItem(flownKey(profile))) return;
      sessionStorage.setItem(flownKey(profile), "1");
    } catch {
      /* storage refused (private mode): the flight simply runs each visit */
    }
    const sources = Array.from(root.querySelectorAll<HTMLElement>(".sheet .hl"));
    const targets = Array.from(root.querySelectorAll<HTMLElement>(".you [data-tgt]"));
    if (reduceMotion || !sources.length) {
      sources.forEach((h) => h.classList.add("done"));
      return;
    }
    setFlying(true);
    targets.forEach((el) => el.classList.add("pending"));
    const land = (els: HTMLElement[]) =>
      els.forEach((el) => {
        el.classList.add("arrived");
        el.classList.remove("pending");
      });
    const flights = sources.slice(0, 36);
    flights.forEach((h, i) => {
      window.setTimeout(() => {
        h.classList.add("lit");
        const key = h.dataset.fly ?? "";
        const matches = targets.filter((el) => el.dataset.tgt === key);
        const target = matches[matches.length - 1];
        if (!target) {
          window.setTimeout(() => {
            h.classList.remove("lit");
            h.classList.add("done");
          }, 500);
          return;
        }
        const r1 = h.getBoundingClientRect();
        const r2 = target.getBoundingClientRect();
        const flyer = document.createElement("div");
        flyer.className = "flyer";
        flyer.textContent = h.textContent;
        flyer.style.left = `${r1.left}px`;
        flyer.style.top = `${r1.top}px`;
        root.appendChild(flyer);
        const dx = r2.left + Math.min(24, r2.width / 3) - r1.left;
        const dy = r2.top + r2.height / 2 - 10 - r1.top;
        const anim = flyer.animate(
          [
            { transform: "translate(0,0) scale(1)", opacity: 1 },
            { transform: `translate(${dx * 0.5}px,${dy * 0.5 - 40}px) scale(1.08)`, opacity: 1, offset: 0.45 },
            { transform: `translate(${dx}px,${dy}px) scale(.85)`, opacity: 0.9, offset: 0.85 },
            { transform: `translate(${dx}px,${dy}px) scale(.7)`, opacity: 0 },
          ],
          { duration: 820, easing: "cubic-bezier(.45,0,.2,1)" }
        );
        anim.onfinish = () => {
          flyer.remove();
          land(matches);
          h.classList.remove("lit");
          h.classList.add("done");
        };
      }, 180 + i * 105);
    });
    sources.slice(36).forEach((h) => h.classList.add("done"));
    window.setTimeout(() => {
      land(targets);
      root.querySelectorAll(".flyer").forEach((f) => f.remove());
      setFlying(false);
    }, 180 + flights.length * 105 + 1300);
  }, [profile, reduceMotion]);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el || !profile || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          window.setTimeout(fly, 200);
        }
      },
      { threshold: 0.18 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [profile, fly]);

  // A returning reader (the flight already ran this session) sees the phrases underlined.
  useEffect(() => {
    const root = sectionRef.current;
    if (!root || !profile) return;
    let flown = false;
    try {
      flown = !!sessionStorage.getItem(flownKey(profile));
    } catch {
      /* no storage: treated as not flown, the flight marks them */
    }
    if (flown && !flying) root.querySelectorAll(".sheet .hl").forEach((h) => h.classList.add("done"));
  }, [profile, lines, flying]);

  if (!profile) {
    return (
      <section className="step" id="s-cv" data-step="cv" aria-labelledby="h-cv">
        <div className="step-head">
          <div>
            <p className="eyebrow">{t("eyebrow")}</p>
            <h2 id="h-cv">{t("title")}</h2>
          </div>
        </div>
        <div className="gapbox">
          <strong>{t("notReached")}</strong>
          <span>{t("notReachedBody")}</span>
        </div>
      </section>
    );
  }

  const p = profile.profile;
  const claims = (p.skillClaims ?? []).filter((c): c is { skill: string; level?: string; provenance?: string } => !!c.skill?.trim());
  const statedCount = claims.filter((c) => provenanceOf(c.provenance).stated).length;
  const tiles = [...claims].sort((a, b) => levelOf(b.level) - levelOf(a.level) || provenanceOf(b.provenance).rank - provenanceOf(a.provenance).rank);
  const open = skillOpen ? claims.find((c) => c.skill === skillOpen) : undefined;
  const evidence = p.evidence ?? [];
  const artifact = cvDialog?.artifact && "cvMarkdown" in cvDialog.artifact ? (cvDialog.artifact as CvPolishArtifact) : null;
  const unreadable = artifact?.unreadable ?? [];
  const suggestions = artifact?.suggestions ?? [];
  const aiming = profile.preferences.targetTitles[0] ?? (p.roleFamily ? enumLabel("family", p.roleFamily) : null);
  const years = typeof p.yearsExperience === "number" ? t("years", { n: p.yearsExperience }) : p.archetype === "student" ? t("studying") : t("notStated");

  return (
    <section className="step" id="s-cv" data-step="cv" aria-labelledby="h-cv" ref={sectionRef}>
      <div className="step-head">
        <div className="grow">
          <p className="eyebrow">{t("eyebrow")}</p>
          <h2 id="h-cv">{t("title")}</h2>
        </div>
        {draftSource === "deterministic" ? (
          <span className="ai-note" role="note">
            <ProvMark mark="ring" size={16} />
            {t("noAi")}
          </span>
        ) : null}
      </div>
      <div className="cvwrap">
        <div>
          {designed ? (
            <div className="seg cv-face" role="group" aria-label={tCv("faceLabel")}>
              <button type="button" aria-pressed={face === "dropped"} onClick={() => setFace("dropped")}>
                {tCv("faceDropped")}
              </button>
              {/* Held while the flight runs: its phrases fly FROM the dropped face. */}
              <button type="button" aria-pressed={face === "designed"} disabled={flying} onClick={() => setFace("designed")}>
                {tCv("faceDesigned")}
              </button>
            </div>
          ) : null}
          {face === "designed" && designed ? (
            <CvDesigner doc={designed} mode="inline" targets={tailorTargets} skin={{ primary: SV_BTN_PRIMARY, ghost: SV_BTN_GHOST }} />
          ) : (
            <>
              <div className="sheet" aria-label={t("sheetLabel")}>
                {lines.length === 0 ? (
                  <p className="l-line">{t("noText")}</p>
                ) : (
                  lines.map((line, i) =>
                    line.kind === "sec" ? (
                      <div key={i} className="l-sec">
                        {line.pieces[0]!.text}
                      </div>
                    ) : (
                      <p key={i} className={line.kind === "name" ? "l-name" : "l-line"}>
                        {line.pieces.map((piece, j) =>
                          piece.key ? (
                            <span key={j} className="hl" data-fly={piece.key}>
                              {piece.text}
                            </span>
                          ) : (
                            <span key={j}>{piece.text}</span>
                          )
                        )}
                      </p>
                    )
                  )
                )}
              </div>
              <div className="sheet-actions">
                <button type="button" className={SV_BTN} onClick={onPolish} disabled={polishing}>
                  {t("polish")}
                </button>
                {profile.cvPolishedMd ? (
                  <a className="btn ghost" href="/api/jobseeker/cv.md">
                    {t("download")}
                  </a>
                ) : null}
              </div>
            </>
          )}
        </div>

        {/* data-step names this column to the rail's observer (SieveFlow STEP_IDS): without
            it the "You" step could never become the active one. */}
        <div className="you" id="s-you" data-step="you" aria-label={t("youLabel")}>
          <div className="you-id">
            <span className="av" data-tgt="name" aria-hidden>
              {initialsOf(p.displayName)}
            </span>
            <div>
              <div className="nm" data-tgt="name">
                {p.displayName?.trim() || t("unnamed")}
              </div>
              {aiming ? <div className="role">{t.rich("aiming", { role: aiming, b: (c) => <b>{c}</b> })}</div> : null}
              {p.archetype ? <span className="arch-badge">{enumLabel("archetype", p.archetype)}</span> : null}
            </div>
          </div>

          <div className="facts">
            <div className="fact" data-tgt="loc">
              <div className="k">{t("fact.lives")}</div>
              <div className="v">{p.location?.trim() || <span className="muted">{t("notStated")}</span>}</div>
            </div>
            <div className="fact">
              <div className="k">{t("fact.experience")}</div>
              <div className="v">
                {years}
                {p.archetype === "career_switcher" && typeof p.yearsExperience === "number" ? <span className="muted"> {t("otherField")}</span> : null}
              </div>
            </div>
            <div className="fact" data-tgt="edu">
              <div className="k">{t("fact.education")}</div>
              <div className="v">{p.educationLevel ? enumLabel("education", p.educationLevel) : <span className="muted">{t("notStated")}</span>}</div>
            </div>
            <div className="fact" data-tgt="lang">
              <div className="k">{t("fact.languages")}</div>
              <div className="v">{(p.languages ?? []).length ? (p.languages ?? []).join(", ") : <span className="muted">{t("notStated")}</span>}</div>
            </div>
            {p.roleFamily ? (
              <div className="fact">
                <div className="k">{t("fact.field")}</div>
                <div className="v">{enumLabel("family", p.roleFamily)}</div>
              </div>
            ) : null}
          </div>

          <div>
            <h4>{t("skillsTitle")}</h4>
            {tiles.length === 0 ? (
              <div className="gapbox">
                <strong>{t("noSkills")}</strong>
              </div>
            ) : (
              <div className="mesh">
                {tiles.map((c) => {
                  const pv = provenanceOf(c.provenance);
                  const lv = levelOf(c.level);
                  const levelLabel = c.level ? enumLabel("skillLevel", c.level) : "";
                  return (
                    <button
                      key={c.skill}
                      type="button"
                      className={cx(SV_TILE, `lv${lv}`, `m-${pv.mark}`, provFilter && provFilter !== pv.key && "dim")}
                      data-tgt={`sk:${c.skill}`}
                      aria-expanded={skillOpen === c.skill}
                      aria-label={t("tileLabel", { skill: c.skill, level: levelLabel, source: t(`prov.${pv.key}`) })}
                      onClick={() => setSkillOpen((cur) => (cur === c.skill ? null : c.skill))}
                    >
                      <ProvMark mark={pv.mark} size={lv >= 3 ? 16 : 14} />
                      {c.skill}
                      {pv.stated ? <span className="tag">{t("statedTag")}</span> : null}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="legend" role="group" aria-label={t("legendLabel")}>
              {PROV_KINDS.map((k) => (
                <button key={k.key} type="button" aria-pressed={provFilter === k.key} onClick={() => setProvFilter((cur) => (cur === k.key ? null : k.key))}>
                  <ProvMark mark={k.mark} size={14} />
                  {t(`prov.${k.key}`)}
                </button>
              ))}
              <span className="small muted">{t("legendHint", { stated: statedCount })}</span>
            </div>
            {open ? (
              <div className="skill-detail" role="status">
                <b>{open.skill}</b>
                {open.level ? ` · ${enumLabel("skillLevel", open.level)}` : ""} · {t(`prov.${provenanceOf(open.provenance).key}`)}
                {provenanceOf(open.provenance).stated ? ` — ${t("statedNote")}` : ""}
                <br />
                <span className="muted">
                  {(() => {
                    const named = evidence.filter((e) => (e.skills ?? []).includes(open.skill)).map((e) => (e.title ?? "").split(/\s[—–-]\s|:/)[0]);
                    return named.length ? t("namedIn", { list: named.join(" · ") }) : t("namedNowhere");
                  })()}
                </span>
              </div>
            ) : null}
          </div>

          {evidence.length ? (
            <div>
              <h4>{t("readFrom")}</h4>
              <ul className="timeline">
                {evidence.map((e, i) => {
                  const pv = provenanceOf((e as { provenance?: string }).provenance);
                  const hit = !!skillOpen && (e.skills ?? []).includes(skillOpen);
                  return (
                    <li key={i} data-tgt={`ev:${i}`} className={hit ? "hit" : undefined}>
                      <span className="dot">
                        <ProvMark mark={pv.mark} size={18} />
                      </span>
                      <details open={hit}>
                        <summary>
                          {e.kind ? <span className="kind">{enumLabel("evidenceKind", e.kind)}</span> : null}
                          {e.title}
                        </summary>
                        {e.text ? <p>{e.text}</p> : null}
                        {(e.skills ?? []).length ? (
                          <div className="ev-skills">
                            {(e.skills ?? []).map((s) => (
                              <span key={s} className="chip">
                                {s}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </details>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          <div className="honest">
            <div className="h">
              <ProvMark mark={artifact ? (unreadable.length ? "dashed" : "solid") : "ring"} size={16} />
              <div>
                <b>{artifact ? (unreadable.length ? t("unreadable", { count: unreadable.length }) : t("unreadableNone")) : t("unreadableUnchecked")}</b>
                {artifact && unreadable.length ? unreadable.slice(0, 3).join(" · ") : null}
              </div>
            </div>
            <div className="h">
              <ProvMark mark={suggestions.length ? "solid" : "dashed"} size={16} />
              <div>
                <b>{artifact ? (suggestions.length ? t("suggestions", { count: suggestions.length }) : t("suggestionsNone")) : t("suggestionsUnasked")}</b>
                {!artifact || suggestions.length ? (
                  <button type="button" className={SV_BTN_SM_GHOST} onClick={onPolish} disabled={polishing}>
                    {artifact ? t("suggestionsOpen") : t("polish")}
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          <div className="momentum">
            <div>{t.rich("momentum", { n: postingsWaiting, b: (c) => <span className="n">{c}</span> })}</div>
            <a className="btn" href="#s-want">
              {t("toWant")}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
