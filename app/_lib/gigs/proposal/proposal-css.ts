// The client proposal's ONE stylesheet (template.ts inlines it into every proposal file).
//
// LITERAL COLOURS ON PURPOSE, like the gig report's (report/report-css.ts): the proposal is a
// standalone file the operator attaches to a bid or prints to PDF, so kp's tokens never reach
// it - it is on the design law's exemption list (eslint.config.mjs COLOR_EXEMPT) for exactly
// that reason. LIGHT ONLY: it is a document for a client, printed more often than read on a
// screen. System font stacks, no @import, no url(), no external request of any kind.
//
// Print is a first-class target: A4 with @page margins, a milestone row or an ask never
// splits across pages, headings keep their first line, and any link prints its address.
// Nothing is set under 14px on screen (11pt in print). The CSS text itself must never
// name the tool that wrote the file (proposal.test.ts reads it).

export const GIG_PROPOSAL_CSS = `
:root{
  --paper:#ffffff; --ink:#1b1a17; --ink2:#44403a; --ink3:#6a655b; --line:#ddd6c8; --soft:#f6f2ea;
  --accent:#9a3f14; --accent2:#1f5f5b; --th:#2a2620; --think:#f6eedb;
  --body:Charter,"Bitstream Charter","Sitka Text",Cambria,Georgia,serif;
  --ui:"Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,Roboto,"Helvetica Neue",sans-serif;
}
*{box-sizing:border-box}
html{color-scheme:light}
body{margin:0;background:#efebe3;color:var(--ink);font:17px/1.65 var(--body)}
.sheet{max-width:820px;margin:32px auto;background:var(--paper);padding:56px 64px 40px;border-radius:6px;box-shadow:0 1px 2px #0000001f,0 12px 40px #0000000f}
header.top{border-bottom:3px solid var(--ink);padding-bottom:18px;margin-bottom:8px}
.kicker{font:700 14px var(--ui);letter-spacing:.16em;text-transform:uppercase;color:var(--accent);margin:0}
h1{font:800 34px/1.18 var(--ui);letter-spacing:-.01em;margin:.3em 0 .25em}
.date{font:500 15px var(--ui);color:var(--ink3);margin:0}
h2{font:750 21px/1.25 var(--ui);margin:34px 0 10px;padding-top:6px;break-after:avoid}
h2 .n{color:var(--accent);margin-right:.4em;font-variant-numeric:tabular-nums}
p{margin:.55em 0}
.lead{font-size:19px;color:var(--ink2)}
ul,ol{padding-left:1.25em;margin:.4em 0}
li{margin:.35em 0;break-inside:avoid}
li::marker{color:var(--accent)}
table{width:100%;border-collapse:collapse;font:15.5px/1.5 var(--ui);margin:10px 0}
th{background:var(--th);color:var(--think);text-align:left;padding:9px 12px;font-weight:700;font-size:14.5px}
td{padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:top}
td.num{width:3em;color:var(--accent);font-weight:700;font-variant-numeric:tabular-nums}
td.m{font-weight:650;width:38%}
tr{break-inside:avoid}
thead{display:table-header-group}
.facts{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px;margin:12px 0}
.fact{background:var(--soft);border-left:4px solid var(--accent2);padding:12px 16px;border-radius:0 8px 8px 0;break-inside:avoid}
.fact .l{display:block;font:700 14px var(--ui);letter-spacing:.08em;text-transform:uppercase;color:var(--ink3)}
.fact .v{display:block;font:700 20px/1.3 var(--ui);color:var(--ink);margin-top:4px}
.asks{display:grid;grid-template-columns:1fr 1fr;gap:28px}
.asks ol{padding-left:1.4em}
footer.note{margin-top:44px;padding-top:14px;border-top:1px solid var(--line);font:14px/1.55 var(--ui);color:var(--ink3)}
@media (max-width:720px){
  .sheet{margin:0;padding:28px 20px;border-radius:0;box-shadow:none}
  .asks{grid-template-columns:1fr}
  td.m{width:auto}
}
@page{size:A4;margin:18mm 16mm 20mm}
@media print{
  body{background:#fff;font-size:11pt}
  .sheet{max-width:none;margin:0;padding:0;box-shadow:none;border-radius:0}
  h1{font-size:22pt}
  h2{font-size:14pt;margin-top:20pt}
  .lead{font-size:12pt}
  table{font-size:10.5pt}
  .asks{grid-template-columns:1fr 1fr}
  a[href]::after{content:" (" attr(href) ")";font-size:9.5pt;color:var(--ink3)}
  section,.facts{break-inside:auto}
}
`;
