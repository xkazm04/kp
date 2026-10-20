import type { GigReportStage } from "../types";
import type { GigReportFacts, GigReportPlanFact } from "./facts";
import { GIG_REPORT_STAGE_LABEL, sectionPlanFor, type GigReportBody, type GigReportSection, type GigReportSectionKind, type GigReportStat } from "./model";
import { escapeHtml as e } from "./sanitize";

// kp's own report body, built from the facts with no model: the keyless install, a model
// that failed or answered unusably, KP_OFFLINE - and the section a model's answer left out.
// Tables, stat cards, callouts and pills in the same vocabulary the model writes, and NO
// prose kp cannot back: every sentence below is a fact from the records or says plainly that
// the record does not have it. Also the header's stat cards and the page's meta line, which
// are kp's on every report whoever wrote the body. Pure.

const NOT = "not reported";

function money(v: number | null, currency = "USD"): string {
  if (v === null) return NOT;
  const n = v >= 100 ? Math.round(v).toLocaleString("en-US") : v.toFixed(v < 1 ? 2 : 0);
  return currency === "USD" ? `$${n}` : `${n} ${currency}`;
}

function usd(v: number | null): string {
  return v === null ? NOT : v < 0.01 ? "<$0.01" : `$${v.toFixed(2)}`;
}

function day(iso: string | null): string {
  if (!iso) return "not stated";
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : iso;
}

function hours(r: { min: number; max: number } | null): string {
  if (!r) return "not estimated";
  return r.min === r.max ? `${r.min} h` : `${r.min}-${r.max} h`;
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function pill(kind: "ok" | "fail" | "wait", text: string): string {
  return `<span class="pill ${kind}">${e(text)}</span>`;
}

function table(head: readonly string[], rows: readonly (readonly string[])[]): string {
  const th = head.map((h) => `<th>${e(h)}</th>`).join("");
  const body = rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("");
  return `<div class="tbl"><table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function figure(inner: string, caption: string): string {
  return `<figure>${inner}<figcaption>${caption}</figcaption></figure>`;
}

function list(items: readonly string[], ordered = false): string {
  if (items.length === 0) return "";
  const tag = ordered ? "ol" : "ul";
  return `<${tag}>${items.map((i) => `<li>${e(i)}</li>`).join("")}</${tag}>`;
}

function callout(kind: "" | "warn" | "ok", title: string, body: string): string {
  return `<div class="callout${kind ? ` ${kind}` : ""}"><strong>${e(title)}</strong>${body}</div>`;
}

/** A small, escaped Markdown reading of the research brief: headings, bullets, numbered
 *  items, paragraphs, **bold** and `code`. Anything else is text. */
export function briefMarkdownHtml(markdown: string): string {
  const inline = (s: string) =>
    e(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  const out: string[] = [];
  let listTag: "ul" | "ol" | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`);
    para = [];
  };
  const closeList = () => {
    if (listTag) out.push(`</${listTag}>`);
    listTag = null;
  };
  for (const raw of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (!line) {
      flushPara();
      closeList();
    } else if (heading) {
      flushPara();
      closeList();
      out.push(`<h3>${inline(heading[1])}</h3>`);
    } else if (bullet || numbered) {
      flushPara();
      const want = bullet ? "ul" : "ol";
      if (listTag !== want) {
        closeList();
        out.push(`<${want}>`);
        listTag = want;
      }
      out.push(`<li>${inline((bullet ?? numbered)![1])}</li>`);
    } else {
      closeList();
      para.push(line);
    }
  }
  flushPara();
  closeList();
  return out.join("");
}

// ---------------------------------------------------------------------------
// The header: stat cards and the meta line (kp's on every report)
// ---------------------------------------------------------------------------

