import { Bricolage_Grotesque, Gabarito, Shantell_Sans } from "next/font/google";
import MarketPulseApp from "./market/MarketPulseApp";
import { TYPE_SCALE } from "./tokens";

/*
 * The public /market "Market Pulse" page wrapped in Spark's scoped type system —
 * the same fonts and the same larger TYPE_SCALE SparkHome/AboutHome load, so
 * /market reads as a sibling of the home landing and /about. Its data cards
 * take the extra ART_TYPE_SCALE notch inside `market/parts.tsx`. Kept in this folder (the docs/design/README.md art-direction
 * exemption) so the literal-hex marketing components stay together; the /market
 * route is a thin shell that just renders this.
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

export default function MarketPulse() {
  return (
    <div className={`${TYPE_SCALE} ${display.variable} ${body.variable} ${hand.variable}`}>
      <MarketPulseApp />
    </div>
  );
}
