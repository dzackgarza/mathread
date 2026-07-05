// Content script owning PDF interception: when a tab lands on a PDF document, capture it
// to the MathRead backend (deduplicated in background.ts against link-origin's click-time
// capture), then swap the document body for the MathRead reader iframe keyed by the
// backend library key. The address bar keeps the original PDF URL — no navigation happens.
//
// The swap runs on DOMContentLoaded, matching Google Scholar Reader's timing: swapping
// synchronously at document_start leaves Chrome's native PDF viewer painting over the
// swapped DOM.
import {
  type CaptureUrlRequest,
  type ExtensionLocalStorage,
  isBackendServedPdfUrl,
  libraryKeyFromBackendPdfUrl,
  libraryKeyFromStoredPath,
  parseRuntimeCaptureResponse,
  runtimeCaptureMessage,
  storedPdfLinkOrigin,
} from "./capture-client";
import { loadMathReadSettings } from "./settings";

declare const chrome: {
  runtime: {
    getManifest(): { host_permissions?: string[] };
    getURL(path: string): string;
    sendMessage(message: unknown): Promise<unknown>;
  };
  storage: {
    local: ExtensionLocalStorage;
  };
};

document.addEventListener("DOMContentLoaded", () => {
  void interceptPdfDocument().catch(error => {
    mountCaptureError(String(error));
  });
});

async function interceptPdfDocument(): Promise<void> {
  if (document.contentType.toLowerCase() !== "application/pdf") {
    return;
  }

  // View links carry mrpage/mrzoom on the source URL; strip them so capture identity
  // stays the canonical PDF URL, and forward them into the reader as page/zoom.
  const pdfUrl = canonicalPdfUrl(window.location.href);
  if (isBackendServedPdfUrl(pdfUrl, chrome.runtime.getManifest())) {
    // Opened from the library: already captured, the key is the backend filename.
    mountReader(libraryKeyFromBackendPdfUrl(pdfUrl));
    return;
  }

  if (!(await loadMathReadSettings(chrome.storage.local)).autoCapturePdfs) {
    return;
  }

  const response = parseRuntimeCaptureResponse(
    await chrome.runtime.sendMessage(runtimeCaptureMessage(await captureRequest(pdfUrl))),
  );
  if (!response.ok) {
    mountCaptureError(response.error);
    return;
  }
  mountReader(libraryKeyFromStoredPath(response.result.stored_path));
}

async function captureRequest(pdfUrl: string): Promise<CaptureUrlRequest> {
  const storedOrigin = await storedPdfLinkOrigin(chrome.storage.local, pdfUrl);
  const request: CaptureUrlRequest = {
    pdf_url: pdfUrl,
    source_url: storedOrigin?.source_url ?? referrerSourceUrl(pdfUrl),
  };
  // Direct PDF navigations run before the browser sets document.title — a blank
  // hint is no hint.
  const titleHint = (storedOrigin?.title_hint ?? document.title).trim();
  return titleHint.length > 0 ? { ...request, title_hint: titleHint } : request;
}

/** Prefer the referring page as provenance, unless it is just the PDF itself or a site root. */
function referrerSourceUrl(pdfUrl: string): string {
  const referrer = document.referrer;
  if (referrer.length === 0) {
    return pdfUrl;
  }
  try {
    const referrerUrl = new URL(referrer);
    const pdfDocumentUrl = new URL(pdfUrl);
    if (
      referrerUrl.href !== pdfDocumentUrl.href
      && referrerUrl.pathname !== "/"
      && referrer !== `${pdfDocumentUrl.origin}/`
    ) {
      return referrer;
    }
    return pdfUrl;
  } catch {
    return referrer;
  }
}

function canonicalPdfUrl(href: string): string {
  const url = new URL(href);
  url.searchParams.delete("mrpage");
  url.searchParams.delete("mrzoom");
  return url.href;
}

function viewRestoreParams(href: string): string {
  const params = new URL(href).searchParams;
  let restore = "";
  const page = params.get("mrpage");
  if (page !== null) {
    restore += `&page=${encodeURIComponent(page)}`;
  }
  const zoom = params.get("mrzoom");
  if (zoom !== null) {
    restore += `&zoom=${encodeURIComponent(zoom)}`;
  }
  return restore;
}

function mountReader(key: string): void {
  const newBody = document.createElement("body");
  newBody.style.cssText = "margin:0; padding:0; height:100vh; overflow:hidden;";

  const reader = document.createElement("iframe");
  reader.src = `${chrome.runtime.getURL("reader/reader.html")}?key=${encodeURIComponent(key)}`
    + viewRestoreParams(window.location.href);
  reader.name = "mathreadReaderFrame";
  // Cross-origin iframes only get async-clipboard access when the embedder delegates it.
  reader.allow = "clipboard-write";
  reader.style.cssText = "border:none; width:100%; height:100%;";
  reader.title = "MathRead reader";

  newBody.appendChild(reader);
  document.body = newBody;
}

function mountCaptureError(error: string): void {
  const newBody = document.createElement("body");
  newBody.style.cssText = [
    "margin:0",
    "padding:48px",
    "height:100vh",
    "box-sizing:border-box",
    "background:#1f1f1f",
    "color:#eee",
    "font:15px/1.5 system-ui, sans-serif",
  ].join(";");

  const panel = document.createElement("div");
  panel.id = "mathread-capture-error";
  panel.setAttribute("role", "alert");

  const heading = document.createElement("h1");
  heading.textContent = "MathRead could not capture this PDF";
  heading.style.cssText = "font-size:20px; margin:0 0 12px;";

  const detail = document.createElement("pre");
  detail.textContent = error;
  detail.style.cssText = "white-space:pre-wrap; color:#f2b8b5; background:#2a2a2a; padding:12px; border-radius:8px;";

  const hint = document.createElement("p");
  hint.textContent = "Is the MathRead backend running? Start it with `just serve`, then reload this tab.";

  panel.append(heading, detail, hint);
  newBody.appendChild(panel);
  document.body = newBody;
}
