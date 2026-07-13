import {
  type CaptureRequest,
  type ExtensionLocalStorage,
  type PdfLinkOrigin,
  libraryKeyFromStoredPath,
  parseRuntimeCaptureResponse,
  pdfUrlFromLocation,
  runtimeCaptureMessage,
  storedPdfLinkOrigin,
} from "./capture-client";

declare const chrome: {
  runtime: {
    getURL(path: string): string;
    sendMessage(message: unknown): Promise<unknown>;
  };
  storage: {
    local: ExtensionLocalStorage;
  };
};

type SourcePdf = {
  pdfUrl: string;
  viewState: string | null;
};

void launchPdf().catch(renderLaunchError);

async function launchPdf(): Promise<void> {
  const rawPdfUrl = pdfUrlFromLocation(location.search, location.pathname);
  assert(rawPdfUrl !== undefined, "MathRead PDF launch URL has no source PDF");
  const sourcePdf = canonicalSourcePdf(rawPdfUrl);
  exposeSourceIdentity(sourcePdf.pdfUrl);
  setSourceLabel(sourcePdf.pdfUrl);

  const storedOrigin = await storedPdfLinkOrigin(
    chrome.storage.local,
    sourcePdf.pdfUrl,
  );
  const request = captureRequest(sourcePdf.pdfUrl, storedOrigin);
  const response = parseRuntimeCaptureResponse(
    await chrome.runtime.sendMessage(runtimeCaptureMessage(request)),
  );
  if (!response.ok) {
    throw new Error(response.error);
  }

  const key = libraryKeyFromStoredPath(response.result.stored_path);
  const readerUrl = new URL(chrome.runtime.getURL("reader/reader.html"));
  readerUrl.searchParams.set("key", key);
  if (sourcePdf.viewState !== null) {
    readerUrl.searchParams.set("mathread-view", sourcePdf.viewState);
  }

  const reader = document.createElement("iframe");
  reader.id = "mathread-reader-frame";
  reader.name = "mathreadReaderFrame";
  reader.title = "MathRead reader";
  reader.allow = "clipboard-write";
  reader.src = readerUrl.href;
  document.body.replaceChildren(reader);
  reader.focus();
}

function captureRequest(
  pdfUrl: string,
  storedOrigin: PdfLinkOrigin | undefined,
): CaptureRequest {
  if (storedOrigin === undefined) {
    return { pdf_url: pdfUrl, source_url: pdfUrl };
  }
  const request: CaptureRequest = {
    pdf_url: pdfUrl,
    source_url: storedOrigin.source_url,
  };
  return storedOrigin.title_hint === undefined
    ? request
    : { ...request, title_hint: storedOrigin.title_hint };
}

function canonicalSourcePdf(rawPdfUrl: string): SourcePdf {
  const url = new URL(rawPdfUrl);
  const linkValues = url.searchParams.getAll("mathread-link");
  const linkValue = linkValues[linkValues.length - 1];
  if (linkValue === undefined || !linkValue.startsWith("v1.")) {
    return { pdfUrl: url.href, viewState: null };
  }
  const payload: unknown = JSON.parse(atob(linkValue.slice(3)));
  assert(
    typeof payload === "object" && payload !== null,
    "MathRead PDF link payload is invalid",
  );
  const { sourceUrl, viewState } = payload as Record<string, unknown>;
  assert(typeof sourceUrl === "string", "MathRead PDF link source is invalid");
  assert(typeof viewState === "string", "MathRead PDF link view state is invalid");
  return { pdfUrl: sourceUrl, viewState };
}

function exposeSourceIdentity(pdfUrl: string): void {
  const visibleUrl = new URL(chrome.runtime.getURL("pdf-launch.html"));
  visibleUrl.searchParams.set("source", pdfUrl);
  history.replaceState(null, "", visibleUrl.href);
}

function setSourceLabel(pdfUrl: string): void {
  const source = document.getElementById("mathread-launch-source");
  assert(source !== null, "MathRead PDF launch source label is missing");
  source.textContent = pdfUrl;
}

function renderLaunchError(error: unknown): void {
  const main = document.getElementById("mathread-pdf-launch");
  assert(main !== null, "MathRead PDF launch surface is missing");
  main.classList.add("failed");

  const heading = main.querySelector("h1");
  assert(heading !== null, "MathRead PDF launch heading is missing");
  heading.textContent = "MathRead could not open this PDF";

  const status = document.getElementById("mathread-launch-status");
  assert(status !== null, "MathRead PDF launch status is missing");
  status.textContent = String(error);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
