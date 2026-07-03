import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import { pdfUrl } from '../api';

declare const chrome: { runtime: { getURL(path: string): string } };

// bun build has no Vite-style `?url` asset-import suffix; the worker file is copied to
// dist/extension/mathread/portal/ alongside this bundle during build (see extension/build.ts).
pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('mathread/portal/pdf.worker.min.mjs');

interface PdfPaneProps {
  pdfKey: string;
  clipMode: boolean;
  initialPosition: number;
  onCapture: (png: Blob) => void;
  onPositionChange: (fraction: number) => void;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function PdfPane({ pdfKey, clipMode, initialPosition, onCapture, onPositionChange }: PdfPaneProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [drag, setDrag] = useState<Rect | null>(null);

  // Render the whole document as a vertical stack of page canvases.
  useEffect(() => {
    let cancelled = false;
    const pages = pagesRef.current;
    if (pages === null) return;
    pages.replaceChildren();
    setStatus('loading');

    (async () => {
      const doc = await pdfjs.getDocument({
        url: pdfUrl(pdfKey),
        wasmUrl: chrome.runtime.getURL('mathread/portal/wasm/'),
      }).promise;
      const width = pages.clientWidth !== 0 ? pages.clientWidth : 800;
      for (let n = 1; n <= doc.numPages; n++) {
        if (cancelled) return;
        const page = await doc.getPage(n);
        const unscaled = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: width / unscaled.width });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.className = 'block mx-auto mb-3 shadow-lg';
        pages.appendChild(canvas);
        const renderTask = page.render({
          canvas: canvas,
          viewport: viewport,
        });
        await renderTask.promise;
      }
      if (cancelled) return;
      // Restore last reading position (fraction of scrollable height).
      const scroller = scrollRef.current;
      if (scroller !== null) {
        scroller.scrollTop = initialPosition * (scroller.scrollHeight - scroller.clientHeight);
      }
      setStatus('ready');
    })().catch((err) => {
      if (!cancelled) {
        console.error('PDF render failed:', err);
        setStatus('error');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [pdfKey, initialPosition]);

  function handleScroll() {
    const scroller = scrollRef.current;
    if (scroller === null) return;
    const scrollable = scroller.scrollHeight - scroller.clientHeight;
    onPositionChange(scrollable > 0 ? scroller.scrollTop / scrollable : 0);
  }

  function pointerRect(e: React.PointerEvent): { clientX: number; clientY: number } {
    return { clientX: e.clientX, clientY: e.clientY };
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!clipMode) return;
    const box = scrollRef.current!.getBoundingClientRect();
    const p = pointerRect(e);
    setDrag({ x: p.clientX - box.left, y: p.clientY - box.top, w: 0, h: 0 });
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!clipMode || drag === null) return;
    const box = scrollRef.current!.getBoundingClientRect();
    const p = pointerRect(e);
    setDrag({ ...drag, w: p.clientX - box.left - drag.x, h: p.clientY - box.top - drag.y });
  }

  function onPointerUp() {
    if (!clipMode || drag === null) return;
    const selection = normalize(drag, scrollRef.current!);
    setDrag(null);
    if (selection.w < 4 || selection.h < 4) return;
    const png = cropSelection(selection, pagesRef.current!);
    if (png !== null) png.then(onCapture);
  }

  return (
    <div className="flex-1 flex flex-col bg-zinc-800 w-full h-full relative">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className={`flex-1 overflow-y-auto p-4 ${clipMode ? 'cursor-crosshair select-none' : ''}`}
      >
        {status === 'loading' && <p className="text-center text-zinc-400 text-sm mt-8">Loading PDF…</p>}
        {status === 'error' && <p className="text-center text-red-400 text-sm mt-8">Failed to load PDF. Check console for details.</p>}
        <div ref={pagesRef} className="w-full max-w-3xl mx-auto" />
      </div>
      {clipMode && drag !== null && (
        <div
          className="absolute border-2 border-blue-400 bg-blue-400/20 pointer-events-none"
          style={rectStyle(normalize(drag, scrollRef.current))}
        />
      )}
    </div>
  );
}

/** Selection in client coords, relative to the scroll container's top-left. */
function normalize(rect: Rect, scroller: HTMLDivElement | null): Rect {
  const x = rect.w < 0 ? rect.x + rect.w : rect.x;
  const y = rect.h < 0 ? rect.y + rect.h : rect.y;
  const w = Math.abs(rect.w);
  const h = Math.abs(rect.h);
  void scroller;
  return { x, y, w, h };
}

function rectStyle(rect: Rect): React.CSSProperties {
  return { left: rect.x, top: rect.y, width: rect.w, height: rect.h };
}

/** Crop the selection out of whichever page canvas contains its centre. */
function cropSelection(selection: Rect, pages: HTMLDivElement): Promise<Blob> | null {
  const box = pages.parentElement!.getBoundingClientRect();
  const centreX = box.left + selection.x + selection.w / 2;
  const centreY = box.top + selection.y + selection.h / 2;

  for (const canvas of Array.from(pages.querySelectorAll('canvas'))) {
    const rect = canvas.getBoundingClientRect();
    if (centreX < rect.left || centreX > rect.right || centreY < rect.top || centreY > rect.bottom) continue;

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const sx = (box.left + selection.x - rect.left) * scaleX;
    const sy = (box.top + selection.y - rect.top) * scaleY;
    const sw = selection.w * scaleX;
    const sh = selection.h * scaleY;

    const out = document.createElement('canvas');
    out.width = Math.round(sw);
    out.height = Math.round(sh);
    const context = out.getContext('2d');
    if (context === null) throw new Error('2d canvas context unavailable');
    context.drawImage(canvas, sx, sy, sw, sh, 0, 0, out.width, out.height);
    return new Promise((resolve) => out.toBlob((blob) => resolve(blob!), 'image/png'));
  }
  return null;
}
