import { redirect } from "next/navigation";

/*
 * The art-direction bake-off is over: Spark won, Signal's product figures
 * were folded into it as feature spotlights, Studio was retired. /landing
 * stays a stable entry point and simply hands over to the surviving variant.
 */
export default function LandingHubPage() {
  redirect("/landing/spark");
}
