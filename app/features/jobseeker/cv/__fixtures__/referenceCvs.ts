// The reference CVs the round trip renders (scripts/cv/roundtrip.mjs, cvRoundTrip.ts).
//
// SYNTHETIC PEOPLE ONLY: every name, employer, number and address below is invented for
// this file. Never paste an operator's or a seeker's real CV here.
//
// The set is the one the standard names for a template or layout-engine change
// (registry recruiting/cv-presentation-and-parseability, technique
// export-format-and-round-trip-verification): short, long, career change, non-Latin
// diacritics, two pages. Each is a finished `CvDocument` - the model the sheet renders
// from - so the round trip tests the PRESENTATION, not the builder's reading of a text.

import type { CvDocument, CvRole } from "../cvDocument";

export type ReferenceCv = { id: string; label: string; doc: CvDocument };

const role = (r: string, org: string | null, dates: string | null, bullets: string[], compact = false): CvRole => ({
  role: r,
  org,
  dates,
  compact,
  bullets: bullets.map((text) => ({ lead: null, text, emphasis: [] })),
});

const base = (): Pick<CvDocument, "objective" | "improvements" | "questions"> => ({ objective: null, improvements: [], questions: [] });

const SHORT: CvDocument = {
  ...base(),
  lang: "en",
  market: "en",
  name: "Alex Morgan",
  headline: "Junior Frontend Developer",
  location: "Leeds, UK",
  contacts: [
    { kind: "email", value: "alex.morgan@example.com", href: "mailto:alex.morgan@example.com" },
    { kind: "github", value: "github.com/alexmorgan-dev", href: "https://github.com/alexmorgan-dev" },
  ],
  summary: null,
  experience: [
    role("Frontend Developer", "Brightline Studio", "09/2024 – present", [
      "Built the booking flow of a clinic-scheduling web app in React and TypeScript, used by 14 clinics.",
      "Cut the main bundle from 1.9 MB to 740 kB by splitting routes and removing an unused charting library.",
      "Wrote the component tests the team now runs on every pull request.",
    ]),
    role("Web Development Intern", "Northgate Council", "06/2023 – 08/2023", [
      "Rebuilt the council's bin-collection lookup page to meet WCAG 2.1 AA.",
    ]),
  ],
  projects: [
    role("Open-source contributor", "Vitest", "2024", ["Fixed a watch-mode bug in snapshot handling; the fix shipped in a minor release."]),
  ],
  skills: [
    { title: null, items: [{ name: "TypeScript", level: null }, { name: "React", level: null }, { name: "CSS", level: null }, { name: "Vitest", level: null }, { name: "Git", level: null }] },
  ],
  education: [{ title: "BSc Computer Science", detail: "University of Leeds", dates: "2020 – 2023" }],
  languages: ["English (native)", "Spanish (B1)"],
};

const LONG: CvDocument = {
  ...base(),
  lang: "en",
  market: "en",
  name: "Priya Raman",
  headline: "Principal Platform Engineer",
  location: "Dublin, Ireland",
  contacts: [
    { kind: "email", value: "priya.raman@example.org", href: "mailto:priya.raman@example.org" },
    { kind: "phone", value: "+353 1 555 0142", href: "tel:+35315550142" },
    { kind: "linkedin", value: "linkedin.com/in/priya-raman-example", href: "https://linkedin.com/in/priya-raman-example" },
  ],
  summary:
    "Platform engineer with fourteen years of building the systems other engineers ship on. Led the move of a payments platform from a monolith to 40 services without a customer-facing outage. Looking for a staff or principal role owning developer infrastructure.",
  experience: [
    role("Principal Platform Engineer", "Kestrel Payments", "04/2021 – present", [
      "Own the internal developer platform used by 220 engineers across 31 teams.",
      "Led the migration from a single deployment pipeline to per-service pipelines; median deploy time fell from 48 to 9 minutes.",
      "Designed the service template that 40 services now start from, with tracing, alerts and a runbook built in.",
      "Set up the on-call review that cut repeat incidents by half over four quarters.",
      "Mentor four senior engineers; two have since been promoted to staff.",
    ]),
    role("Staff Engineer", "Kestrel Payments", "01/2018 – 03/2021", [
      "Split the settlement engine out of the monolith behind a strangler proxy, with dual writes verified nightly.",
      "Introduced contract tests between the ledger and its eight consumers.",
      "Chaired the architecture review for payment-path changes.",
    ]),
    role("Senior Software Engineer", "Tidewater Logistics", "06/2014 – 12/2017", [
      "Built the route-planning service that replaced a vendor product, saving the licence fee.",
      "Moved the fleet-tracking ingestion from polling to a message queue handling 3,000 events a second.",
      "Ran the hiring loop for backend engineers for two years.",
    ]),
    role("Software Engineer", "Tidewater Logistics", "09/2011 – 05/2014", [
      "Maintained the warehouse management system in Java and PostgreSQL.",
      "Wrote the first automated integration test suite for the order pipeline.",
    ]),
    role("Junior Developer", "Ashford Media", "07/2010 – 08/2011", [], true),
  ],
  projects: [],
  skills: [
    { title: "Platform", items: [{ name: "Kubernetes", level: "expert" }, { name: "Terraform", level: "expert" }, { name: "Argo CD", level: "advanced" }, { name: "Prometheus", level: "advanced" }] },
    { title: "Languages and runtimes", items: [{ name: "Go", level: "expert" }, { name: "Java", level: "advanced" }, { name: "Python", level: "intermediate" }] },
    { title: "Data", items: [{ name: "PostgreSQL", level: "advanced" }, { name: "Kafka", level: "advanced" }] },
  ],
  education: [{ title: "MSc Distributed Systems", detail: "Trinity College Dublin", dates: "2008 – 2010" }],
  languages: ["English (native)", "Tamil (native)", "Irish (A2)"],
};

