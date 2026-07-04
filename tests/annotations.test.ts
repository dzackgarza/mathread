// Annotations live inside the markdown notes sidecar as pandoc fenced divs:
//
//   ::: {.annotation id="a-1" page="3" color="#ffe09d" created="<ISO>" rects="x,y,w,h;..."}
//   > highlighted source text (blockquoted, one line per source line)
//
//   optional comment markdown
//   :::
//
// The div attributes carry everything needed to re-render the highlight on the
// PDF at any zoom (rects are page-fraction coordinates), so the sidecar is the
// single durable store - nothing in localStorage, nothing embedded in the PDF.
import { expect, test } from "bun:test";
import {
  parseAnnotations,
  previewMarkdown,
  removeAnnotation,
  serializeAnnotation,
  upsertAnnotation,
} from "../extension/reader/annotations.ts";

const rect = { xPct: 0.1204, yPct: 0.3311, wPct: 0.521, hPct: 0.0182 };
const rect2 = { xPct: 0.1204, yPct: 0.352, wPct: 0.3, hPct: 0.0182 };

const base = {
  id: "a-test1",
  pageNumber: 3,
  color: "#ffe09d",
  created: "2026-07-04T04:00:00.000Z",
  rects: [rect, rect2],
  text: "Let L be an even unimodular lattice",
  comment: "",
};

test("serialize then parse round-trips a bare highlight", () => {
  const block = serializeAnnotation(base);
  expect(block.startsWith("::: {.annotation ")).toBe(true);
  expect(block.trimEnd().endsWith(":::")).toBe(true);

  const doc = `# Notes\n\nsome prose\n\n${block}\n`;
  const parsed = parseAnnotations(doc);
  expect(parsed.length).toBe(1);
  const a = parsed[0]!;
  expect(a.id).toBe(base.id);
  expect(a.pageNumber).toBe(3);
  expect(a.color).toBe("#ffe09d");
  expect(a.created).toBe(base.created);
  expect(a.text).toBe(base.text);
  expect(a.comment).toBe("");
  expect(a.rects.length).toBe(2);
  expect(a.rects[0]!.xPct).toBeCloseTo(rect.xPct, 4);
  expect(a.rects[1]!.yPct).toBeCloseTo(rect2.yPct, 4);
  // Offsets span exactly the serialized block within the doc.
  expect(doc.slice(a.start, a.end)).toBe(block);
});

test("round-trips comment and multi-line math text", () => {
  const a = {
    ...base,
    id: "a-math",
    text: "Then $L \\cong U^{\\oplus 2} \\oplus E_8(-1)$\nby the classification.",
    comment: "Compare with [Nikulin, Thm 1.13.1].\n\nSecond paragraph, $d(L) = 2$.",
  };
  const parsed = parseAnnotations(serializeAnnotation(a));
  expect(parsed.length).toBe(1);
  expect(parsed[0]!.text).toBe(a.text);
  expect(parsed[0]!.comment).toBe(a.comment);
});

test("text containing ::: lines cannot terminate the block early", () => {
  const a = { ...base, id: "a-fence", text: ":::\nnot a fence", comment: "also :::" };
  const parsed = parseAnnotations(serializeAnnotation(a));
  expect(parsed.length).toBe(1);
  expect(parsed[0]!.text).toBe(a.text);
  expect(parsed[0]!.comment.trim().endsWith(":::")).toBe(true);
});

test("a comment line indented into a ::: fence round-trips without losing its space", () => {
  // A comment that quotes pandoc fenced-div syntax with a one-space indent. The
  // serializer escapes fence-looking comment lines; unescape must be a true inverse
  // and not strip a leading space the author actually wrote.
  const a = { ...base, id: "a-esc", comment: "Block syntax:\n :::" };
  const parsed = parseAnnotations(serializeAnnotation(a));
  expect(parsed.length).toBe(1);
  expect(parsed[0]!.comment).toBe(a.comment);
});