export function reportStats(f: GigReportFacts): GigReportStat[] {
  const r = f.gig.reward;
  const reward: GigReportStat = r
    ? {
        n: r.amount !== null ? money(r.amount, (r.currency ?? "USD").toUpperCase()) : r.text.slice(0, 24),
        l: "Reward",
        c: f.money.rewardUsdIsEstimate && f.money.rewardUsd !== null && r.usd ? `about ${money(f.money.rewardUsd)} (USD estimate, rate of ${day(r.usd.rateAt)})` : r.amount === null ? "as the listing states it; no amount read" : "as the listing states it",
      }
    : { n: "-", l: "Reward", c: "the listing states none" };
  const effort = f.accepted?.effortHours ?? (f.brief?.effort ? { min: f.brief.effort.minHours, max: f.brief.effort.maxHours } : null);
  const effortStat: GigReportStat = { n: effort ? hours(effort) : "-", l: "Effort", c: f.accepted?.effortHours ? "the accepted plan's estimate" : effort ? "the research brief's estimate" : "not estimated" };
  const rate: GigReportStat = f.money.ratePerHourUsd
    ? { n: `$${f.money.ratePerHourUsd.min}-${f.money.ratePerHourUsd.max}`, l: "Per hour", c: "reward over effort, an estimate" }
    : { n: "-", l: "Per hour", c: "not computable: needs a reward and an effort" };
  const spend: GigReportStat = {
    n: usd(f.money.spentUsd.total),
    l: "Spent so far",
    c: `plans and agent runs${f.money.unreported > 0 ? `; ${f.money.unreported} not reported` : ""}`,
  };
  const verdict = f.outcomes.at(-1);
  if (verdict) return [reward, { n: cap(verdict.verdict.replace(/_/g, " ")), l: "Verdict", c: `recorded ${day(verdict.recordedAt)} (${verdict.source})` }, rate, spend];
  if (f.stage === "drafted" || f.stage === "sent") {
    const ev = f.attempt?.evidence ?? [];
    const passed = ev.filter((x) => x.passed === true).length;
    return [reward, effortStat, { n: ev.length ? `${passed}/${ev.length}` : "-", l: "Evidence passed", c: ev.length ? "as the agent's deliverable reports it" : "no evidence in the deliverable" }, spend];
  }
  return [reward, effortStat, rate, spend];
}

export function reportMeta(f: GigReportFacts): string[] {
  const out: string[] = [];
  if (f.gig.org) out.push(f.gig.org);
  out.push(`filed ${day(f.gig.createdAt)}`);
  if (f.gig.deadlineAt) out.push(`deadline ${day(f.gig.deadlineAt)}`);
  out.push(`status ${f.gig.status.replace(/_/g, " ")}`);
  return out;
}

// ---------------------------------------------------------------------------
// The sections
// ---------------------------------------------------------------------------

const TITLES: Readonly<Record<GigReportSectionKind, string>> = {
  gig: "The gig at a glance",
  asks: "What it asks",
  risks: "Challenges and risks",
  fit: "Fit and money",
  questions: "What to ask the client",
  plans: "The plans side by side",
  chosen: "The chosen plan",
  draft: "The draft",
  evidence: "The evidence",
  review: "Doubts and the review",
  outcome: "Outcome and money",
  lessons: "Lessons",
  proposal: "The client proposal",
  requests: "What we ask the client",
  other: "Notes",
};

function gigSection(f: GigReportFacts): string {
  const g = f.gig;
  const b = f.brief;
  const state = g.sourceState ? `${g.sourceState.state}${g.sourceState.bidCount !== null ? `, ${g.sourceState.bidCount} bids` : ""} (checked ${day(g.sourceState.checkedAt)})` : "not checked";
  const rows: string[][] = [
    ["Arena", e(`${g.arenaLabel} · ${g.typeLabel}`)],
    ["Category", e(b?.category ?? "not researched")],
    ["Client", e(g.org ?? "not stated")],
    ["Reward", e(g.reward?.text ?? "not stated")],
    ["Posted", e(day(g.postedAt))],
    ["Deadline", e(day(g.deadlineAt))],
    ["On its source", e(state)],
    ["Language", e(b?.language ?? "not detected")],
    ["Work kind", e(b?.workKind ? `${b.workKind}${b.workKindReason ? ` - ${b.workKindReason}` : ""}` : "not classified")],
  ];
  const lead = `<p>${e(g.listingTitle)}: ${e(b?.difficulty ? `${b.difficulty.replace(/_/g, " ")} work` : "unrated work")} in ${e(g.arenaLabel.toLowerCase())}.</p>`;
  return lead + figure(table(["Fact", "Value"], rows), `<strong>The listing's facts.</strong> Source: the listing as kp filed it; the source state from kp's freshness check.`);
}

