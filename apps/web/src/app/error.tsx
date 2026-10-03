"use client";

import Link from "next/link";
import { Button } from "@/components/ui";
import { useT } from "@/lib/i18n";

/** Boundary for any page: a crash in one view must not blank the whole app, and must never lose a note. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useT();
  return (
    <div role="alert" className="mx-auto max-w-xl space-y-3 pt-10">
      <h1 className="font-heading text-2xl font-semibold">{t("error.title")}</h1>
      <p className="text-muted-foreground">{t("error.body")}</p>
      {error.digest && (
        <p className="text-xs text-muted-foreground">
          {t("error.ref")}: <code>{error.digest}</code>
        </p>
      )}
      <div className="flex items-center gap-4">
        <Button onClick={reset}>{t("error.retry")}</Button>
        <Link href="/" className="text-primary underline">{t("nav.home")}</Link>
      </div>
    </div>
  );
}
