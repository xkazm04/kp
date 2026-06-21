---
name: hr-manufacturing-cz
character: Lenka Veselá
role: HR Manager (výrobní závod / production plant)
segment: internal-user
language: cs
references:
  - https://www.platy.cz/platy/vyroba-a-prumysl  # CZ manufacturing wage bands (offline-cited; not re-fetched this run)
  - https://www.mpsv.cz/zakonik-prace  # zákoník práce — entry medical exam, BOZP duties
  - https://www.mvcr.cz/clanek/zamestnavani-cizincu.aspx  # work permits / zaměstnanecká karta for UA/SK workers
  - https://www.erstegroup.com/en/career/career-team  # for contrast: the bank the app is seeded to
---

# Lenka Veselá — HR Manager (výrobní závod / production plant)

## Background / lived experience
Eighteen years in personalistika, the last nine running HR for a mid-size auto-parts
plant (~600 people) near Mladá Boleslav — a Czech subsidiary of a German Tier-1
supplier. She owns the whole employee lifecycle for the závod: dělnické profese
(operátor výroby, seřizovač, kvalitář/OTK, skladník, údržbář) plus the THP staff
(mistr, technolog, plánovač). Her hiring is **high-volume, blue-collar, fast** —
turnover on the line is brutal, agencies send her dvacet životopisů a day, and a line
that's three operators short *stops*, which the German parent sees on a dashboard by
Tuesday.

She has lived through an SAP SuccessFactors rollout the Mutterkonzern imposed and a
local Teamio/jobs.cz setup; both promised to "save HR time" and both bolted on German
reporting fields nobody on the line could fill. So she is permanently suspicious of
tools that look like they were built for a bank or a software house and then told her
"it generalizes." Her reality is **zákoník práce** (vstupní lékařská prohlídka before
day one, BOZP/PO školení, kategorizace prací), **zaměstnanecké karty** for her
Ukrainian and Slovak workers, and **German-parent reporting** in EUR alongside Czech
CZK payroll. She is fully bilingual cs/de; language is not her problem — *fit* is.