function asksSection(f: GigReportFacts): string {
  const b = f.brief;
  if (!b) return "<p>Not researched yet.</p>";
  const missing = b.missingArtifacts.length ? callout("warn", "Ask for these before starting", list(b.missingArtifacts)) : "";
  const note = b.source === "deterministic" ? callout("", "No model read this listing", `<p>The brief below is kp's own summary${b.fallbackReason ? ` (${e(b.fallbackReason)})` : ""}.</p>`) : "";
  return `${note}${briefMarkdownHtml(b.markdown)}${missing}`;
}

function risksSection(f: GigReportFacts): string {
  const parts: string[] = [];
  const ch = f.brief?.challenges ?? [];
  parts.push(ch.length ? figure(table(["#", "Challenge"], ch.map((c, i) => [String(i + 1), e(c)])), `<strong>The challenges the brief names.</strong> Source: the research brief.`) : "<p>The brief names no challenge.</p>");
  if (f.gig.suspectReasons.length) parts.push(callout("warn", "Flagged by the honeypot scan", list(f.gig.suspectReasons.map((r) => r.replace(/_/g, " ")))));
  if (f.gig.withdrawnFor) parts.push(callout("warn", "Withdrawn for", `<p>${e(f.gig.withdrawnFor)}</p>`));
  const planRisks = f.accepted?.risks ?? [];
  if (planRisks.length) parts.push(`<h3>Risks the accepted plan names</h3>${list(planRisks)}`);
  return parts.join("");
}

function fitSection(f: GigReportFacts): string {
  const r = f.gig.reward;
  const b = f.brief;
  const rows: string[][] = [
    ["Reward", e(r?.text ?? "not stated"), "the listing"],
    ["In US dollars", e(f.money.rewardUsd === null ? "not converted" : `${money(f.money.rewardUsd)}${f.money.rewardUsdIsEstimate ? " (estimate)" : ""}`), e(r?.usd ? `rate ${r.usd.rate} of ${day(r.usd.rateAt)}, ${r.usd.source}` : f.money.rewardUsdIsEstimate ? "" : "the listing's own figure")],
    ["Effort", e(b?.effort ? hours({ min: b.effort.minHours, max: b.effort.maxHours }) : "not estimated"), e(b?.effort?.note ?? "the research brief")],
    ["Per hour", e(f.money.ratePerHourUsd ? `$${f.money.ratePerHourUsd.min}-${f.money.ratePerHourUsd.max}` : "not computable"), e(f.money.rateBasis ?? "needs a reward in dollars and an effort range")],
    ["Difficulty", e((b?.difficulty ?? "unrated").replace(/_/g, " ")), e(b?.difficultyReason ?? "no reason recorded")],
  ];
  if (f.gig.sourceState?.bidCount != null) rows.push(["Competition", e(`${f.gig.sourceState.bidCount} bids`), "the source, at the last freshness check"]);
  return figure(table(["Measure", "Value", "Basis"], rows), `<strong>What the gig pays against what it costs in time.</strong> Source: kp's arithmetic over the listing and the brief; an estimate, not a quote.`);
}

function questionsSection(f: GigReportFacts): string {
  const parts: string[] = [];
  const missing = f.brief?.missingArtifacts ?? [];
  parts.push(missing.length ? `<h3>Missing before work can start</h3>${list(missing, true)}` : "<p>The brief names nothing missing.</p>");
  const planQs = f.accepted?.questions ?? f.plans.flatMap((p) => p.questions).slice(0, 8);
  if (planQs.length) parts.push(`<h3>Open questions from the plans</h3>${list(planQs)}`);
  if (f.brief?.outreachMessage) parts.push(`<h3>A first message, ready to send</h3><blockquote><p>${e(f.brief.outreachMessage)}</p></blockquote>`);
  return parts.join("");
}

