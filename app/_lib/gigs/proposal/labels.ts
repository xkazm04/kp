// The proposal page's fixed words, per language. The proposal FILE is written in the language
// of its message (the listing's own when a model wrote it, English when kp composed it from
// the English brief), so the page's own labels follow it. kp's four locales are covered; any
// other language falls back to English labels around the model's text. These are not UI
// strings (the file never renders inside kp), so they live here, not in messages/*.json.

export type GigProposalLabels = {
  kicker: string;
  understanding: string;
  approach: string;
  milestones: string;
  milestone: string;
  receive: string;
  timeline: string;
  effort: string;
  hours: (min: number, max: number) => string;
  notEstimated: string;
  need: string;
  questions: string;
  none: string;
};

const range = (min: number, max: number) => (min === max ? `${min}` : `${min}-${max}`);

const LABELS: Readonly<Record<string, GigProposalLabels>> = {
  en: {
    kicker: "Proposal",
    understanding: "What you need",
    approach: "How I would approach it",
    milestones: "Milestones",
    milestone: "Milestone",
    receive: "What you receive",
    timeline: "Timeline and effort",
    effort: "Estimated effort",
    hours: (a, b) => `${range(a, b)} hours`,
    notEstimated: "Estimated once the questions below are answered",
    need: "What I need from you",
    questions: "Questions before I start",
    none: "Nothing further for now.",
  },
  cs: {
    kicker: "Nabídka",
    understanding: "Co potřebujete",
    approach: "Jak bych postupoval",
    milestones: "Milníky",
    milestone: "Milník",
    receive: "Co dostanete",
    timeline: "Harmonogram a rozsah",
    effort: "Odhad práce",
    hours: (a, b) => `${range(a, b)} hodin`,
    notEstimated: "Odhad upřesním po zodpovězení otázek níže",
    need: "Co od vás potřebuji",
    questions: "Otázky před zahájením",
    none: "Zatím nic dalšího.",
  },
  de: {
    kicker: "Angebot",
    understanding: "Was Sie brauchen",
    approach: "Wie ich vorgehen würde",
    milestones: "Meilensteine",
    milestone: "Meilenstein",
    receive: "Was Sie erhalten",
    timeline: "Zeitplan und Aufwand",
    effort: "Geschätzter Aufwand",
    hours: (a, b) => `${range(a, b)} Stunden`,
    notEstimated: "Wird geschätzt, sobald die Fragen unten beantwortet sind",
    need: "Was ich von Ihnen brauche",
    questions: "Fragen vor dem Start",
    none: "Vorerst nichts weiter.",
  },
  fr: {
    kicker: "Proposition",
    understanding: "Votre besoin",
    approach: "Mon approche",
    milestones: "Étapes",
    milestone: "Étape",
    receive: "Ce que vous recevez",
    timeline: "Calendrier et charge",
    effort: "Charge estimée",
    hours: (a, b) => `${range(a, b)} heures`,
    notEstimated: "Estimée une fois les questions ci-dessous résolues",
    need: "Ce dont j’ai besoin de votre part",
    questions: "Questions avant de commencer",
    none: "Rien d’autre pour l’instant.",
  },
};

/** The labels for a language code, English when kp has none for it. */
export function proposalLabels(language: string): GigProposalLabels {
  return LABELS[language] ?? LABELS.en;
}
