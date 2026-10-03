"use client";

import Link from "next/link";
import { Children, isValidElement, useMemo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { Mermaid } from "@/components/Mermaid";
import { slugify } from "@/lib/api";
import { useT } from "@/lib/i18n";
import type { LinkView } from "@/lib/types";
import { GH_STATE_MARK, makeResolver, remarkWikilinks } from "@/lib/wikilinks";
import { cn } from "@/lib/utils";

const text = (node: ReactNode): string =>
  Children.toArray(node)
    .map((c) => (typeof c === "string" || typeof c === "number" ? String(c) : isValidElement(c) ? text((c.props as { children?: ReactNode }).children) : ""))
    .join("");

const STATE_STYLE: Record<string, string> = { open: "text-success", merged: "text-primary", closed: "text-muted-foreground" };

export function Markdown({ source, links }: { source: string; links: LinkView[] }) {
  const { t } = useT();
  const remarkPlugins = useMemo(() => [remarkGfm, remarkWikilinks({ resolve: makeResolver(links) })], [links]);

  const components = useMemo<Components>(() => {
    const heading = (Tag: "h1" | "h2" | "h3" | "h4") => {
      const H = ({ children }: { children?: ReactNode }) => <Tag id={slugify(text(children))}>{children}</Tag>;
      H.displayName = Tag;
      return H;
    };
    return {
      h1: heading("h1"),
      h2: heading("h2"),
      h3: heading("h3"),
      h4: heading("h4"),
      a({ href = "", children }) {
        if (href === "#broken") {
          return (
            <span className="text-destructive underline decoration-dotted underline-offset-2" title={t("link.broken")}>
              {children}
            </span>
          );
        }
        if (href.startsWith("/n/")) return <Link href={href}>{children}</Link>;
        const i = href.indexOf(GH_STATE_MARK);
        if (i !== -1) {
          const state = href.slice(i + GH_STATE_MARK.length);
          return (
            <a href={href.slice(0, i)} target="_blank" rel="noopener noreferrer" className={cn("font-medium no-underline", STATE_STYLE[state])}>
              {children}
            </a>
          );
        }
        if (href.startsWith("#")) return <a href={href}>{children}</a>;
        return (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        );
      },
      code({ className, children }) {
        if (/language-mermaid/.test(className ?? "")) return <Mermaid chart={text(children).trim()} />;
        return <code className={className}>{children}</code>;
      },
      pre({ children }) {
        // a mermaid block renders its own container: no <pre> around it
        const only = Children.toArray(children)[0];
        if (isValidElement(only) && only.type === Mermaid) return <>{children}</>;
        return <pre>{children}</pre>;
      },
      img: ({ src, alt }) => (
        <img src={typeof src === "string" ? src : undefined} alt={alt ?? ""} loading="lazy" />
      ),
    };
  }, [t]);

  return (
    <div className="prose-note">
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={[rehypeSanitize]} components={components}>
        {source}
      </ReactMarkdown>
    </div>
  );
}