function planCell(p: GigReportPlanFact, aspect: string): string {
  switch (aspect) {
    case "Status":
      return p.accepted ? pill("ok", "accepted") : p.status === "ready" ? pill("wait", "ready") : p.status === "failed" ? `${pill("fail", "failed")} ${e(p.fallbackReason ?? "")}` : pill("wait", p.status);
    case "Approach":
      return e(p.summary ?? "no plan");
    case "Steps":
      return p.steps.length ? `${p.steps.length}: ${e(p.steps.map((s) => s.title).join("; "))}` : "-";
    case "Decisions":
      return p.decisions.length ? e(p.decisions.slice(0, 3).join(" · ")) : "-";
    case "Risks":
      return p.risks.length ? e(p.risks.slice(0, 3).join(" · ")) : "-";
    case "Effort":
      return e(hours(p.effortHours));
    default:
      return e(`${usd(p.costUsd)}${p.durationMs !== null ? `, ${Math.round(p.durationMs / 1000)} s` : ""}`);
  }
}

function plansSection(f: GigReportFacts): string {
  if (f.plans.length === 0) return "<p>No plan round has run.</p>";
  const aspects = ["Status", "Approach", "Steps", "Decisions", "Risks", "Effort", "Cost and time"];
  const rows = aspects.map((a) => [e(a), ...f.plans.map((p) => planCell(p, a))]);
  return figure(table(["", ...f.plans.map((p) => p.label)], rows), `<strong>Each seat's plan for this gig.</strong> Source: the plan round's rows; cost as each engine reported it.`);
}

function chosenSection(f: GigReportFacts): string {
  const a = f.accepted;
  if (!a) return "<p>No plan is accepted yet.</p>";
  const steps = `<ol>${a.steps.map((s) => `<li><strong>${e(s.title)}</strong> - done when ${e(s.doneWhen.charAt(0).toLowerCase() + s.doneWhen.slice(1))}</li>`).join("")}</ol>`;
  const note = a.note ? `<blockquote><p>${e(a.note)}</p></blockquote>` : "<p>The operator added no note.</p>";
  const goals = a.goals.length
    ? figure(
        table(["Step", "Status", "Progress", "Note"], a.goals.map((g) => [e(g.step), g.status === "done" ? pill("ok", "done") : g.status === "blocked" ? pill("fail", "blocked") : pill("wait", g.status), e(`${Math.round(g.progress)}%`), e(g.note ?? "-")])),
        `<strong>Where each step stands.</strong> Source: the agent's PLAN-STATUS, mirrored by kp's sync.`
      )
    : "<p>No progress reported yet.</p>";
  return `<p>Accepted ${e(a.label)} on ${e(day(a.acceptedAt))}.</p>${note}${steps}${goals}`;
}

function draftSection(f: GigReportFacts): string {
  const a = f.attempt;
  if (!a || a.draftExcerpt === null) return `<p>No draft yet${a?.fallbackReason ? ` (the last run ended ${e(a.fallbackReason)})` : ""}.</p>`;
  const rows: string[][] = [
    ["Summary", e(a.summary ?? NOT)],
    ["Length", e(`${a.draftChars} characters, ${a.draftLines} lines`)],
    ["Artifacts", e(a.artifacts.length ? a.artifacts.map((x) => `${x.kind}: ${x.title}`).join("; ") : "none")],
    ["Agent's confidence", e(a.confidence === null ? NOT : `${Math.round(a.confidence * 100)}% (its own, never a score)`)],
    ["Disclosure", a.disclosure ? e(a.disclosure) : pill("fail", "missing")],
    ["Run cost", e(usd(a.costUsd))],
  ];
  const opening = a.draftExcerpt.split(/\n\s*\n/).slice(0, 2).join("\n\n").slice(0, 700);
  return figure(table(["Aspect", "Draft"], rows), `<strong>The draft's shape.</strong> Source: the agent's deliverable.`) + callout("", "How the draft opens", `<p>${e(opening)}</p>`);
}

function evidenceSection(f: GigReportFacts): string {
  const ev = f.attempt?.evidence ?? [];
  if (ev.length === 0) return "<p>The deliverable lists no evidence.</p>";
  const rows = ev.map((x, i) => [String(i + 1), e(x.kind), x.command ? `<code>${e(x.command)}</code>` : "no command", e(x.result), x.passed === true ? pill("ok", "passed") : x.passed === false ? pill("fail", "failed") : pill("wait", "ran")]);
  return figure(table(["#", "Kind", "Command", "Result", "Verdict"], rows), `<strong>What the agent says it ran.</strong> Source: the deliverable's evidence; an item with no command is its account, not a log.`);
}

