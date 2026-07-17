/**
 * Self-mounting entry for the MathRead reader overlay. reader.js announces the
 * open document with a "mathread:document" CustomEvent; library pages mount
 * with the library tab open and no document.
 */
import { mountOverlay } from "./overlay";

const host = document.getElementById("mathread-root");
if (host === null) {
  throw new Error("MathRead overlay requires a #mathread-root element");
}

const overlay = mountOverlay(host, {
  initialTab: document.body.classList.contains("mathread-library-mode")
    ? "library"
    : null,
});

window.addEventListener("mathread:document", (event) => {
  const detail = (event as CustomEvent).detail as unknown;
  if (
    typeof detail !== "object"
    || detail === null
    || typeof (detail as { key?: unknown }).key !== "string"
    || typeof (detail as { sourceUrl?: unknown }).sourceUrl !== "string"
  ) {
    throw new Error("mathread:document event carried no document");
  }
  overlay.setDocument(detail as { key: string; sourceUrl: string });
});

// Ready only after the document listener above exists: reader.js replies
// synchronously to this event when the key already arrived.
window.dispatchEvent(new CustomEvent("mathread:overlay-ready"));
