import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { railTile } from "@/app/_components/ui/recipes";

/*
 * The rail's door to the control room, in the same icon-over-label shape as the
 * feedback and search tiles beside it. Rendered only through controlRoomDoor(), which
 * hands it an href for an operator and nothing for anyone else; it holds no gate itself.
 */
export function NavControlLink({ href }: { href: string }) {
  const t = useTranslations("nav");
  return (
    <Link href={href} title={t("controlRoom")} className={railTile(false)}>
      <ShieldCheck size={20} aria-hidden />
      <span className="text-meta font-semibold leading-tight">{t("controlRoomRail")}</span>
    </Link>
  );
}