function reviewSection(f: GigReportFacts): string {
  const parts: string[] = [];
  parts.push(
    f.lint.length
      ? figure(table(["Severity", "Finding"], f.lint.map((l) => [l.severity === "blocker" ? pill("fail", "blocker") : l.severity === "warn" ? pill("wait", "check") : pill("wait", "note"), e(l.text)])), `<strong>What kp's pre-send lint found.</strong> Source: draft-lint over the deliverable.`)
      : "<p>kp's pre-send lint found nothing. That is not a pass: the checklist still applies.</p>"
  );
  const r = f.attempt?.review;
  parts.push(r ? `<p>Reviewed ${e(day(r.reviewedAt))}: ${r.ticked} of ${r.total} checklist items ticked. Attempt status: ${e(f.attempt?.status ?? "")}.</p>${r.note ? `<blockquote><p>${e(r.note)}</p></blockquote>` : ""}` : "<p>Not reviewed yet.</p>");
  return parts.join("");
}

function outcomeSection(f: GigReportFacts): string {
  const sent = f.attempt?.sentAt ? `<p>Sent ${e(day(f.attempt.sentAt))}.</p>` : "";
  const verdicts = f.outcomes.length
    ? figure(
        table(["Verdict", "Amount", "Recorded", "By", "Feedback"], f.outcomes.map((o) => [o.verdict === "accepted" ? pill("ok", "accepted") : o.verdict === "no_response" ? pill("wait", "no response") : pill("fail", o.verdict), e(o.amount === null ? NOT : money(o.amount, (o.currency ?? "USD").toUpperCase())), e(day(o.recordedAt)), e(o.source), e(o.feedbackText ?? "-")])),
        `<strong>The external verdicts.</strong> Source: kp's outcome ledger (append-only).`
      )
    : `<p>No verdict recorded${f.stage === "closed" ? `; the gig closed as ${e(f.gig.status)}` : " yet"}.</p>`;
  const spend = figure(
    table(["Spend", "Amount"], [["Plans", e(usd(f.money.spentUsd.plans))], ["Agent runs", e(usd(f.money.spentUsd.agentRuns))], ["Not reported", e(String(f.money.unreported))]]),
    `<strong>What the gig cost kp so far.</strong> Source: the costs each engine and Personas reported; unreported costs are counted, never added as zero.`
  );
  return sent + verdicts + spend;
}

function lessonsSection(f: GigReportFacts): string {
  const feedback = f.outcomes.map((o) => o.feedbackText).filter((t): t is string => Boolean(t));
  const ev = f.attempt?.evidence ?? [];
  const facts = [
    `Verdict: ${f.outcomes.at(-1)?.verdict.replace(/_/g, " ") ?? `none recorded (status ${f.gig.status})`}.`,
    ev.length ? `${ev.filter((x) => x.passed === true).length} of ${ev.length} evidence items passed.` : "The draft carried no evidence.",
    f.attempts.failed ? `${f.attempts.failed} of ${f.attempts.total} runs failed before a draft.` : `${f.attempts.total} run(s).`,
  ];
  return `${list(facts)}${feedback.length ? `<h3>In the client's words</h3>${feedback.map((t) => `<blockquote><p>${e(t)}</p></blockquote>`).join("")}` : ""}<p>kp files the recipe lessons an outcome teaches in its lessons ledger; this report does not repeat them.</p>`;
}

function proposalSection(f: GigReportFacts): string {
  const p = f.proposal;
  if (!p) return "<p>No client proposal is written yet.</p>";
  const steps = f.accepted?.steps ?? [];
  const milestones = steps.length
    ? figure(table(["#", "Milestone", "The client receives"], steps.map((s, i) => [String(i + 1), e(s.title), e(s.doneWhen)])), `<strong>The milestones the proposal offers.</strong> Source: the accepted plan the proposal was written from.`)
    : "<p>No plan is accepted: the proposal says the detailed plan follows the client's answers.</p>";
  const approach = f.accepted?.summary ? `<p>${e(f.accepted.summary)}</p>` : "";
  const who = p.source === "llm" ? "written by the pinned model" : "composed by kp from the brief and the plan";
  const opening = p.messageExcerpt.split(/\n\s*\n/).slice(0, 2).join("\n\n").slice(0, 600);
  return `<p>The proposal file is <code>${e(p.path)}</code>, ${e(who)} on ${e(day(p.generatedAt))}.</p>${approach}${milestones}${opening ? `<blockquote><p>${e(opening)}</p></blockquote>` : ""}`;
}

