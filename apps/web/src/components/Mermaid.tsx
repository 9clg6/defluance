"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

/** Renders a mermaid diagram in strict mode (the library sanitises the SVG). Loaded only when a note has a diagram. */
export function Mermaid({ chart }: { chart: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = `m${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const { dark } = useTheme();
  const { t } = useT();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "default" });
        const { svg } = await mermaid.render(id, chart);
        if (!cancelled && ref.current) {
          ref.current.innerHTML = svg;
          setError(undefined);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chart, dark, id]);

  if (error) {
    return (
      <div role="alert" className="rounded-lg border border-destructive/50 p-3 text-sm">
        <p className="text-destructive">{t("mermaid.error")}</p>
        <pre className="mt-2 overflow-x-auto text-xs">{chart}</pre>
      </div>
    );
  }
  return <div ref={ref} role="img" aria-label={t("mermaid.label")} className="my-4 overflow-x-auto" />;
}
