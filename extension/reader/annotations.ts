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

export class AnnotationSyntaxError extends Error {
  lineNumber: number;

  constructor(lineNumber: number, message: string) {
    super(`Annotation syntax error on line ${lineNumber}: ${message}`);
    this.name = "AnnotationSyntaxError";
    this.lineNumber = lineNumber;
  }
}

export interface AnnotationParseResult {
  annotations: ParsedAnnotation[];
  error: AnnotationSyntaxError | null;
}

const OPEN_RE = /^::: \{\.annotation(?: ([^}]*))?\}$/;
const ANNOTATION_OPEN_PREFIX_RE = /^::: \{\.annotation\b/;
const ATTR_RE = /(\w+)="([^"]*)"/y;

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "&#10;")
    .replace(/\r/g, "&#13;");
}

function unescapeAttr(value: string): string {
  return value
    .replace(/&#13;/g, "\r")
    .replace(/&#10;/g, "\n")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

function parseAttrs(source: string, lineNumber: number): { ok: true; attrs: Record<string, string> } | { ok: false; error: AnnotationSyntaxError } {
  const attrs: Record<string, string> = {};
  let cursor = 0;
  while (cursor < source.length) {
    while (cursor < source.length && /\s/.test(source[cursor]!)) {
      cursor += 1;
    }
    if (cursor >= source.length) {
      break;
    }

    ATTR_RE.lastIndex = cursor;
    const match = ATTR_RE.exec(source);
    if (match === null) {
      return { ok: false, error: new AnnotationSyntaxError(lineNumber, `could not parse attribute near "${source.slice(cursor, cursor + 24)}"`) };
    }

    const name = match[1]!;
    if (attrs[name] !== undefined) {
      return { ok: false, error: new AnnotationSyntaxError(lineNumber, `duplicate attribute "${name}"`) };
    }
    attrs[name] = unescapeAttr(match[2]!);
    cursor = ATTR_RE.lastIndex;
    if (cursor < source.length && !/\s/.test(source[cursor]!)) {
      return { ok: false, error: new AnnotationSyntaxError(lineNumber, `could not parse attribute near "${source.slice(cursor, cursor + 24)}"`) };
    }
  }
  return { ok: true, attrs };
}

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
    `id="${escapeAttr(annotation.id)}"`,
    `page="${annotation.pageNumber}"`,
    `color="${escapeAttr(annotation.color)}"`,
    `created="${escapeAttr(annotation.created)}"`,
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

function lineStartOffsets(lines: string[]): number[] {
  const offsets: number[] = [0];
  for (const line of lines) {
    offsets.push(offsets[offsets.length - 1]! + line.length + 1);
  }
  return offsets;
}

function closingFenceIndex(lines: string[], firstBodyLine: number): number {
  for (let i = firstBodyLine; i < lines.length; i += 1) {
    if (/^:::\s*$/.test(lines[i]!)) {
      return i;
    }
  }
  return -1;
}

function parseAnnotationBody(body: string[]): { text: string; comment: string } {
  let textEnd = 0;
  while (textEnd < body.length && body[textEnd]!.startsWith("> ")) {
    textEnd += 1;
  }
  const text = body
    .slice(0, textEnd)
    .map(line => line.slice(2))
    .join("\n");
  const commentLines = body.slice(textEnd);
  const commentStart = commentLines[0] === "" ? 1 : 0;
  return { text, comment: commentLines.slice(commentStart).join("\n") };
}

function parseAnnotationFields(
  attrs: Record<string, string>,
  lineNumber: number,
): { ok: true; fields: Pick<Annotation, "id" | "pageNumber" | "color" | "created" | "rects"> } | { ok: false; error: AnnotationSyntaxError } {
  const { id, color, created } = attrs;
  if (id === undefined) {
    return { ok: false, error: new AnnotationSyntaxError(lineNumber, "annotation block is missing id") };
  }
  if (color === undefined) {
    return { ok: false, error: new AnnotationSyntaxError(lineNumber, `annotation "${id}" is missing color`) };
  }
  if (created === undefined) {
    return { ok: false, error: new AnnotationSyntaxError(lineNumber, `annotation "${id}" is missing created`) };
  }
  const pageNumber = Number(attrs.page);
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    return { ok: false, error: new AnnotationSyntaxError(lineNumber, `annotation "${id}" has invalid page`) };
  }
  const rects = attrs.rects === undefined ? null : parseRects(attrs.rects);
  if (rects === null) {
    return { ok: false, error: new AnnotationSyntaxError(lineNumber, `annotation "${id}" has invalid rects`) };
  }
  return { ok: true, fields: { id, pageNumber, color, created, rects } };
}

export function parseAnnotationDocument(markdown: string): AnnotationParseResult {
  const annotations: ParsedAnnotation[] = [];
  const lines = markdown.split("\n");
  const offsets = lineStartOffsets(lines);

  for (let i = 0; i < lines.length; i += 1) {
    const open = OPEN_RE.exec(lines[i]!);
    if (open === null) {
      if (ANNOTATION_OPEN_PREFIX_RE.test(lines[i]!)) {
        return { annotations: [], error: new AnnotationSyntaxError(i + 1, "malformed annotation opening fence") };
      }
      continue;
    }
    if (open[1] === undefined) {
      return { annotations: [], error: new AnnotationSyntaxError(i + 1, "annotation opening fence has no attributes") };
    }
    const attrsResult = parseAttrs(open[1], i + 1);
    if (!attrsResult.ok) {
      return { annotations: [], error: attrsResult.error };
    }
    const attrs = attrsResult.attrs;

    const close = closingFenceIndex(lines, i + 1);
    if (close === -1) {
      return { annotations: [], error: new AnnotationSyntaxError(i + 1, "annotation block has no closing fence") };
    }

    const fieldsResult = parseAnnotationFields(attrs, i + 1);
    if (!fieldsResult.ok) {
      return { annotations: [], error: fieldsResult.error };
    }

    annotations.push({
      ...fieldsResult.fields,
      ...parseAnnotationBody(lines.slice(i + 1, close)),
      start: offsets[i]!,
      end: offsets[close]! + lines[close]!.length,
    });
    i = close;
  }
  return { annotations, error: null };
}

export function parseAnnotations(markdown: string): ParsedAnnotation[] {
  const result = parseAnnotationDocument(markdown);
  if (result.error !== null) {
    throw result.error;
  }
  return result.annotations;
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