function requestsSection(f: GigReportFacts): string {
  const p = f.proposal;
  if (!p) return "<p>No client proposal is written yet, so nothing is asked.</p>";
  const rows = [...p.questions.map((q) => ["question", q]), ...p.artifacts.map((a) => ["artifact", a])];
  if (rows.length === 0) return "<p>The proposal asks the client nothing.</p>";
  const first = p.artifacts[0] ?? p.questions[0];
  return (
    figure(table(["#", "Ask", "Kind"], rows.map(([kind, text], i) => [String(i + 1), e(text), e(kind)])), `<strong>What the proposal asks the client.</strong> Source: the proposal record.`) +
    callout("warn", "What blocks the work", `<p>${e(first)}</p>`)
  );
}

const BUILD: Readonly<Record<GigReportSectionKind, (f: GigReportFacts) => string>> = {
  gig: gigSection,
  asks: asksSection,
  risks: risksSection,
  fit: fitSection,
  questions: questionsSection,
  plans: plansSection,
  chosen: chosenSection,
  draft: draftSection,
  evidence: evidenceSection,
  review: reviewSection,
  outcome: outcomeSection,
  lessons: lessonsSection,
  proposal: proposalSection,
  requests: requestsSection,
  other: () => "",
};

/** kp's section for one kind. */
export function deterministicSection(f: GigReportFacts, kind: GigReportSectionKind): GigReportSection {
  return { id: `s-${kind}`, title: TITLES[kind], kind, html: BUILD[kind](f) };
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function deterministicLead(f: GigReportFacts): string {
  const rate = f.money.ratePerHourUsd ? `about $${f.money.ratePerHourUsd.min}-${f.money.ratePerHourUsd.max} an hour` : "no hourly figure yet";
  const blockers = f.lint.filter((l) => l.severity === "blocker").length;
  const leads: Readonly<Record<GigReportStage, () => string>> = {
    researched: () => `${cap((f.brief?.difficulty ?? "unrated").replace(/_/g, " "))} work, ${rate} by kp's estimate.`,
    planned: () => `${f.plans.filter((p) => p.status === "ready").length} of ${plural(f.plans.length, "plan is", "plans are")} ready to compare; none is accepted yet.`,
    accepted: () => `The ${f.accepted?.label ?? "chosen"} plan is accepted: ${plural(f.accepted?.steps.length ?? 0, "step", "steps")}, ${rate}.`,
    drafted: () =>
      f.track === "proposal"
        ? `A client proposal is ready, asking ${plural((f.proposal?.questions.length ?? 0) + (f.proposal?.artifacts.length ?? 0), "thing", "things")} of the client before work starts.`
        : `A draft is in, with ${plural(blockers, "blocking finding", "blocking findings")} before it can be sent.`,
    sent: () => `The work was sent on ${day(f.attempt?.sentAt ?? null)}; the verdict is pending.`,
    closed: () => `${GIG_REPORT_STAGE_LABEL.closed}: ${f.outcomes.at(-1)?.verdict.replace(/_/g, " ") ?? f.gig.status}.`,
  };
  return leads[f.stage]();
}

/** The whole deterministic body for the facts' stage. The highlighter goes on the hourly
 *  figure when kp could compute one. Pure. */
export function deterministicReportBody(f: GigReportFacts): GigReportBody {
  const lead = deterministicLead(f);
  const rate = f.money.ratePerHourUsd ? `about $${f.money.ratePerHourUsd.min}-${f.money.ratePerHourUsd.max} an hour` : null;
  return { lead, highlight: rate && lead.includes(rate) ? rate : null, sections: sectionPlanFor(f.stage, f.track).map((k) => deterministicSection(f, k)) };
}
