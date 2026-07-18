/**
 * Region screenshot ("clip") capture for the reader overlay. The panic rewrite
 * to the PDF.js viewer dropped this; the backend (POST /notes/{key}/image) and
 * the upload client (postNoteImage) survived. The overlay shares reader.html's
 * document with the PDF.js viewer, so — unlike the portal, which iframes the
 * viewer — it can read the rendered page canvases directly.
 *
 * The crop algorithm is the portal PdfPane's, retargeted at the live viewer.
 */
import { useEffect, useRef, useState } from "react";

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function normalize(rect: Rect): Rect {
  return {
    x: rect.w < 0 ? rect.x + rect.w : rect.x,
    y: rect.h < 0 ? rect.y + rect.h : rect.y,
    w: Math.abs(rect.w),
    h: Math.abs(rect.h),
  };
}

// Crop the selection (viewport client coords) out of whichever PDF.js page
// canvas contains its centre, at the canvas's native resolution. Returns null
// when the selection is over no page (e.g. the margins).
export function cropViewerSelection(selection: Rect): Promise<Blob> | null {
  const centreX = selection.x + selection.w / 2;
  const centreY = selection.y + selection.h / 2;
  const canvases = document.querySelectorAll<HTMLCanvasElement>("#viewer .canvasWrapper canvas");
  for (const canvas of Array.from(canvases)) {
    const rect = canvas.getBoundingClientRect();
    if (centreX < rect.left || centreX > rect.right || centreY < rect.top || centreY > rect.bottom) {
      continue;
    }
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const source = {
      x: (selection.x - rect.left) * scaleX,
      y: (selection.y - rect.top) * scaleY,
      w: selection.w * scaleX,
      h: selection.h * scaleY,
    };
    const out = document.createElement("canvas");
    out.width = Math.round(source.w);
    out.height = Math.round(source.h);
    const context = out.getContext("2d");
    if (context === null) {
      throw new Error("MathRead clip: 2d canvas context unavailable");
    }
    context.drawImage(canvas, source.x, source.y, source.w, source.h, 0, 0, out.width, out.height);
    return new Promise((resolve, reject) => {
      out.toBlob((blob) => {
        if (blob === null) {
          reject(new Error("MathRead clip: canvas produced no PNG"));
          return;
        }
        resolve(blob);
      }, "image/png");
    });
  }
  return null;
}

// A full-viewport crosshair layer that captures a drag rectangle over the PDF
// and hands back the cropped PNG. A click (no drag) or Escape cancels.
export function ClipLayer({
  onCapture,
  onCancel,
}: {
  onCapture: (png: Blob) => void;
  onCancel: () => void;
}) {
  const [drag, setDrag] = useState<Rect | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const onPointerDown = (event: React.PointerEvent) => {
    startRef.current = { x: event.clientX, y: event.clientY };
    setDrag({ x: event.clientX, y: event.clientY, w: 0, h: 0 });
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const start = startRef.current;
    if (start === null) {
      return;
    }
    setDrag({ x: start.x, y: start.y, w: event.clientX - start.x, h: event.clientY - start.y });
  };
  const onPointerUp = () => {
    const current = drag;
    startRef.current = null;
    setDrag(null);
    if (current === null) {
      return;
    }
    const selection = normalize(current);
    if (selection.w < 4 || selection.h < 4) {
      onCancel();
      return;
    }
    const png = cropViewerSelection(selection);
    if (png === null) {
      onCancel();
      return;
    }
    void png.then(onCapture);
  };

  const box = drag === null ? null : normalize(drag);
  return (
    <div
      data-testid="clip-layer"
      className="pointer-events-auto fixed inset-0 z-[2147483040] cursor-crosshair select-none bg-zinc-950/10"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {box !== null && (
        <div
          data-testid="clip-selection"
          className="absolute border-2 border-amber-400 bg-amber-400/20"
          style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
        />
      )}
    </div>
  );
}
