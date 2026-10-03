"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

// Mermaid's own themes are tinted (lavender boxes). These are plain greys that match the app.
const DARK = { background: "#1c1c1c", primaryColor: "#262626", primaryTextColor: "#f5f5f5", primaryBorderColor: "#8a8a8a", lineColor: "#bdbdbd", secondaryColor: "#303030", tertiaryColor: "#1c1c1c", noteBkgColor: "#303030", noteTextColor: "#f5f5f5", noteBorderColor: "#8a8a8a", actorBkg: "#262626", actorBorder: "#8a8a8a", actorTextColor: "#f5f5f5", actorLineColor: "#8a8a8a", signalColor: "#d4d4d4", signalTextColor: "#f5f5f5", labelBoxBkgColor: "#262626", labelBoxBorderColor: "#8a8a8a", labelTextColor: "#f5f5f5", loopTextColor: "#f5f5f5", textColor: "#f5f5f5", edgeLabelBackground: "#1c1c1c", fontFamily: "ui-sans-serif, system-ui, sans-serif" };
const LIGHT = { background: "#ffffff", primaryColor: "#ffffff", primaryTextColor: "#171717", primaryBorderColor: "#525252", lineColor: "#404040", secondaryColor: "#f0f0f0", tertiaryColor: "#ffffff", noteBkgColor: "#f0f0f0", noteTextColor: "#171717", noteBorderColor: "#525252", actorBkg: "#ffffff", actorBorder: "#525252", actorTextColor: "#171717", actorLineColor: "#525252", signalColor: "#262626", signalTextColor: "#171717", labelBoxBkgColor: "#ffffff", labelBoxBorderColor: "#525252", labelTextColor: "#171717", loopTextColor: "#171717", textColor: "#171717", edgeLabelBackground: "#ffffff", fontFamily: "ui-sans-serif, system-ui, sans-serif" };

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
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "base", themeVariables: dark ? DARK : LIGHT });
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