const CAREER_CHANGE: CvDocument = {
  ...base(),
  lang: "en",
  market: "en",
  name: "Tomás Herrera",
  headline: "Secondary School Mathematics Teacher",
  objective: "Seeking: Data Analyst roles",
  location: "Bristol, UK",
  contacts: [
    { kind: "email", value: "tomas.herrera@example.net", href: "mailto:tomas.herrera@example.net" },
    { kind: "url", value: "tomasherrera.example.net", href: "https://tomasherrera.example.net" },
  ],
  summary:
    "Mathematics teacher moving into data analysis. For three years I have built the department's assessment dashboards in SQL and Power BI, and I finished a data analytics certificate in 2025.",
  experience: [
    role("Mathematics Teacher", "Hillcrest Academy", "09/2017 – present", [
      "Built the department's assessment dashboard in Power BI from a SQL export of 1,100 pupils' results.",
      "Automated the termly grade moderation report in Python, replacing two days of spreadsheet work.",
      "Teach GCSE and A-level mathematics to five classes a year.",
    ]),
    role("Teaching Assistant", "Brookside Primary School", "09/2015 – 07/2017", [], true),
  ],
  projects: [
    role("Bus punctuality analysis", "Personal project", "2025", [
      "Joined two years of open bus-arrival data with weather records and published the analysis with its code.",
    ]),
    role("Data Analytics Certificate capstone", "Open University", "2025", ["Cleaned and modelled a retail sales dataset; presented the findings to a panel."]),
  ],
  skills: [
    { title: null, items: [{ name: "SQL", level: null }, { name: "Power BI", level: null }, { name: "Python", level: null }, { name: "pandas", level: null }, { name: "Excel", level: null }] },
  ],
  education: [
    { title: "Data Analytics Certificate", detail: "Open University", dates: "2024 – 2025" },
    { title: "PGCE Secondary Mathematics", detail: "University of Bristol", dates: "2016 – 2017" },
  ],
  languages: ["English (C2)", "Spanish (native)"],
};

const CZECH: CvDocument = {
  ...base(),
  lang: "cs",
  market: "cs",
  name: "Jana Nováková",
  headline: "Účetní a finanční analytička",
  location: "Brno",
  contacts: [
    { kind: "email", value: "jana.novakova@example.cz", href: "mailto:jana.novakova@example.cz" },
    { kind: "phone", value: "+420 555 123 456", href: "tel:+420555123456" },
  ],
  summary: "Účetní s osmi lety praxe ve výrobních firmách. Vedu měsíční uzávěrky, připravuji podklady pro audit a zjednodušuji reporting.",
  experience: [
    role("Hlavní účetní", "Žďárské strojírny s.r.o.", "03/2020 – dosud", [
      "Vedu tým tří účetních a měsíční uzávěrku, kterou jsme zkrátili z osmi na pět pracovních dnů.",
      "Připravuji podklady pro roční audit a komunikuji s auditory.",
      "Zavedla jsem párování bankovních výpisů v systému Helios, které ušetří zhruba dva dny měsíčně.",
    ]),
    role("Účetní", "Řeznictví Šťastný a syn", "09/2016 – 02/2020", [
      "Zpracovávala jsem přijaté a vydané faktury, DPH a kontrolní hlášení.",
      "Připravovala jsem mzdové podklady pro 45 zaměstnanců.",
    ]),
  ],
  projects: [],
  skills: [
    { title: "Účetnictví", items: [{ name: "Helios", level: "pokročilá" }, { name: "Pohoda", level: "pokročilá" }, { name: "Excel", level: "pokročilá" }] },
    { title: "Daně", items: [{ name: "DPH", level: null }, { name: "Kontrolní hlášení", level: null }] },
  ],
  education: [{ title: "Ing. Účetnictví a finanční řízení", detail: "Mendelova univerzita v Brně", dates: "2011 – 2016" }],
  languages: ["Čeština (rodilá mluvčí)", "Angličtina (B2)", "Němčina (A2)"],
};

