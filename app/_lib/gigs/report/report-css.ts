// The gig report's ONE stylesheet (template.ts inlines it into every report file).
//
// LITERAL COLOURS ON PURPOSE. The report is a standalone artifact: a file under the gigs
// root that the operator opens from disk in a browser, and the same bytes GET
// /api/gigs/[id]/report serves inside a CSP sandbox. kp's tokens (app/globals.css,
// [data-theme]) never reach it, so its palette is its own - light, and dark through
// `prefers-color-scheme` - and this file is on the design law's exemption list
// (eslint.config.mjs COLOR_EXEMPT) for exactly that reason. Nothing in app/features reads it.
//
// No external request of any kind: system font stacks only (Charter / Georgia for reading,
// Segoe UI / system-ui for labels, Cascadia / Consolas for code), no @import, no url().
// report.test.ts pins that.
//
// The reading system follows the owner's report bar (the contest skill's
// design-report-craft.md, and the Athena "Two Takes" reference report): a dark numbered
// section rail at the left grouped by topic, a caps eyebrow over a big title, a lead whose
// load-bearing phrase carries a highlighter, stat cards (big numeral, label, quiet caption),
// figures with numbered captions, tables with a dark header row and tinted rows, callouts
// with a coloured left rule, status pills, and a ~70-character reading measure. Nothing is
// set under 14px.

