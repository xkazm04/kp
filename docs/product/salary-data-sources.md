# Salary data — approach and Czech sources

## Data approach

`data/salary_benchmarks.json` carries role × seniority anchor bands per family
(`software_engineering`, `data_ai`, `product_project`). The deterministic pre-pass
([../architecture/README.md](../architecture/README.md) → Analysis pipeline stages)
looks up the band that matches the candidate's detected role family + seniority and
feeds it into the Gemini prompt as the *primary* salary anchor; Gemini may adjust
±20% with stronger evidence. `data/taxonomy.json` (151 terms, 8 salary signals, 5
company types, 3 modifiers) drives skill matching, role classification, education
detection, seniority signals, and the company-type multiplier (capped at 1.20×). Both
files are editable without changing the API/UI contract.

The bibliography below is what those bands, signals and multipliers were calibrated
against. Figures are as published at the time of reading; each entry says what it was
used for.

## Czech salary data (job-board aggregates)

- [Platy.cz — Information Technology category](https://www.platy.cz/en/salaryinfo/information-technology) — backend 49–136k, frontend 45–115k, iOS 75–181k, Android 65–150k, DevOps 62–155k, QA manual 38–83k, QA automation 46–107k, security analyst 48–129k, data scientist 56–123k, BI analyst 51–114k, product manager 61–164k. Average IT 81,634 CZK. Used to validate role bands and to size the DevOps/security/mobile salary signals.
- [Platy.cz — Public administration / self-governance](https://www.platy.cz/en/salaryinfo/public-administration-self-governance) — public-admin 80% earn 29.8–65.0k CZK, average 46k. Used to recalibrate the `public sector` company-adjustment factor down from 0.86 to 0.80.
- [Levels.fyi — Software Engineer, Czech Republic](https://www.levels.fyi/t/software-engineer/locations/czech-republic) — average SWE TC 1,480,987 CZK/yr, range 1.1–1.87M; Prague +29% vs CZ average. Cross-check on Platy.cz bands.
- [Glassdoor — Senior Software Engineer, Prague](https://www.glassdoor.com/Salaries/prague-senior-software-engineer-salary-SRCH_IL.0,6_IM989_KO7,31.htm) — senior SWE 1.48–2.19M CZK/yr; junior 740k–1.2M; mid 1.2–1.7M. Cross-check.

## Czech salary guides (recruitment agencies)

- [Hays Czech Republic salary guide](https://www.hays.cz/en/salary-guide) — confirms top in-demand IT skills (cloud, cybersecurity, software development); raw numbers gated. Used as directional context.
- [Grafton Recruitment CZ Salary Guide 2025](https://www.grafton.cz/en/employers/survey-zone/salary-guide-2025) — 11th edition, 350 positions × 8 sectors. Landing page only.
- [Reed Czech Republic 2026 Salary Guide](https://www.reedglobal.cz/en/resources/salary-guide) — landing page only.
- [Cpl CEE 2025 Salary Guide announcement](https://www.cz.cpl.com/en/blog/2025/02/cee-salary-guide-2025-new-report) — covers IT & Tech across CZ/SK/PL. Landing page only.

## Market analyses + premium sizing

- [Kitalent — Prague ICT multinational wage war](https://kitalent.com/article-prague-ict-multinational-wage-war) — senior SWE 100–150k, principal/architect 150–200k, VP Engineering 220–350k, CISO 200–400k; multinational base premium 30–40% vs scaleups; cybersecurity mover premia 25–35%; AI/ML salary inflation 10–12% annual through 2026 vs 6–8% general ICT. Source for `enterprise/corporate` factor revision and for the new `security` salary signal.
- [Nucamp — Top 10 high-paying tech jobs in Czech Republic 2025](https://www.nucamp.co/blog/coding-bootcamp-czech-republic-cze-ranking-the-top-10-highpaying-tech-jobs-in-czech-republic-in-2025) — Data Scientist 650k–1.5M/yr, AI 1.1–2M/yr, ML 850k–1.5M/yr, Cloud up to 1.6M/yr, Cyber 800k–1.5M/yr; AI/ML +20–30% premium; Prague +25% over national. Used to validate `ai`, `cloud`, `security` signals.
- [Nucamp — Most in-demand tech jobs in Czech Republic 2025](https://www.nucamp.co/blog/coding-bootcamp-czech-republic-cze-most-in-demand-tech-job-in-czech-republic-in-2025) — top demand for Python, Java, JS, cloud, cybersecurity, data; 18% market growth for software developer roles; 63% of CZ IT firms struggling to hire. Source for the broad skills additions.
- [MV People Group — European Cybersecurity Salary Guide 2026](https://www.mvpeoplegroup.com/en/insights/cybersecurity-salary-guide-europe-2026) — NIS2/DORA experts EUR 70–107k; CISO EUR 120–197k. Used to add the `security` salary signal and `regulated_industry` modifier.

## Czech press + statistics

- [Expats.cz — Salary leaders: Czechia's best-paying industries and locations](https://www.expats.cz/czech-news/article/salary-leaders-czechia-s-best-paying-industries-and-locations) — private sector growth 7.9% vs public 3.4%; Prague avg 63,106; senior comp tech Prague 90,207 vs Vysočina 64,111; 2025 outlook 5.5–6%.
- [Expats.cz — IT roles offering a good start](https://www.expats.cz/czech-news/article/it-roles-that-offer-good-start-to-career-and-salary) — entry-level IT: security 75k/mo, dev/data 62.5k/mo, PM coordinator 50k/mo. Confirms the startup-vs-large-company entry gap and informs the `startup` factor.
- [Expats.cz — Czech salary guide vs national average](https://www.expats.cz/czech-news/article/czech-salary-guide-do-you-earn-more-than-the-national-average-for-your-industry) — IT industry average ~74k CZK (highest of all industries); backend >80k, top-decile >115k. Cross-check.

## Regulation (drives `regulated_industry` and `security` signals)

- [ICLG — Cybersecurity Laws and Regulations: Czech Republic 2026](https://iclg.com/practice-areas/cybersecurity-laws-and-regulations/czech-republic) — Czech New Cybersecurity Act effective 1 Nov 2025 (NIS2 transposition); DORA from 17 Jan 2025; penalties to CZK 250M.
- [Cybersecurity Hub CZ — NIS2 Ready](https://www.cybersecurityhub.cz/en/opportunities/nis2ready) and [Deloitte CZ — NIS2 directive and the new Cybersecurity Act](https://www.deloitte.com/cz-sk/en/services/consulting/services/nis2-directive-and-the-new-cybersecurity-act.html) — implementation context for the compliance-related salary lift.

## Czech vocabulary + education titles

- [Coderslab — Junior, medior, senior in Czech IT](https://coderslab.cz/cz/blog/jak-se-lisi-junior-medior-senior) — confirms `samostatně` (independently) as the canonical medior signifier. Junior = nováček; senior = 5+ years.
- [Czechitas — Overview of basic IT positions](https://www.czechitas.cz/blog/prehled-zakladnich-it-pozic-s-czechitas) — Czech IT job-title vocabulary: programátor, vývojář, architekt, tester, analytik, datový analytik, projektový/produktový manažer, databázový inženýr, administrátor, konzultant, technická podpora.
- [CzechUniversities — Academic title spelling](https://www.czechuniversities.com/article/list-of-academic-titles-and-their-correct-spelling) — canonical CZ academic titles: Bc., BcA., Mgr., MgA., Ing., Ing. arch., MBA, Ph.D., JUDr., RNDr., MUDr., MVDr., MDDr., PharmDr., DrSc.

## Consulting / Big-4 references (for `agency/consultancy` factor)

- [Salary.com — Deloitte Czech Republic Consultant](https://www.salary.com/research/company/deloitte-czech-republic/consultant-salary) — Deloitte CZ consultant 44–58k/mo. Used to lower the `agency/consultancy` factor from 1.02 to 1.00.

## Sources attempted but gated or unavailable

Hays CZ 2026 PDF, Grafton 2025 PDF, Reed 2026 PDF, Cpl CEE 2025 PDF — all behind
download forms; landing pages only. Robert Half does not publish a CZ-specific guide
for 2025/2026; their CEE coverage rolls into Manpower/Hays. ČSÚ wage tables were
referenced only via Nucamp's summary citing the 18% software-developer growth figure.
