// Annotation storage model: each highlight/comment lives in the markdown notes
// sidecar as a pandoc fenced div carrying everything needed to re-render it on
// the PDF at any zoom. The sidecar is the single durable store — no localStorage,
// nothing embedded in the PDF — so notes stay portable, diffable plain text.
//
//   ::: {.annotation id="a-1" page="3" color="#ffe09d" created="<ISO>" rects="x,y,w,h;..."}
//   > highlighted source text (blockquoted)
//
//   optional comment markdown
//   :::
//
// Rects are page-fraction coordinates (0..1 of page width/height), one
// "x,y,w,h" tuple per selection client rect, semicolon-separated.

export interface AnnotationRect {
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
}

export interface Annotation {
  id: string;
  pageNumber: number;
  color: string;
  created: string; // ISO 8601
  rects: AnnotationRect[];
  text: string;
  comment: string;
}

export interface ParsedAnnotation extends Annotation {
  /** Character offset of the block's first character in the source markdown. */
  start: number;
  /** Character offset one past the block's last character. */
  end: number;
}

const OPEN_RE = /^::: \{\.annotation ([^}]*)\}$/;
const ATTR_RE = /(\w+)="([^"]*)"/g;

function formatRects(rects: AnnotationRect[]): string {
  return rects
    .map(r => [r.xPct, r.yPct, r.wPct, r.hPct].map(v => v.toFixed(4)).join(","))
    .join(";");
}

function parseRects(value: string): AnnotationRect[] | null {
  const rects: AnnotationRect[] = [];
  for (const tuple of value.split(";")) {
    const parts = tuple.split(",").map(Number);
    if (parts.length !== 4 || parts.some(n => !Number.isFinite(n))) {
      return null;
    }
    rects.push({ xPct: parts[0]!, yPct: parts[1]!, wPct: parts[2]!, hPct: parts[3]! });
  }
  return rects.length > 0 ? rects : null;
}

export function serializeAnnotation(annotation: Annotation): string {
  const attrs = [
    `id="${annotation.id}"`,
    `page="${annotation.pageNumber}"`,
    `color="${annotation.color}"`,
    `created="${annotation.created}"`,
    `rects="${formatRects(annotation.rects)}"`,
  ].join(" ");
  const quoted = annotation.text.split("\n").map(line => `> ${line}`);
  const lines = [`::: {.annotation ${attrs}}`, ...quoted];
  if (annotation.comment.length > 0) {
    // A comment line that is itself a fence terminator would end the block
    // early; a leading space keeps the content intact and markdown-invisible.
    lines.push("", ...annotation.comment.split("\n").map(line => (/^:::/.test(line) ? ` ${line}` : line)));
  }
  lines.push(":::");
  return lines.join("\n");
}

export function parseAnnotations(markdown: string): ParsedAnnotation[] {
  const annotations: ParsedAnnotation[] = [];
  const lines = markdown.split("\n");
  // Offset of each line start, so parsed blocks report exact source spans.
  const offsets: number[] = [0];
  for (const line of lines) {
    offsets.push(offsets[offsets.length - 1]! + line.length + 1);
  }

  for (let i = 0; i < lines.length; i += 1) {
    const open = OPEN_RE.exec(lines[i]!);
    if (open === null) {
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const match of open[1]!.matchAll(ATTR_RE)) {
      attrs[match[1]!] = match[2]!;
    }

    let close = -1;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (/^:::\s*$/.test(lines[j]!)) {
        close = j;
        break;
      }
    }
    if (close === -1) {
      continue;
    }

    const body = lines.slice(i + 1, close);
    let textEnd = 0;
    while (textEnd < body.length && body[textEnd]!.startsWith("> ")) {
      textEnd += 1;
    }
    const text = body
      .slice(0, textEnd)
      .map(line => line.slice(2))
      .join("\n");
    const comment = body
      .slice(textEnd)
      .join("\n")
      .replace(/^\n+/, "")
      .replace(/^ :::/gm, ":::"); // undo the serializer's fence escape

    const pageNumber = Number(attrs.page);
    const rects = attrs.rects !== undefined ? parseRects(attrs.rects) : null;
    const { id, color, created } = attrs;
    if (
      id === undefined ||
      color === undefined ||
      created === undefined ||
      !Number.isInteger(pageNumber) ||
      pageNumber < 1 ||
      rects === null
    ) {
      i = close;
      continue; // malformed hand-edited block: skip, never crash the reader
    }

    annotations.push({
      id,
      pageNumber,
      color,
      created,
      rects,
      text,
      comment,
      start: offsets[i]!,
      end: offsets[close]! + lines[close]!.length,
    });
    i = close;
  }
  return annotations;
}

/** Replace the block with a matching id in place, or append at the end. */
export function upsertAnnotation(markdown: string, annotation: Annotation): string {
  const block = serializeAnnotation(annotation);
  const existing = parseAnnotations(markdown).find(a => a.id === annotation.id);
  if (existing !== undefined) {
    return markdown.slice(0, existing.start) + block + markdown.slice(existing.end);
  }
  const separator = markdown.length === 0 || markdown.endsWith("\n\n") ? "" : markdown.endsWith("\n") ? "\n" : "\n\n";
  return `${markdown}${separator}${block}\n`;
}

export function removeAnnotation(markdown: string, id: string): string {
  const existing = parseAnnotations(markdown).find(a => a.id === id);
  if (existing === undefined) {
    return markdown;
  }
  const after = markdown.slice(existing.end).replace(/^\n+/, "\n");
  return (markdown.slice(0, existing.start) + after).replace(/^\n/, markdown.startsWith("\n") ? "\n" : "");
}

/**
 * Rewrite annotation blocks into plain markdown (page label + blockquote +
 * comment) so the notes preview renders them instead of showing raw ::: fences.
 */
export function previewMarkdown(markdown: string): string {
  const parsed = parseAnnotations(markdown);
  let result = "";
  let cursor = 0;
  for (const a of parsed) {
    result += markdown.slice(cursor, a.start);
    const quoted = a.text.split("\n").map(line => `> ${line}`).join("\n");
    result += `**p. ${a.pageNumber}**\n\n${quoted}`;
    if (a.comment.length > 0) {
      result += `\n\n${a.comment}`;
    }
    cursor = a.end;
  }
  result += markdown.slice(cursor);
  return result;
}
