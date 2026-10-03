"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import type { SearchMode } from "@/lib/types";
import { cn } from "@/lib/utils";

const MODES: SearchMode[] = ["hybrid", "keyword", "meaning", "smart"];

/**
 * Words, meaning, both, or a language model in front. A mode the server cannot do is disabled,
 * and the line below says why and how to turn it on.
 */
export function ModePicker({ value, onChange, idPrefix = "mode" }: { value: SearchMode; onChange: (m: SearchMode) => void; idPrefix?: string }) {
  const { t } = useT();
  const { me } = useAuth();
  const cap = me?.capabilities;
  const blocked = (m: SearchMode): string | null => (m === "meaning" && cap && !cap.semantic ? t("search.mode.needsModel") : m === "smart" && cap && !cap.llm ? t("search.mode.needsLlm") : null);
  // Clicking a mode the server cannot do does not select it: it explains what is missing.
  const [peek, setPeek] = useState<SearchMode | null>(null);
  const help = (peek && blocked(peek)) || t(`search.mode.${value}Help` as never);

  return (
    <div>
      <div role="radiogroup" aria-label={t("search.mode.label")} className="inline-flex rounded-lg border bg-card p-0.5">
        {MODES.map((m) => {
          const why = blocked(m);
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={value === m}
              aria-disabled={!!why}
              aria-describedby={`${idPrefix}-help`}
              title={why ?? undefined}
              onClick={() => {
                if (why) setPeek(m);
                else {
                  setPeek(null);
                  onChange(m);
                }
              }}
              className={cn("rounded-md px-3 py-1 text-sm", value === m ? "bg-primary font-medium text-primary-foreground" : "text-muted-foreground hover:text-foreground", why && "opacity-60")}
            >
              {t(`search.mode.${m}` as never)}
            </button>
          );
        })}
      </div>
      <p id={`${idPrefix}-help`} className="mt-1 text-xs text-muted-foreground">
        {help}
      </p>
    </div>
  );
}