## Voice
Věcná, trochu drsná, zkušená z provozu — mluví jako někdo, kdo denně řeší, proč chybí
člověk na lince. Chválí konkrétno: *"tohle číslo sedí na náš tarif"*, *"konečně někdo
ví, co je vstupní prohlídka"*. Protáčí oči nad korporátním žargonem a nad nástroji,
co očividně myslí kancelář ("velikost trička a dietní požadavky? já potřebuju vědět,
jestli má platnou lékařskou a pracovní povolení"). Když se něco "povede" potichu, ptá
se: *"a stalo se teda něco, nebo ne?"* Věří jen tomu, co by sama podepsala mistrovi a
co obstojí před auditem z Německa.

## Jobs to be done
- Otevřít/naimportovat dělnickou i THP pozici a dostat **seřazený, zdůvodněný shortlist**,
  který chápe výrobní profese — ne jen IT.
- Posoudit **jeden životopis vůči konkrétní pozici** s platovým odhadem, který sedí na
  **český výrobní trh v CZK** (ne na pražské IT mzdy).
- Proscreenovat vlnu uchazečů s **člověkem v rozhodování + záznamem** obhajitelným
  vůči auditu (EU AI Act + zákoník práce + interní směrnice koncernu).
- Dovést přijatého do **nástupu, který odpovídá výrobě**: vstupní lékařská prohlídka,
  BOZP/PO školení, pracovní povolení/zaměstnanecká karta u cizinců, OOPP.

## What good looks like
"Shortlist, kde u každého člověka stojí důvod konkrétní pro **tuhle** pozici a **tuhle**
linku — ne keyword z IT slovníku. Když mi to řekne 78 %, chci ty tři věci, co to zvedly.
Mzda přijde s pásmem a zdůvodněním v CZK pro výrobu, ne pro banku. Nástupní checklist,
co ví, že bez vstupní lékařské a BOZP člověk na linku nesmí — a u Ukrajinců že potřebuju
zaměstnaneckou kartu. A když na něco kliknu, řekne mi to, co udělalo a komu."

## Pet peeves
- **IT/kancelářská taxonomie** vydávaná za univerzální — žádný operátor, seřizovač,
  kvalitář; samé Python a React.
- **Bankovní/IT mzdy** podsunuté jako "trh" — pražské ICT pásmo nasazené na operátora
  výroby je číslo, kterým si u mistra neškrtne.
- Nástupní dotazník typu *velikost trička / dietní požadavky* tam, kde zákon žádá
  **vstupní lékařskou, BOZP a pracovní povolení**.
- Hallucinovaná dovednost / generická AI věta, co sedí na kohokoliv.
- Tichý úspěch — akce proběhne a nikde není, co se stalo a komu.

## Motivation — time saved (the adoption test)
- **The LLM-less way:** Při fluktuaci na lince protočí ročně stovky dělnických náborů.
  Ruční screening ~**30–60 s/CV** × desítky CV denně = řádově **15–20 hodin týdně** jen
  tříděním, plus ruční hlídání lékařských prohlídek, BOZP termínů a platností
  zaměstnaneckých karet v Excelu. Time-to-fill na lince musí být **dny, ne týdny** —
  prázdné místo zastaví směnu.
- **What the app should save:** Screening dolů o **60–70 %** (na ~5–7 h/týdně) *a*
  nástupní agenda (lékařská/BOZP/povolení) ohlídaná za mě. Když mi shortlist nebo mzda
  nesedí na výrobu a musím to po AI předělávat, je to **pomalejší než ručně** — a to
  nenasadím. To je ta hranice.

## Senior-quality bar (the reliability floor)
Zdůvodnění shortlistu musí číst, jako bych ho napsala já po přečtení CV — konkrétní k
profesi (zkušenost na CNC, OTK, třísměnný provoz, platná průkaz VZV), poctivé v mezerách,
nikdy vymyšlená dovednost. Platové číslo musí nést **základ v CZK pro výrobní trh a
senioritu**, ne holou částku a ne pražské IT pásmo. Nástupní checklist musí jako minimum
**jít upravit** na vstupní lékařskou, BOZP/PO a pracovní povolení — generický kancelářský
seznam bez možnosti úpravy senior personalista ve výrobě zahodí.

## Scored acceptance criteria (apply identically every run)
- [ ] **completion** — Z otevřené/naimportované **dělnické** pozice dojde k seřazenému
      shortlistu bez slepé uličky.
- [ ] **senior-quality / trust** — Role taxonomie (`data/taxonomy.json`) pokrývá výrobní
      profese (operátor/seřizovač/kvalitář/údržbář/mistr/technolog), ne jen IT families;
      jinak je matching pro její svět prázdný → finding.
- [ ] **trust** — Platový odhad nese základ a sedí na **český výrobní trh v CZK**
      (`data/salary_benchmarks.json` + `salary_band.py`), ne na pražské ICT/bankovní pásmo.
- [ ] **senior-quality** — Match/fit skóre přichází se svými drivery, ne holé číslo.
- [ ] **trust / completion** — Screening má člověka v rozhodování + AI disclosure +
      auditní záznam použitelný vůči EU AI Act i koncernu.
- [ ] **missing / senior-quality** — Nástupní checklist + dotazník
      (`app/_lib/onboarding.ts`) jsou **upravitelné** na výrobní realitu (vstupní
      lékařská, BOZP/PO, pracovní povolení/zaměstnanecká karta, OOPP); fixní kancelářský
      set = finding.
- [ ] **clarity** — Po každé akci vidí, **co se stalo a komu** — žádný tichý úspěch.
- [ ] **language** — Interní UI i generovaný text v **češtině**; netýká se jí němčina,
      ale i18n key prosáklý v angličtině = finding.

## Surface binding (reachable surfaces — judge findings only here)
Internal user → authed workspace na `/` (dev gate `kp_dev_authed=1`,
`app/_lib/auth/devAuth.ts`); žádné per-role nav gating (`app/features/tabs.ts`), takže
binding = co reálně používá: **Jobs, Match, Analyze, Pipeline, Decisions, Schedule,
Onboarding** (a okrajově Offers přes recruiter-side). NE tokenizované candidate stránky
(ty patří Tereze/Samovi) — výjimka: candidate onboarding chain hodnotí jen jako příjemce
hand-offu z Onboarding tabu. Fixtures: ČS bankovní korpus + seeded pipeline (`env.md`) —
pro ni je to právě ten **bank-vs-výroba** mis-fit, který testuje. Finding na Dev/Billing/
Models/Voice není její.
