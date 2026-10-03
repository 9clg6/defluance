"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui";
import { useT } from "@/lib/i18n";

/** Copies `text`. The label turns to "Copied" for two seconds, and a hidden status line says so to screen readers. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const { t } = useT();
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          return; // clipboard blocked: nothing was copied, so do not say so
        }
        setDone(true);
        setTimeout(() => setDone(false), 2000);
      }}
    >
      {done ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      {done ? t("copied") : label}
      <span role="status" className="sr-only">{done ? t("copied") : ""}</span>
    </Button>
  );
}
