import type { Metadata } from "next";

/*
 * /landing — the marketing face for the "KandiDate" rebrand (the Spark
 * direction; the Signal and Studio prototypes were retired after the
 * bake-off). Deliberately unlinked from the workspace at '/' and noindexed
 * until launch. The layout only contributes metadata so the page stays free
 * to own its full canvas.
 */
export const metadata: Metadata = {
  title: { default: "KandiDate", template: "%s — KandiDate" },
  description:
    "KandiDate — AI for hiring that keeps humans in charge. Screen, interview, schedule and decide, with a person signing every call.",
  robots: { index: false, follow: false }
};

export default function LandingLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
