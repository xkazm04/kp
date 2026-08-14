"use client";

// Analytics → Performance: "how is hiring actually going".
//
// The prototype round closed on the BRIEFING direction, so the variant switcher
// and the three losing designs (baseline grid, flight deck, scoreboard) are gone
// and this renders the winner directly.
//
// Why Briefing won, in one line: the other three presented numbers and left the
// reading to you; this one takes a position — every band opens with a claim in
// display type and the chart underneath is the evidence for it.
//
// The scoreboard direction was not wasted. Its per-role overview (the sortable
// ranking plus the stacked shape bar) moved to the JD library, where a recruiter
// is already looking at their roles: app/features/library/jds/JdsLedgerRow.tsx +
// the shared app/_components/ui/PipelineShapeBar.tsx.
export { PerformanceBriefing as PerformanceSection } from "./PerformanceBriefing";
