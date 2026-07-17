import { postReadEvent } from "./vendor/backend.js";
import { printDocument } from "./print.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parseLaunch(params) {
  const file = params.get("file");
  if (window.parent === window) {
    if (file !== null) {
      throw new Error(
        "MathRead no longer reads backend copies at reader URLs; navigate to the PDF's source URL instead.",
      );
    }
    return { kind: "library" };
  }
  // Takeover surface (#40): the parent wrapper page hands the vendored
  // viewer its document URL through the native ?file= entrypoint.
  assert(file !== null, "MathRead takeover reader requires its document URL");
  return { kind: "takeover", sourceUrl: file };
}

const launch = parseLaunch(new URLSearchParams(location.search));

if (launch.kind === "library") {
  document.body.classList.add("mathread-library-mode");
}

let pdfViewerState = { kind: "awaiting" };
let currentPdfViewState = { kind: "awaiting" };
let takeoverKey = null;
let overlayDocument = null;
let overlayReady = false;

window.addEventListener("mathread:overlay-ready", () => {
  overlayReady = true;
  if (overlayDocument !== null) {
    publishOverlayDocument();
  }
});

function publishOverlayDocument() {
  assert(overlayDocument !== null, "MathRead overlay document must exist before publishing");
  window.dispatchEvent(new CustomEvent("mathread:document", { detail: overlayDocument }));
}


if (launch.kind !== "library") {
  document.addEventListener("DOMContentLoaded", waitForPdfViewer, { once: true });
}

// The wrapper page lives at the source URL; target it exactly rather than
// "*" so reader→parent messages are not delivered to an unexpected origin.
// The receive-side event.source check stays the primary control.
const parentOrigin = launch.kind === "takeover" ? new URL(launch.sourceUrl).origin : null;

if (launch.kind === "takeover") {
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) {
      return;
    }
    const data = event.data;
    if (data === null || typeof data !== "object") {
      return;
    }
    if (data.type === "mathread:print") {
      window.print();
      return;
    }
    if (data.type !== "mathread:document") {
      return;
    }
    assert(takeoverKey === null, "MathRead takeover received a second document");
    assert(typeof data.key === "string" && data.key.length > 0, "MathRead takeover message has no library key");
    takeoverKey = data.key;
    void postReadEvent(takeoverKey);
    // The React overlay owns the notes and library surfaces. The overlay
    // bundle is large and may still be parsing when the key arrives, so the
    // handshake is two-way: publish now if it is ready, else on its ready
    // event (whose listener below was registered at this module's eval).
    overlayDocument = { key: takeoverKey, sourceUrl: launch.sourceUrl };
    if (overlayReady) {
      publishOverlayDocument();
    }
  });
  window.parent.postMessage({ type: "mathread:ready" }, parentOrigin);
}

// PDF.js's Chromium viewer rewrites the visible URL to a synthetic extension-path
// form that only resolves while the extension service worker can be woken to
// route it. The reader document URL is a real file, so restoring it keeps reload
// and history traversal working in every worker state. reader.js evaluates before
// viewer.mjs, so this listener fires after the viewer's rewrite has happened.
document.addEventListener("DOMContentLoaded", restoreCanonicalReaderUrl, { once: true });

function restoreCanonicalReaderUrl() {
  const canonical = new URL(chrome.runtime.getURL("reader/reader.html"));
  // window-qualified: the CodeMirror `history` import shadows the global.
  window.history.replaceState(
    window.history.state,
    "",
    `${canonical.href}${location.hash}`,
  );
}

function waitForPdfViewer() {
  const application = window.PDFViewerApplication;
  assert(application !== null && typeof application === "object", "PDF.js application is unavailable");
  const initialized = application.initializedPromise;
  assert(initialized !== null && typeof initialized === "object" && typeof initialized.then === "function", "PDF.js initialization is unavailable");
  void initialized.then(() => observePdfView(application));
}

