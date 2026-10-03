"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n";

export default function NotFound() {
  const { t } = useT();
  return (
    <div className="space-y-3">
      <h1 className="font-heading text-2xl font-semibold">{t("notfound.title")}</h1>
      <Link href="/" className="text-primary underline">{t("nav.home")}</Link>
    </div>
  );
}