const TWO_PAGES: CvDocument = {
  ...base(),
  lang: "de",
  market: "de",
  name: "Jörg Weißhaupt",
  headline: "Projektleiter Softwareentwicklung",
  location: "Köln",
  contacts: [
    { kind: "email", value: "joerg.weisshaupt@example.de", href: "mailto:joerg.weisshaupt@example.de" },
    { kind: "phone", value: "+49 221 555 0199", href: "tel:+492215550199" },
  ],
  summary:
    "Projektleiter mit neun Jahren Erfahrung in der Entwicklung von Branchensoftware für Versicherungen. Ich führe Teams von fünf bis zwölf Personen und übersetze zwischen Fachbereich und Entwicklung.",
  experience: [
    role("Projektleiter Softwareentwicklung", "Rheinblick Versicherungsdienste GmbH", "01/2021 – heute", [
      "Leite die Neuentwicklung des Schadenportals mit zwölf Entwicklerinnen und Entwicklern in zwei Teams.",
      "Habe die Freigabezyklen von vierteljährlich auf zweiwöchentlich umgestellt.",
      "Verantworte ein Budget von 1,8 Mio. Euro pro Jahr und berichte monatlich an die Geschäftsführung.",
      "Führe die Anforderungsaufnahme mit den Fachabteilungen Kfz, Hausrat und Haftpflicht.",
      "Habe ein gemeinsames Testkonzept mit dem Fachbereich eingeführt; die Fehlerquote nach Freigaben sank um ein Drittel.",
      "Wähle Dienstleister für Barrierefreiheitsprüfungen aus und steuere sie.",
    ]),
    role("Senior Softwareentwickler", "Rheinblick Versicherungsdienste GmbH", "04/2017 – 12/2020", [
      "Entwickelte die Tarifberechnung für Hausratversicherungen in Java und Spring.",
      "Führte Code-Reviews und Pair-Programming im Team ein.",
      "Betreute zwei Auszubildende bis zum Abschluss.",
    ]),
    role("Softwareentwickler", "Düsseldorfer Datenwerk AG", "08/2014 – 03/2017", [
      "Pflegte die Vertragsverwaltung einer Krankenversicherung auf Basis von Java EE und Oracle.",
      "Automatisierte den nächtlichen Datenabgleich mit den Maklerportalen.",
      "Schrieb die Schnittstellenbeschreibung für externe Partner.",
    ]),
    role("Werkstudent Softwareentwicklung", "Düsseldorfer Datenwerk AG", "10/2012 – 07/2014", [
      "Testete die Weboberfläche der Vertragsverwaltung und dokumentierte Fehler.",
      "Schrieb Testskripte für die Tarifrechner der Kfz-Sparte.",
    ]),
    role("IT-Praktikant", "Kölner Stadtwerke Energie GmbH", "03/2011 – 09/2011", [
      "Unterstützte die Umstellung der Zählerablesung auf mobile Geräte.",
      "Pflegte die Stammdaten von rund 4.000 Zählern im SAP-System.",
      "Erstellte Auswertungen zur Ablesequote für die Abteilungsleitung.",
    ]),
  ],
  projects: [
    role("Mitwirkung", "Open-Source-Bibliothek für Versicherungs-Stammdaten", "2019 – 2022", [
      "Beitrag der Prüfregeln für deutsche Bankverbindungen; die Bibliothek wird von mehreren Versicherern genutzt.",
    ]),
  ],
  skills: [
    { title: "Methoden", items: [{ name: "Scrum", level: "sehr gut" }, { name: "Kanban", level: "gut" }, { name: "Anforderungsmanagement", level: "sehr gut" }] },
    { title: "Technik", items: [{ name: "Java", level: "sehr gut" }, { name: "Spring", level: "sehr gut" }, { name: "Oracle", level: "gut" }, { name: "Jira", level: null }] },
  ],
  education: [
    { title: "M.Sc. Wirtschaftsinformatik", detail: "Universität zu Köln", dates: "2012 – 2014" },
    { title: "B.Sc. Informatik", detail: "Hochschule Düsseldorf", dates: "2009 – 2012" },
  ],
  languages: ["Deutsch (Muttersprache)", "Englisch (C1)", "Französisch (B1)"],
};

export const REFERENCE_CVS: ReferenceCv[] = [
  { id: "short", label: "short (early career, one page)", doc: SHORT },
  { id: "long", label: "long (fourteen years)", doc: LONG },
  { id: "career-change", label: "career change (projects lead the evidence)", doc: CAREER_CHANGE },
  { id: "czech", label: "Czech diacritics", doc: CZECH },
  { id: "two-pages", label: "two pages (German)", doc: TWO_PAGES },
];