function observePdfView(application) {
  const eventBus = application.eventBus;
  const pdfViewer = application.pdfViewer;
  assert(eventBus !== null && typeof eventBus === "object" && typeof eventBus.on === "function", "PDF.js view event bus is unavailable");
  assert(pdfViewer !== null && typeof pdfViewer === "object" && typeof pdfViewer.update === "function", "PDF.js viewer is unavailable");
  pdfViewerState = { kind: "ready", pdfViewer };
  if (launch.kind === "takeover") {
    // Claimed after PDF.js initializes: the viewer installs its own
    // canvas-rasterizing window.print during startup, and every print entry
    // (toolbar button, in-frame Ctrl+P) funnels through window.print. The
    // native blob-frame pipeline replaces it.
    window.print = () => {
      void printDocument(window.PDFViewerApplication);
    };
  }
  eventBus.on("updateviewarea", ({ location }) => {
    currentPdfViewState = parsePdfView(location);
    if (launch.kind === "takeover" && currentPdfViewState.kind === "available") {
      // Publish the view as a standard open-parameters fragment; the parent
      // mirrors it onto the source URL's hash, which stays the one canonical
      // view state a copied link or a reload picks up.
      const view = currentPdfViewState;
      assert(parentOrigin !== null, "MathRead takeover parent origin must be resolved");
      window.parent.postMessage({
        type: "mathread:view",
        hash: `#page=${view.page}&zoom=${Math.round(view.zoom * 100)},${view.x},${view.y}`,
      }, parentOrigin);
    }
  });
}

function parsePdfView(location) {
  assert(location !== null && typeof location === "object", "PDF.js view update has no location");
  const { pageNumber, scale, left, top } = location;
  assert(Number.isInteger(pageNumber) && pageNumber >= 0, "PDF.js view page must be nonnegative");
  if (
    pageNumber === 0
    || typeof scale !== "number"
    || !Number.isFinite(scale)
    || scale === 0
  ) {
    return { kind: "awaiting" };
  }
  assert(pageNumber >= 1, "PDF.js view page must be positive");
  assert(scale > 0, "PDF.js view zoom must be positive");
  assert(Number.isFinite(left) && Number.isFinite(top), "PDF.js view coordinates must be finite");
  return {
    kind: "available",
    page: pageNumber,
    zoom: scale / 100,
    x: Math.round(left),
    y: Math.round(top),
  };
}

// The copy-link menu is a reading-surface feature; library pages have no
// document and no menu markup.
if (launch.kind === "takeover") {
  const moreMenu = document.getElementById("more-menu");
  assert(moreMenu instanceof HTMLElement, "MathRead actions menu is missing");
  wireCopyMenu(moreMenu);
}

function wireCopyMenu(moreMenu) {
  document.getElementById("toggle-more").addEventListener("click", () => {
    moreMenu.hidden = !moreMenu.hidden;
  });

// Reference-conformant copy (Scholar reader mechanism): a copy-event listener
// with clipboardData.setData under the click's user activation. The takeover
// iframe has no Permissions-Policy clipboard delegation, so the asynchronous
// Clipboard API is unavailable here by design.
function copyText(text) {
  const onCopy = (event) => {
    event.clipboardData.setData("text/plain", text);
    event.preventDefault();
  };
  document.addEventListener("copy", onCopy, { once: true });
  const copied = document.execCommand("copy");
  assert(copied, "MathRead copy command was rejected");
}

  document.querySelector('[data-action="copy-plain-link"]').addEventListener("click", async () => {
    const source = await sourceUrl();
    copyText(source.href);
    moreMenu.hidden = true;
  });

  document.querySelector('[data-action="copy-view-link"]').addEventListener("click", async () => {
    const source = await sourceUrl();
    const view = currentPdfView();
    // Standard PDF open-parameters fragment: any viewer, including Chrome's
    // native one and PDF.js, lands on the right page without MathRead.
    source.hash = `page=${view.page}&zoom=${Math.round(view.zoom * 100)},${view.x},${view.y}`;
    copyText(source.href);
    moreMenu.hidden = true;
  });
}

async function sourceUrl() {
  assert(launch.kind === "takeover", "A source link requires an open document");
  return new URL(launch.sourceUrl);
}

function currentPdfView() {
  switch (pdfViewerState.kind) {
    case "awaiting":
      throw new Error("PDF.js viewer has not initialized");
    case "ready":
      pdfViewerState.pdfViewer.update();
      break;
  }
  switch (currentPdfViewState.kind) {
    case "available":
      return currentPdfViewState;
    case "awaiting":
      throw new Error("PDF.js has not published a current view");
  }
}
