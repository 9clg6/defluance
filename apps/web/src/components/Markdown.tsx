"use client";

import Link from "next/link";
import { Children, createContext, isValidElement, useContext, useMemo, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { Mermaid } from "@/components/Mermaid";
import { useApi } from "@/hooks/use-api";
import { noteApi, slugify } from "@/lib/api";
import { remarkObsidian, resolveAttachment, sectionOf } from "@/lib/obsidian";
import { useT } from "@/lib/i18n";
import type { LinkView, NoteDetail } from "@/lib/types";
import { GH_STATE_MARK, makeResolver, remarkWikilinks } from "@/lib/wikilinks";
import { cn } from "@/lib/utils";

const text = (node: ReactNode): string =>
  Children.toArray(node)
    .map((c) => (typeof c === "string" || typeof c === "number" ? String(c) : isValidElement(c) ? text((c.props as { children?: ReactNode }).children) : ""))
    .join("");

/**
 * What a note may contain once rendered. GitHub-style by default, plus what Obsidian's syntax produces: callouts (`div`,
 * `details`), highlights, tags, and audio and video from the vault. Nothing that can run: no scripts, no inline handlers.
 */
const schema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "mark", "video", "audio"],
  attributes: {
    ...defaultSchema.attributes,
    div: [...(defaultSchema.attributes?.["div"] ?? []), "className"],
    span: [...(defaultSchema.attributes?.["span"] ?? []), "className"],
    p: [...(defaultSchema.attributes?.["p"] ?? []), "className"],
    details: [...(defaultSchema.attributes?.["details"] ?? []), "open", "className"],
    summary: [...(defaultSchema.attributes?.["summary"] ?? []), "className"],
    img: [...(defaultSchema.attributes?.["img"] ?? []), "width"],
    video: ["src", "controls", "width", "ariaLabel"],
    audio: ["src", "controls", "ariaLabel"],
  },
};

/** How many notes deep the one on screen is: a note shown inside a note shows its own embeds as links, never more notes. */
const EmbedDepth = createContext(0);

function Picture({ noteId, src, alt, width }: { noteId: string | undefined; src: string | undefined; alt: string; width?: string | number | undefined }) {
  const [failed, setFailed] = useState(false);
  if (!src) return null;
  if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(src) || !noteId) return <img src={src} alt={alt} loading="lazy" width={width} />;
  const { primary, fallback } = resolveAttachment(noteId, src);
  return <img src={failed ? fallback : primary} alt={alt} loading="lazy" width={width} onError={() => !failed && setFailed(true)} />;
}

/** `![[Other note#Heading]]`: the note, or its section, shown where it is mentioned. */
function NoteEmbed({ target, links }: { target: string; links: LinkView[] }) {
  const depth = useContext(EmbedDepth);
  const [name, heading] = decodeURIComponent(target).split("#") as [string, string | undefined];
  const hit = links.find((l) => l.target.toLowerCase() === name.toLowerCase() && l.note);
  const note = useApi<NoteDetail>(depth === 0 && hit?.note ? noteApi(hit.note.id) : null);
  if (!hit?.note) return <span className="text-destructive underline decoration-dotted">{name}</span>;
  const id = hit.note.id;
  if (depth > 0 || note.error) return <Link href={`/n/${id.split("/").map(encodeURIComponent).join("/")}`}>{hit.note.title}</Link>;
  if (!note.data || note.data.locked) return <span className="note-embed"><span className="note-embed-title">{hit.note.title}</span></span>;
  const body = sectionOf(note.data.body.replace(new RegExp(`^#\\s+${note.data.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\n+`), ""), heading);
  return (
    <span className="note-embed">
      <span className="note-embed-title">
        <Link href={`/n/${id.split("/").map(encodeURIComponent).join("/")}`}>{note.data.title}</Link>
      </span>
      <EmbedDepth.Provider value={depth + 1}>
        <Markdown source={body} links={[]} noteId={id} />
      </EmbedDepth.Provider>
    </span>
  );
}

const STATE_STYLE: Record<string, string> = { open: "text-success", merged: "text-primary", closed: "text-muted-foreground", unsynced: "text-muted-foreground" };
const STATE_DOT: Record<string, string> = { open: "bg-success", merged: "bg-primary", closed: "bg-muted-foreground", unsynced: "bg-muted-foreground" };

export function Markdown({ source, links, noteId }: { source: string; links: LinkView[]; noteId?: string }) {
  const { t } = useT();
  // embeds first: `![[x]]` must be taken before `[[x]]` is
  const remarkPlugins = useMemo(
    () => [remarkGfm, remarkObsidian({ attachmentUrl: (ref) => ref }), remarkWikilinks({ resolve: makeResolver(links) })],
    [links],
  );

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
        if (href.startsWith("#embed:")) return <NoteEmbed target={href.slice(7)} links={links} />;
        if (noteId && /^[^#:/][^:]*\.(pdf|csv)$/i.test(href)) {
          return (
            <a href={resolveAttachment(noteId, href).primary} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          );
        }
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
            <a href={href.slice(0, i)} target="_blank" rel="noopener noreferrer" className={cn("inline-flex items-baseline gap-1.5 font-medium no-underline", STATE_STYLE[state])}>
              <span className={cn("inline-block size-2 rounded-full self-center", STATE_DOT[state])} aria-hidden />
              <span>{children}</span>
              <span className="text-xs font-normal text-muted-foreground">({t(`gh.${state}` as never)})</span>
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
      // A task list item in the preview: a read-only checkbox that screen readers can name.
      input: ({ type, checked, disabled }) => <input type={type} checked={checked} disabled={disabled} readOnly aria-label={type === "checkbox" ? t("editor.task") : undefined} />,
      img: ({ src, alt, width }) => <Picture noteId={noteId} src={typeof src === "string" ? src : undefined} alt={alt ?? ""} width={width} />,
      video: ({ src, ...p }) => <video {...p} src={typeof src === "string" && noteId ? resolveAttachment(noteId, src).primary : typeof src === "string" ? src : undefined} />,
      audio: ({ src, ...p }) => <audio {...p} src={typeof src === "string" && noteId ? resolveAttachment(noteId, src).primary : typeof src === "string" ? src : undefined} />,
    };
  }, [t, noteId, links]);

  return (
    <div className="prose-note">
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={[[rehypeSanitize, schema]]} components={components}>
        {source}
      </ReactMarkdown>
    </div>
  );
}
