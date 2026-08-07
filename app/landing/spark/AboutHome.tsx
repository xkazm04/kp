import { Bricolage_Grotesque, Gabarito, Shantell_Sans } from "next/font/google";
import AboutCurve from "./AboutCurve";
import { TYPE_SCALE } from "./tokens";

/*
 * The public /about marketing page wrapped in Spark's scoped type system — the
 * same fonts and the same larger TYPE_SCALE SparkHome loads, so /about reads as
 * a sibling of the home landing.
 * Kept in this folder (the docs/design/README.md art-direction exemption) so the
 * literal-hex marketing components stay together; the /about route is a thin
 * shell that just renders this.
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

export default function AboutHome() {
  return (
    <div className={`${TYPE_SCALE} ${display.variable} ${body.variable} ${hand.variable}`}>
      <AboutCurve />
    </div>
  );
}
