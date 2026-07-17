/**
 * PDF takeover on the source URL (issue #40, Scholar-reference mechanism,
 * white-room). The tab URL is never touched: this script runs in Chrome's
 * PDF-viewer wrapper document and replaces it with a full-viewport iframe
 * hosting the MathRead reader, handed the document through the vendored
 * PDF.js viewer's native ?file= entrypoint (the upstream extension's own
 * mechanism). Reload, history, and open-parameter fragments remain
 * Chrome-native properties of the source URL.
 */
import {
  type ExtensionLocalStorage,
  type PdfLinkOrigin,
  type CaptureRequest,
  libraryKeyFromStoredPath,
  parseRuntimeCaptureResponse,
  runtimeCaptureMessage,
  storedPdfLinkOrigin,
} from "./capture-client";

declare const chrome: {
  runtime: {
    getURL(path: string): string;
    getManifest(): { permissions?: string[]; host_permissions?: string[] };
    sendMessage(message: unknown): Promise<unknown>;
  };
  storage: { local: ExtensionLocalStorage };
};

type ReaderDocument = {
  key: string;
  sourceUrl: string;
};

const minimumEmbedWidth = 700;
const minimumEmbedHeight = 350;

document.addEventListener(
  "DOMContentLoaded",
  () => {
    if (shouldTakeOver()) {
      void takeOver().catch(renderTakeoverFailure);
    }
  },
  { once: true },
);

function shouldTakeOver(): boolean {
  if (document.contentType.toLowerCase() !== "application/pdf") {
    return false;
  }
  // Escape hatch: #mathread=0 reaches Chrome's native viewer at the same URL.
  const hashParams = new URLSearchParams(location.hash.slice(1));
  if (hashParams.get("mathread") === "0") {
    return false;
  }
  // Small embedded frames keep the native viewer; top-level documents and
  // large frames are reading surfaces.
  if (
    window !== window.parent
    && (window.innerWidth < minimumEmbedWidth
      || window.innerHeight < minimumEmbedHeight)
  ) {
    return false;
  }
  return true;
}

async function takeOver(): Promise<void> {
  const sourceUrl = stripHash(location.href);
  const capture = capturePdf(sourceUrl);
  // The reader iframe fetches the document itself: its ?file= parameter is
  // the vendored PDF.js Chromium viewer's native entrypoint (the upstream
  // extension's own mechanism), and the extension origin holds the host
  // permissions and credentials to fetch the source URL directly.
  const reader = mountReaderFrame(sourceUrl);

  const key = await capture;
  const target = await reader;
  const documentMessage: ReaderDocument = { key, sourceUrl };
  target.postMessage({ type: "mathread:document", ...documentMessage }, "*");

  window.addEventListener("message", (event) => {
    if (event.source !== target) {
      return;
    }
    const data: unknown = event.data;
    if (isViewMessage(data)) {
      // The reader publishes its current view as a standard open-parameters
      // fragment; the source URL's hash is the single canonical view state.
      history.replaceState(history.state, "", `${sourceUrl}${data.hash}`);
    }
  });

  // Printing the wrapper page would print a screenshot of the iframe; forward
  // the shortcut to the reader, whose PDF.js print service renders real pages
  // (the reference ships a dedicated print script for the same reason).
  window.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "p") {
      event.preventDefault();
      target.postMessage({ type: "mathread:print" }, "*");
    }
  });
}

async function capturePdf(sourceUrl: string): Promise<string> {
  const storedOrigin = await storedPdfLinkOrigin(chrome.storage.local, sourceUrl);
  const request = captureRequest(sourceUrl, storedOrigin);
  const response = parseRuntimeCaptureResponse(
    await chrome.runtime.sendMessage(runtimeCaptureMessage(request))
      .catch(async (error: unknown) => {
        throw await describeCaptureFailure(error);
      }),
  );
  if (!response.ok) {
    // A capture that fails inside the worker can also be manifest skew (a
    // permission the loaded extension no longer grants); diagnose either way.
    throw await describeCaptureFailure(new Error(response.error));
  }
  return libraryKeyFromStoredPath(response.result.stored_path);
}