test("a comment that opens with a blank line round-trips exactly", () => {
  // The serializer separates text from comment with one blank line; parsing must
  // strip exactly that separator, not every leading blank, or authored blank lines vanish.
  const a = { ...base, id: "a-blank", comment: "\nStarts after a blank line." };
  const parsed = parseAnnotations(serializeAnnotation(a));
  expect(parsed.length).toBe(1);
  expect(parsed[0]!.comment).toBe(a.comment);
});

test("parses multiple annotations and ignores unrelated fenced divs", () => {
  const doc = [
    "::: {.warning}",
    "not an annotation",
    ":::",
    "",
    serializeAnnotation({ ...base, id: "a-1", pageNumber: 1 }),
    "",
    "prose between",
    "",
    serializeAnnotation({ ...base, id: "a-2", pageNumber: 9 }),
    "",
  ].join("\n");
  const parsed = parseAnnotations(doc);
  expect(parsed.map(a => a.id)).toEqual(["a-1", "a-2"]);
  expect(parsed.map(a => a.pageNumber)).toEqual([1, 9]);
});

test("upsert appends a new annotation and replaces an existing one in place", () => {
  const doc = "# Notes\n\nprose\n";
  const withOne = upsertAnnotation(doc, base);
  expect(withOne.startsWith("# Notes\n\nprose\n")).toBe(true);
  expect(parseAnnotations(withOne).length).toBe(1);

  const edited = { ...base, comment: "now with a comment" };
  const withEdit = upsertAnnotation(withOne, edited);
  const parsed = parseAnnotations(withEdit);
  expect(parsed.length).toBe(1);
  expect(parsed[0]!.comment).toBe("now with a comment");
  // In-place: prose before and nothing duplicated after.
  expect(withEdit.match(/\.annotation/g)?.length).toBe(1);
});

test("remove deletes exactly the matching block and leaves prose intact", () => {
  let doc = upsertAnnotation("intro prose\n", { ...base, id: "a-1" });
  doc = upsertAnnotation(doc, { ...base, id: "a-2" });
  const removed = removeAnnotation(doc, "a-1");
  const parsed = parseAnnotations(removed);
  expect(parsed.map(a => a.id)).toEqual(["a-2"]);
  expect(removed.startsWith("intro prose\n")).toBe(true);
  expect(removeAnnotation(removed, "missing-id")).toBe(removed);
});

test("previewMarkdown strips fences so marked renders content, not ::: lines", () => {
  const doc = upsertAnnotation("# Notes\n", { ...base, comment: "important" });
  const preview = previewMarkdown(doc);
  expect(preview.includes(":::")).toBe(false);
  expect(preview.includes(base.text)).toBe(true);
  expect(preview.includes("important")).toBe(true);
  expect(preview.includes("p. 3")).toBe(true);
});

test("hand-authored block with unquoted-style spacing still parses", () => {
  const doc = [
    '::: {.annotation id="hand-1" page="12" color="#91edd0" created="2026-01-01T00:00:00.000Z" rects="0.1,0.2,0.3,0.04"}',
    "> quoted claim",
    "",
    "my remark",
    ":::",
  ].join("\n");
  const parsed = parseAnnotations(doc);
  expect(parsed.length).toBe(1);
  expect(parsed[0]!.pageNumber).toBe(12);
  expect(parsed[0]!.rects).toEqual([{ xPct: 0.1, yPct: 0.2, wPct: 0.3, hPct: 0.04 }]);
  expect(parsed[0]!.comment).toBe("my remark");
});

test("malformed blocks are skipped, not fatal", () => {
  const doc = [
    '::: {.annotation id="broken" page="NaN" color="#fff" created="x" rects="bogus"}',
    "> text",
    ":::",
    "",
    serializeAnnotation(base),
  ].join("\n");
  const parsed = parseAnnotations(doc);
  expect(parsed.map(a => a.id)).toEqual([base.id]);
});
