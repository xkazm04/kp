import { escapeHtml as e } from "../report/sanitize";
import { proposalLabels } from "./labels";
import type { GigProposalBody } from "./model";
import { GIG_PROPOSAL_CSS } from "./proposal-css";

// The client proposal page: ONE self-contained, client-facing HTML document. Every text field
// is escaped here (the body is plain text, never HTML), and the page carries NO internal data
// by construction - its only inputs are the proposal body, the language, the date and the
// disclosure sentence; no fit score, cost, model, id or seat can reach it because none is
// passed in. Header (the work as the client named it, "Proposal", the date), what you need,
// the approach, the milestones as a numbered table, timeline and effort, then what I need
// from you and the questions before I start, and a quiet footer with the AI-use disclosure.

export type GigProposalPageInput = {
  body: GigProposalBody;
  /** ISO 639 code of the body's language (the page's `lang`; the labels follow it). */
  language: string;
  generatedAt: string;
  disclosure: string;
};

function dateIn(language: string, iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso.slice(0, 10);
  try {
    return new Intl.DateTimeFormat(language, { dateStyle: "long", timeZone: "UTC" }).format(new Date(t));
  } catch {
    // an unknown locale code: the ISO day reads the same in every language
    return new Date(t).toISOString().slice(0, 10);
  }
}

function paragraphs(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${e(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function list(items: readonly string[], none: string, ordered: boolean): string {
  if (items.length === 0) return `<p>${e(none)}</p>`;
  const tag = ordered ? "ol" : "ul";
  return `<${tag}>${items.map((i) => `<li>${e(i)}</li>`).join("")}</${tag}>`;
}

/** The proposal file's HTML. Pure. */
export function renderGigProposalPage(input: GigProposalPageInput): string {
  const { body, language } = input;
  const L = proposalLabels(language);
  const lang = /^[a-z]{2,3}$/.test(language) ? language : "en";
  let n = 0;
  const h2 = (title: string) => `<h2><span class="n">${++n}</span>${e(title)}</h2>`;
  const milestones = body.milestones.length
    ? `<table><thead><tr><th>#</th><th>${e(L.milestone)}</th><th>${e(L.receive)}</th></tr></thead><tbody>${body.milestones
        .map((m, i) => `<tr><td class="num">${i + 1}</td><td class="m">${e(m.title)}</td><td>${e(m.delivers)}</td></tr>`)
        .join("")}</tbody></table>`
    : "";
  const effort = body.effort ? L.hours(body.effort.minHours, body.effort.maxHours) : L.notEstimated;
  const sections = [
    `<section>${h2(L.understanding)}<div class="lead">${paragraphs(body.understanding)}</div></section>`,
    `<section>${h2(L.approach)}${list(body.approach, L.none, false)}</section>`,
    milestones ? `<section>${h2(L.milestones)}${milestones}</section>` : "",
    `<section>${h2(L.timeline)}<div class="facts"><div class="fact"><span class="l">${e(L.effort)}</span><span class="v">${e(effort)}</span></div></div>${body.timeline ? paragraphs(body.timeline) : ""}</section>`,
    `<div class="asks"><section>${h2(L.need)}${list(body.artifacts, L.none, true)}</section><section>${h2(L.questions)}${list(body.questions, L.none, true)}</section></div>`,
  ].join("");
  return `<!doctype html>
<html lang="${e(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${e(`${L.kicker}: ${body.title}`)}</title>
<style>${GIG_PROPOSAL_CSS}</style>
</head>
<body>
<article class="sheet">
<header class="top"><p class="kicker">${e(L.kicker)}</p><h1>${e(body.title)}</h1><p class="date">${e(dateIn(lang, input.generatedAt))}</p></header>
${sections}
<footer class="note"><p>${e(input.disclosure)}</p></footer>
</article>
</body>
</html>
`;
}