function captureRequest(
  sourceUrl: string,
  storedOrigin: PdfLinkOrigin | undefined,
): CaptureRequest {
  if (storedOrigin === undefined) {
    return { pdf_url: sourceUrl, source_url: sourceUrl };
  }
  const request: CaptureRequest = {
    pdf_url: sourceUrl,
    source_url: storedOrigin.source_url,
  };
  return storedOrigin.title_hint === undefined
    ? request
    : { ...request, title_hint: storedOrigin.title_hint };
}

function mountReaderFrame(sourceUrl: string): Promise<Window> {
  const frame = document.createElement("iframe");
  // The source URL's fragment is forwarded verbatim: PDF.js reads standard
  // open parameters (#page=N&zoom=...) from its own document hash natively.
  frame.src = `${chrome.runtime.getURL("reader/reader.html")}?file=${encodeURIComponent(sourceUrl)}${location.hash}`;
  frame.style.cssText =
    "position:fixed;inset:0;width:100vw;height:100vh;border:none;z-index:2147483647;background:#fff;";
  document.documentElement.style.overflow = "hidden";
  document.body.style.margin = "0";
  document.body.replaceChildren(frame);

  return new Promise((resolve) => {
    window.addEventListener("message", function awaitReady(event) {
      if (
        event.source === frame.contentWindow
        && isReadyMessage(event.data)
      ) {
        window.removeEventListener("message", awaitReady);
        assert(frame.contentWindow !== null, "MathRead reader frame has no window");
        resolve(frame.contentWindow);
      }
    });
  });
}

/**
 * A capture message with no receiver usually means the loaded extension
 * predates the files on disk (Chrome keeps the loaded manifest until the
 * extension is reloaded). Name the fix instead of surfacing a messaging error.
 */
async function describeCaptureFailure(error: unknown): Promise<unknown> {
  const loaded: unknown = chrome.runtime.getManifest();
  const diskResponse = await fetch(chrome.runtime.getURL("manifest.json"));
  assert(diskResponse.ok, "MathRead manifest.json is unreadable on disk");
  const disk: unknown = await diskResponse.json();
  if (manifestGrants(loaded) === manifestGrants(disk)) {
    return error;
  }
  return new Error(
    "The MathRead extension files on disk request different permissions than "
    + "the loaded extension. Reload the extension at chrome://extensions, then "
    + `reopen this PDF. (${String(error)})`,
  );
}

function manifestGrants(manifest: unknown): string {
  assert(
    typeof manifest === "object" && manifest !== null,
    "MathRead manifest must be an object",
  );
  const { permissions, host_permissions } = manifest as {
    permissions?: unknown;
    host_permissions?: unknown;
  };
  return JSON.stringify({
    permissions: permissions ?? [],
    host_permissions: host_permissions ?? [],
  });
}

function renderTakeoverFailure(error: unknown): void {
  const heading = document.createElement("h1");
  heading.textContent = "MathRead could not open this PDF";
  const detail = document.createElement("p");
  detail.textContent = String(error);
  const escape = document.createElement("p");
  escape.textContent =
    "Append #mathread=0 to the URL to read it in the browser's native viewer.";
  document.body.replaceChildren(heading, detail, escape);
}

function stripHash(href: string): string {
  const url = new URL(href);
  url.hash = "";
  return url.href;
}

function isViewMessage(value: unknown): value is { type: string; hash: string } {
  return (
    typeof value === "object"
    && value !== null
    && (value as { type?: unknown }).type === "mathread:view"
    && typeof (value as { hash?: unknown }).hash === "string"
  );
}

function isReadyMessage(value: unknown): boolean {
  return (
    typeof value === "object"
    && value !== null
    && (value as { type?: unknown }).type === "mathread:ready"
  );
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
