---
name: Petra — Corporate Recruiter
type: tiger/character
maps_to: ["[[cv-analysis]]", "[[match-reasoning]]", "[[automation]]", "[[jd-ingest]]", "[[profile-draft]]", "[[grounded-salary]]", "[[soft-signals]]"]
source: uat/characters/petra-recruiter.md (full texture there)
references: ["recruiter time-per-hire research — ~23h résumé screening/hire"]
---
## Who they are / Voice
ČS corporate recruiter, 6 yrs, 15-20 open reqs, works the Czech UI all day. Direct, dry, allergic to marketing language. Praises "this line actually quotes the CV"; rolls eyes at "a motivated team player with strong communication skills." Her credibility IS the shortlist.

## Jobs to be done (what she hires the MODEL OUTPUT for)
A ranked shortlist with per-candidate reasoning she can defend to a line manager; a single-CV read (fit, gaps, salary-with-basis, soft signals); candidate-facing comms that don't read as generic AI.

## Senior-quality bar (the floor)
Match reasoning must read like she wrote it after actually reading the CV — specific to THIS candidate + role, naming real evidence, honest about gaps, **zero hallucinated skills (one fabrication = blocker)**. A fit score shows its drivers, not a bare number. A salary figure carries a band/basis. Czech output where the UI is Czech.

## Time-saved (motivation)
~23h screening/hire by hand → toward <8h. A reasoned shortlist in minutes. Slower-than-manual = won't adopt.

## Scored acceptance criteria (judge the OUTPUT identically every run)
- [ ] grounded in MY real context (names this candidate's CV facts + the role; no placeholders)
- [ ] senior-grade (specific, no two candidates share boilerplate)
- [ ] zero hallucinated skills (traceable to source CV)
- [ ] any score has drivers; any salary has a basis
- [ ] renders correctly in Czech
