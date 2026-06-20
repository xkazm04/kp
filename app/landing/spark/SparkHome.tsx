import { Bricolage_Grotesque, Gabarito, Shantell_Sans } from "next/font/google";
import SparkLanding from "./SparkLanding";

/*
 * Spark landing + its scoped type system. The fonts load here (not in the route
 * page) so the same wrapper can be reused both at /landing/spark and as the
 * signed-out homepage slot ('/', via app/page.tsx → HomeGate). The font
 * variables are scoped to this subtree so the workspace fonts stay untouched:
 * Bricolage for display punch, Gabarito for friendly body text, Shantell for
 * the hand-drawn margin notes.
 */
const display = Bricolage_Grotesque({
  subsets: ["latin", "latin-ext"],
  variable: "--font-spark-display",
  display: "swap"
});

const body = Gabarito({
  subsets: ["latin", "latin-ext"],
  variable: "--font-spark-body",
  display: "swap"
});

const hand = Shantell_Sans({
  subsets: ["latin", "latin-ext"],
  variable: "--font-spark-hand",
  weight: ["400", "500"],
  display: "swap"
});

export default function SparkHome() {
  return (
    <div className={`${display.variable} ${body.variable} ${hand.variable}`}>
      <SparkLanding />
    </div>
  );
}
