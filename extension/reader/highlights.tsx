/**
 * Selection popup and highlight layers (issue #39), ported from the
 * pre-e8ceaf5 reader: mouseup over a viewer page turns the selection into
 * page-relative percentage rects; the Scholar-style popup commits a color
 * (or color + comment) as a pandoc annotation div in the note document; the
 * layers repaint from the parsed note on every change and page render.
 */
import { useCallback, useEffect, useState } from "react";
import {
  type Annotation,
  parseAnnotations,
} from "./annotations";

const highlightColors = [
  { color: "#ffe09d", title: "Amber highlight" },
  { color: "#91edd0", title: "Mint highlight" },
  { color: "#bed2f4", title: "Blue highlight" },
  { color: "#f8bfbf", title: "Pink highlight" },
  { color: "#d8bef4", title: "Purple highlight" },
];

type PendingSelection = {
  pageNumber: number;
  text: string;
  rects: Annotation["rects"];
  left: number;
  top: number;
};

export function HighlightController({
  noteText,
  commit,
}: {
  noteText: string | null;
  commit: (annotation: Annotation, focusComment: boolean) => void;
}) {
  const [pending, setPending] = useState<PendingSelection | null>(null);

  useEffect(() => {
    function onMouseUp(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      if (target.closest(".mathread-selection-popup") !== null) {
        return;
      }
      const pageDiv = target.closest<HTMLElement>("#viewer .page");
      if (pageDiv === null) {
        setPending(null);
        return;
      }
      const selection = window.getSelection();
      if (selection === null || selection.isCollapsed || selection.rangeCount === 0) {
        setPending(null);
        return;
      }
      const text = selection.toString().trim();
      if (text.length === 0) {
        setPending(null);
        return;
      }
      const clientRects = Array.from(selection.getRangeAt(0).getClientRects());
      if (clientRects.length === 0) {
        return;
      }
      const pageRect = pageDiv.getBoundingClientRect();
      const pageNumber = Number(pageDiv.dataset.pageNumber);
      if (!Number.isInteger(pageNumber) || pageNumber < 1) {
        throw new Error("MathRead viewer page is missing its page number");
      }
      const rects = clientRects.map((r) => ({
        xPct: (r.left - pageRect.left) / pageRect.width,
        yPct: (r.top - pageRect.top) / pageRect.height,
        wPct: r.width / pageRect.width,
        hPct: r.height / pageRect.height,
      }));
      const last = clientRects[clientRects.length - 1];
      if (last === undefined) {
        return;
      }
      setPending({ pageNumber, text, rects, left: last.right + 8, top: last.top });
    }
    document.addEventListener("mouseup", onMouseUp);
    return () => document.removeEventListener("mouseup", onMouseUp);
  }, []);

  const commitPending = useCallback(
    (color: string, focusComment: boolean) => {
      if (pending === null) {
        return;
      }
      commit(
        {
          id: `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          pageNumber: pending.pageNumber,
          text: pending.text,
          color,
          comment: "",
          rects: pending.rects,
          created: new Date().toISOString(),
        },
        focusComment,
      );
      window.getSelection()?.removeAllRanges();
      setPending(null);
    },
    [pending, commit],
  );

  useHighlightLayers(noteText);

  if (pending === null) {
    return null;
  }
  return (
    <div
      className="mathread-selection-popup"
      data-testid="selection-popup"
      style={{ left: pending.left, top: pending.top }}
    >
      <button
        type="button"
        data-testid="popup-comment"
        className="mathread-popup-comment"
        title="Add comment"
        onClick={() => commitPending("#ffe09d", true)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" />
        </svg>
      </button>
      <div className="mathread-popup-swatches">
        {highlightColors.map(({ color, title }) => (
          <button
            key={color}
            type="button"
            title={title}
            data-color={color}
            onClick={() => commitPending(color, false)}
          >
            <span style={{ background: color }} />
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Paints parsed annotations into per-page layers. PDF.js owns the page DOM
 * and virtualizes it, so the painter re-runs on every pagerendered event as
 * well as on note changes.
 */
function useHighlightLayers(noteText: string | null) {
  const repaint = useCallback(() => {
    const annotations = noteText === null ? [] : safeParse(noteText);
    for (const pageDiv of document.querySelectorAll<HTMLElement>("#viewer .page")) {
      let layer = pageDiv.querySelector<HTMLElement>(":scope > .highlightLayer");
      if (layer === null) {
        layer = document.createElement("div");
        layer.className = "highlightLayer";
        pageDiv.append(layer);
      }
      layer.replaceChildren();
      const pageNumber = Number(pageDiv.dataset.pageNumber);
      for (const annotation of annotations) {
        if (annotation.pageNumber !== pageNumber) {
          continue;
        }
        for (const rect of annotation.rects) {
          const mark = document.createElement("div");
          mark.className = "highlight-mark";
          mark.style.left = `${rect.xPct * 100}%`;
          mark.style.top = `${rect.yPct * 100}%`;
          mark.style.width = `${rect.wPct * 100}%`;
          mark.style.height = `${rect.hPct * 100}%`;
          mark.style.background = annotation.color;
          if (annotation.comment.length > 0) {
            mark.title = annotation.comment;
          }
          layer.append(mark);
        }
      }
    }
  }, [noteText]);

  useEffect(repaint, [repaint]);

  useEffect(() => {
    const application = window.PDFViewerApplication;
    if (application?.initializedPromise === undefined) {
      return;
    }
    let disposed = false;
    let bus: { off(eventName: "pagerendered", listener: () => void): void } | null = null;
    void application.initializedPromise.then(() => {
      if (disposed || application.eventBus === undefined) {
        return;
      }
      bus = application.eventBus;
      application.eventBus.on("pagerendered", repaint);
    });
    return () => {
      disposed = true;
      bus?.off("pagerendered", repaint);
    };
  }, [repaint]);
}

function safeParse(noteText: string): Annotation[] {
  try {
    return parseAnnotations(noteText);
  } catch {
    // A syntax error in hand-edited annotation divs is surfaced by the notes
    // panel; the painter simply has nothing valid to draw yet.
    return [];
  }
}
