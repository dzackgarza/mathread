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

const runtimeCaptureTimeoutMs = 30_000;

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
    await sendCaptureMessage(runtimeCaptureMessage(request)),
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

async function sendCaptureMessage(message: unknown): Promise<unknown> {
  return Promise.race([chrome.runtime.sendMessage(message), captureTimeout()]);
}

function captureTimeout(): Promise<never> {
  return new Promise((_resolve, reject) => {
    setTimeout(() => {
      reject(new Error("MathRead capture request timed out"));
    }, runtimeCaptureTimeoutMs);
  });
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
  const entries = [...url.searchParams.entries()];
  const trailingEntries = trailingMathReadEntries(entries);
  if (trailingEntries === null) {
    return sourcePdfWithoutView(url);
  }
  return sourcePdfFromMathReadLink(url, entries, trailingEntries);
}

function trailingMathReadEntries(entries: [string, string][]) {
  const linkEntry = entries[entries.length - 2];
  const sourceEntry = entries[entries.length - 1];
  if (linkEntry?.[0] !== "mathread-link") {
    return null;
  }
  if (sourceEntry?.[0] !== "mathread-source") {
    return null;
  }
  return { linkEntry, sourceEntry };
}

function sourcePdfFromMathReadLink(
  url: URL,
  entries: [string, string][],
  { linkEntry, sourceEntry }: { linkEntry: [string, string]; sourceEntry: [string, string] },
): SourcePdf {
  const sourceValue = sourceEntry[1];
  if (!sourceValue.startsWith("v1.")) {
    return sourcePdfWithoutView(url);
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(sourceValue.slice(3))) {
    return sourcePdfWithoutView(url);
  }
  if (sourceValue.slice(3).length % 4 !== 0) {
    return sourcePdfWithoutView(url);
  }
  const sourceUrl = atob(sourceValue.slice(3));
  if (!URL.canParse(sourceUrl)) {
    return sourcePdfWithoutView(url);
  }
  const reconstructedSource = urlWithEntries(url.href, entries.slice(0, -2));
  const markedSource = new URL(sourceUrl);
  const normalizedMarkedSource = urlWithEntries(
    sourceUrl,
    [...markedSource.searchParams.entries()],
  );
  if (reconstructedSource.href !== normalizedMarkedSource.href) {
    return sourcePdfWithoutView(url);
  }
  assert(linkEntry[1].startsWith("v1."), "MathRead PDF link view state is invalid");
  const viewState = atob(linkEntry[1].slice(3));
  return { pdfUrl: sourceUrl, viewState };
}

function urlWithEntries(rawUrl: string, entries: [string, string][]): URL {
  const url = new URL(rawUrl);
  url.search = "";
  for (const [name, value] of entries) {
    url.searchParams.append(name, value);
  }
  return url;
}

function sourcePdfWithoutView(url: URL): SourcePdf {
  return { pdfUrl: url.href, viewState: null };
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
