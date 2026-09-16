import { getTranslations } from "next-intl/server";
import { PANEL } from "@/app/_components/ui/recipes";

// WP0 placeholder: the profile & CV studio page lands in WP2. Kept as a server
// component so the layout's gate is the only gate and nothing renders client-side
// before the profile store exists.
export default async function MeHomePage() {
  const t = await getTranslations("me");
  return (
    <section className={`${PANEL} p-6`}>
      <h1 className="text-xl font-semibold text-ink">{t("title")}</h1>
      <p className="mt-2 text-sm text-steel">{t("placeholder")}</p>
    </section>
  );
}