export const GIG_REPORT_CSS = `
:root{
  color-scheme:light dark;
  --paper:#f7f2e8; --paper2:#efe8d9; --card:#fffdf8; --ink:#1d1b18; --ink2:#46423a; --ink3:#5c574d;
  --line:#d8cfbd; --line2:#bfb298;
  --A:#b4501e; --A2:#8f3b12; --Abg:#fbe6d8;
  --B:#1b6b68; --B2:#12514e; --Bbg:#d8eeeb;
  --hl:#fff0b3;
  --nav:#211e1a; --navink:#f0e8d7; --navdim:#b9ae99; --navline:#3a352d; --navhead:#e8b98d; --navon:#33291f; --navbar:#e8853f;
  --ok:#25603a; --okbg:#dcefe0; --okline:#8fc39e;
  --warn:#7a4f00; --warnbg:#fbe9bf; --warnline:#d8aa3a;
  --bad:#8f2626; --badbg:#f6d9d9; --badline:#d99a9a;
  --wait:#274c8a; --waitbg:#dce7f8; --waitline:#9db6e0;
  --th:#2a2620; --think:#f6eedb; --thline:#45403a; --zebra:#faf5ea; --rowhead:#f3ecdc;
  --codebg:#ece3cf; --codeink:#3b2a10;
  --body:Charter,"Bitstream Charter","Sitka Text",Cambria,Georgia,serif;
  --ui:"Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,Roboto,"Helvetica Neue",sans-serif;
  --mono:"Cascadia Mono","Cascadia Code",Consolas,"SF Mono",Menlo,monospace;
}
@media (prefers-color-scheme: dark){
  :root{
    --paper:#1a1815; --paper2:#221f1b; --card:#23201c; --ink:#efe8da; --ink2:#cfc6b4; --ink3:#a89e8b;
    --line:#39342c; --line2:#4f473b;
    --A:#e58a52; --A2:#f2a773; --Abg:#3a2418;
    --B:#5fb8b2; --B2:#86d3cd; --Bbg:#16302e;
    --hl:#5c4b0f;
    --nav:#11100e; --navink:#eee6d5; --navdim:#aa9f8a; --navline:#2e2a24; --navhead:#e8b98d; --navon:#2b231a; --navbar:#e8853f;
    --ok:#86d49e; --okbg:#173322; --okline:#2f6a44;
    --warn:#ecc566; --warnbg:#382c0e; --warnline:#7a5f1c;
    --bad:#f2a0a0; --badbg:#3b1b1b; --badline:#7c3a3a;
    --wait:#a9c3f0; --waitbg:#1b2740; --waitline:#3b5486;
    --th:#0f0e0c; --think:#f3ead6; --thline:#2c2822; --zebra:#26231e; --rowhead:#2b2721;
    --codebg:#2f2a22; --codeink:#f2dcb8;
  }
}
*{box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:20px}
body{margin:0;background:var(--paper);color:var(--ink);font:17.5px/1.7 var(--body);display:grid;grid-template-columns:300px minmax(0,1fr);min-height:100vh}
a{color:var(--B2);text-decoration-thickness:1px;text-underline-offset:3px}
a:hover{color:var(--A2)}
a:focus-visible{outline:3px solid var(--A);outline-offset:2px;border-radius:4px}

/* ---------- the section rail ---------- */
nav.rail{position:sticky;top:0;height:100vh;overflow-y:auto;background:var(--nav);color:var(--navink);padding:22px 18px 40px;font:15px/1.35 var(--ui)}
nav.rail .brand{font:700 21px/1.2 var(--body);color:var(--navink);margin:0 0 4px}
nav.rail .brand small{display:block;font:500 14px/1.4 var(--ui);color:var(--navdim);margin-top:6px;letter-spacing:.02em}
nav.rail h2{font:700 14px var(--ui);letter-spacing:.12em;text-transform:uppercase;color:var(--navhead);margin:20px 0 6px;padding-top:14px;border-top:1px solid var(--navline)}
nav.rail a{display:block;color:var(--navink);text-decoration:none;padding:6px 10px;border-radius:7px;border-left:3px solid transparent}
nav.rail a:hover{background:var(--navon)}
nav.rail a b{color:var(--navdim);font-weight:600;margin-right:6px;font-variant-numeric:tabular-nums}
nav.rail ol.stages{list-style:none;margin:18px 0 0;padding:0;display:grid;gap:4px}
nav.rail ol.stages li{display:flex;align-items:center;gap:8px;color:var(--navdim);font-size:14px}
nav.rail ol.stages li::before{content:"";width:10px;height:10px;border-radius:999px;border:2px solid var(--navdim);flex:none}
nav.rail ol.stages li.done{color:var(--navink)}
nav.rail ol.stages li.done::before{background:var(--navdim)}
nav.rail ol.stages li.now{color:var(--navink);font-weight:700}
nav.rail ol.stages li.now::before{background:var(--navbar);border-color:var(--navbar)}

/* ---------- the main column ---------- */
main{padding:0 clamp(20px,4vw,64px) 120px;min-width:0;counter-reset:fig}
.wrap{max-width:960px;margin:0 auto}
h1,h2,h3{font-family:var(--ui);color:var(--ink);line-height:1.2}
h1{font-size:clamp(32px,4.4vw,50px);font-weight:800;letter-spacing:-.02em;margin:.2em 0 .3em}
h2{font-size:30px;font-weight:750;letter-spacing:-.01em;margin:0 0 .4em}
h2 .num{color:var(--A);font-variant-numeric:tabular-nums;margin-right:.35em}
h3{font-size:21px;margin:1.6em 0 .45em;font-weight:700}
p{margin:.7em 0;max-width:44em}
ul,ol{padding-left:1.3em;max-width:44em}
li{margin:.3em 0}
li::marker{color:var(--A)}
strong{font-weight:700}
em{font-style:italic}
code{font:15px var(--mono);background:var(--codebg);color:var(--codeink);padding:.08em .38em;border-radius:5px;overflow-wrap:anywhere}
mark{background:linear-gradient(transparent 55%,var(--hl) 55%);color:inherit;padding:0 .1em}
section{padding-top:52px}
section+section{border-top:1px solid var(--line);margin-top:52px}
section>p:first-of-type{font-size:19px;color:var(--ink2)}

/* ---------- the hero ---------- */
.hero{padding-top:44px}
.kicker{font:700 14px var(--ui);letter-spacing:.14em;text-transform:uppercase;color:var(--A2);margin:0}
.claim{font:700 clamp(23px,2.8vw,31px)/1.32 var(--body);margin:.25em 0 .5em;max-width:28em;color:var(--ink)}
.meta{font:15px/1.5 var(--ui);color:var(--ink3);margin:0 0 8px;max-width:none}
.meta span+span::before{content:" \\00b7  ";color:var(--line2)}

/* ---------- stat cards ---------- */
.stat-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin:24px 0 10px;max-width:none}
.stat{background:var(--card);border:1.5px solid var(--line2);border-radius:14px;padding:16px 18px}
.stat .n{display:block;font:800 36px/1.05 var(--ui);color:var(--A2);letter-spacing:-.02em;overflow-wrap:anywhere}
.stat .l{display:block;margin-top:8px;font:600 15.5px/1.4 var(--ui);color:var(--ink)}
.stat .c{display:block;margin-top:6px;font:500 14px/1.4 var(--ui);color:var(--ink3)}

/* ---------- figures and tables ---------- */
figure{margin:28px -12px;padding:12px 12px 8px;background:var(--card);border:1.5px solid var(--line2);border-radius:16px}
figure>*:first-child{margin-top:0}
figure figcaption{font:500 15px/1.5 var(--ui);color:var(--ink2);padding:10px 8px 4px;counter-increment:fig}
figure figcaption::before{content:"Figure " counter(fig) " \\2014  ";font-weight:700;color:var(--ink)}
figure figcaption strong{color:var(--ink)}
figure .tbl{margin:0;border:0;border-radius:10px}
.tbl{overflow-x:auto;margin:22px 0;border-radius:12px;border:1.5px solid var(--line2);background:var(--card)}
table{border-collapse:collapse;width:100%;font:15px/1.45 var(--ui);min-width:560px}
th{background:var(--th);color:var(--think);text-align:left;padding:10px 12px;font-weight:700;font-size:14.5px;letter-spacing:.02em;border-right:1px solid var(--thline);vertical-align:bottom}
th:last-child{border-right:0}
td{padding:10px 12px;border-top:1px solid var(--line);vertical-align:top}
tbody tr:nth-child(even) td{background:var(--zebra)}
tbody td:first-child,tbody th{font-weight:700;background:var(--rowhead)}
tbody th{color:var(--ink);font-size:15px;letter-spacing:0;vertical-align:top;border-right:0;border-top:1px solid var(--line)}
table p{margin:.2em 0}
table ul,table ol{margin:.2em 0;padding-left:1.1em}

/* ---------- callouts and claims ---------- */
blockquote{margin:30px 0;padding:20px 24px 20px 28px;background:var(--hl);border-left:8px solid var(--A);border-radius:0 14px 14px 0;font:600 21px/1.45 var(--body);color:var(--ink);max-width:none}
blockquote p{margin:.3em 0}
.callout{margin:22px 0;padding:14px 18px;border-radius:0 12px 12px 0;border-left:6px solid var(--line2);background:var(--card);font-size:16.5px;max-width:none}
.callout>strong:first-child{display:block;font:700 14px var(--ui);letter-spacing:.1em;text-transform:uppercase;margin-bottom:2px;color:var(--ink2)}
.callout.warn{background:var(--warnbg);border-left-color:var(--warnline)}
.callout.warn>strong:first-child{color:var(--warn)}
.callout.ok{background:var(--okbg);border-left-color:var(--okline)}
.callout.ok>strong:first-child{color:var(--ok)}
.callout p{margin:.3em 0}

/* ---------- pills ---------- */
.pill{display:inline-block;font:700 14px/1 var(--ui);letter-spacing:.04em;text-transform:uppercase;padding:4px 9px 4px 8px;border-radius:999px;border:1.5px solid var(--line2);vertical-align:.1em;white-space:nowrap;background:var(--paper2);color:var(--ink2)}
.pill.ok{background:var(--okbg);color:var(--ok);border-color:var(--okline)}
.pill.ok::before{content:"\\2713\\00a0"}
.pill.fail{background:var(--badbg);color:var(--bad);border-color:var(--badline)}
.pill.fail::before{content:"\\2715\\00a0"}
.pill.wait{background:var(--waitbg);color:var(--wait);border-color:var(--waitline)}
.pill.wait::before{content:"\\2026\\00a0"}

/* ---------- provenance ---------- */
footer.prov{margin-top:64px;padding-top:22px;border-top:2px solid var(--ink);font:15px/1.6 var(--ui);color:var(--ink2)}
footer.prov p{max-width:none;margin:.35em 0}
footer.prov code{font-size:14px}

@media (max-width:1020px){
  body{grid-template-columns:1fr}
  nav.rail{position:relative;height:auto;padding:18px 16px 16px}
  nav.rail ol.stages{display:flex;flex-wrap:wrap;gap:6px 14px}
  nav.rail h2{display:none}
  nav.rail .groups{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:2px 8px;margin-top:14px;padding-top:12px;border-top:1px solid var(--navline)}
  figure{margin-left:0;margin-right:0}
}
@media print{
  nav.rail{display:none}
  body{display:block;background:#fff;color:#000;font-size:12pt}
  main{padding:0}
  section{break-inside:auto}
  figure,.stat,.callout,blockquote,tr{break-inside:avoid}
  a{color:inherit}
}
`;
