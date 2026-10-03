import { describe, expect, it } from "vitest";
import { calloutNode, embedNode, remarkObsidian, resolveAttachment, sectionOf, transformText } from "./obsidian";

const o = { attachmentUrl: (r: string) => `/files/${r}` };

describe("embeds", () => {
  it("makes pictures with a width or an alt text, media elements, file links, and note embeds", () => {
    expect(embedNode("attachments/a.png|300", o)).toMatchObject({ type: "image", url: "/files/attachments/a.png", alt: "a.png", data: { hProperties: { width: "300" } } });
    expect(embedNode("a.png|the flow", o)).toMatchObject({ type: "image", alt: "the flow" });
    expect(embedNode("clip.mp4", o)).toMatchObject({ data: { hName: "video", hProperties: { src: "/files/clip.mp4", controls: true } } });
    expect(embedNode("song.mp3|Theme", o)).toMatchObject({ data: { hName: "audio" } });
    expect(embedNode("spec.pdf", o)).toMatchObject({ type: "link", url: "/files/spec.pdf" });
    expect(embedNode("Other note#Part|shown", o)).toMatchObject({ type: "link", url: "#embed:Other%20note%23Part" });
  });
});

describe("text extras", () => {
  const kinds = (s: string) => transformText(s, o).map((n) => n.data?.hName ?? n.type);

  it("drops %%comments%%, marks ==highlights==, expands embeds and styles #tags", () => {
    expect(transformText("a %%hidden%% b", o)).toEqual([{ type: "text", value: "a  b" }]);
    expect(kinds("see ==this== and ![[x.png]] with #idea")).toEqual(["text", "mark", "text", "image", "text", "span"]);
    expect(transformText("%%all of it%%", o)).toEqual([]);
  });

  it("does not mistake numbers, anchors or lone equals signs", () => {
    expect(transformText("issue #123, a == b, [[n#Heading]], x#y", o)).toEqual([{ type: "text", value: "issue #123, a == b, [[n#Heading]], x#y" }]);
  });
});

describe("callouts", () => {
  const quote = (text: string, more: { type: string }[] = []) => ({ type: "blockquote", children: [{ type: "paragraph", children: [{ type: "text", value: text }] }, ...more] });

  it("turns `> [!type] Title` into a callout with its title", () => {
    const c = calloutNode(quote("[!warning] Careful\nThe body line."));
    expect(c?.data).toMatchObject({ hName: "div", hProperties: { className: ["callout", "callout-warning"] } });
    expect(c?.children?.[0]).toMatchObject({ data: { hProperties: { className: ["callout-title"] } }, children: [{ value: "Careful" }] });
    expect(c?.children?.[1]).toMatchObject({ type: "paragraph", children: [{ value: "The body line." }] });
  });

  it("titles a bare callout after its type and folds on + or -", () => {
    expect(calloutNode(quote("[!tip]"))?.children?.[0]?.children?.[0]?.value).toBe("Tip");
    expect(calloutNode(quote("[!note]- Closed"))?.data).toMatchObject({ hName: "details" });
    expect(calloutNode(quote("[!note]+ Open"))?.data?.hProperties).toMatchObject({ open: true });
  });

  it("leaves an ordinary quote alone", () => {
    expect(calloutNode(quote("Just a quote"))).toBeNull();
    expect(calloutNode(quote("[not a callout]"))).toBeNull();
  });
});

describe("the plugin", () => {
  it("rewrites a tree in place, text inside callouts included, and leaves code alone", () => {
    const tree = {
      type: "root",
      children: [
        { type: "blockquote", children: [{ type: "paragraph", children: [{ type: "text", value: "[!info] Hello\nsee ==this==" }] }] },
        { type: "paragraph", children: [{ type: "inlineCode", value: "![[x.png]] ==no==" }] },
      ],
    };
    remarkObsidian(o)()(tree);
    const callout = tree.children[0] as { data?: { hName?: string }; children?: { children?: { data?: { hName?: string } }[] }[] };
    expect(callout.data?.hName).toBe("div");
    expect(JSON.stringify(callout)).toContain('"hName":"mark"');
    expect(JSON.stringify(tree.children[1])).toContain("![[x.png]] ==no==");
  });
});

describe("attachment paths and sections", () => {
  it("resolves relative to the note's folder first, then from the vault root", () => {
    expect(resolveAttachment("produit/auth/login", "attachments/a b.png")).toEqual({ primary: "/api/v1/files/produit/auth/attachments/a%20b.png", fallback: "/api/v1/files/attachments/a%20b.png" });
    expect(resolveAttachment("produit/auth/login", "../shared/x.png").primary).toBe("/api/v1/files/produit/shared/x.png");
    expect(resolveAttachment("readme", "x.png").primary).toBe("/api/v1/files/x.png");
  });

  it("takes the part of a note under a heading, to the next heading of the same level", () => {
    const body = "Intro.\n\n## Flow\n\nStep one.\n\n### Detail\n\nMore.\n\n## Other\n\nElse.\n";
    expect(sectionOf(body, "flow")).toBe("Step one.\n\n### Detail\n\nMore.");
    expect(sectionOf(body, "Other")).toBe("Else.");
    expect(sectionOf(body)).toBe(body);
    expect(sectionOf(body, "missing")).toBe(body);
    expect(sectionOf("```\n## Flow\n```\n## Flow\ntext", "Flow")).toBe("text");
  });
});
