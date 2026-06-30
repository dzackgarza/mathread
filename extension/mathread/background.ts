import {
  type CaptureHeaders,
  type RuntimeCaptureMessage,
  type CaptureUrlRequest,
  captureUrlEndpointFromManifest,
  postCaptureUrl,
} from "./capture-client";

type ChromeCookie = {
  name: string;
  value: string;
};

type ChromeApi = {
  runtime: {
    getManifest(): { host_permissions?: string[] };
    getURL(path: string): string;
    onMessage: {
      addListener(
        listener: (
          message: RuntimeCaptureMessage,
          sender: { tab?: { id?: number; url?: string; title?: string } },
        ) => void,
      ): void;
    };
  };
  tabs: {
    onUpdated: {
      addListener(
        listener: (
          tabId: number,
          changeInfo: { status?: string },
          tab: { url?: string; title?: string },
        ) => void,
      ): void;
    };
  };
  cookies: {
    getAll(details: { url: string }): Promise<ChromeCookie[]>;
  };
};

type UnknownRecord = Record<string, unknown>;

const captureCooldownMs = 3_000;
const inFlightCaptures = new Map<string, Promise<void>>();
const recentSuccessfulCapturesMs = new Map<string, number>();

declare const chrome: ChromeApi;

chrome.runtime.onMessage.addListener(message => {
  if (!isCaptureMessage(message)) {
    return;
  }
  void capturePdfUrl(message.request);
});

chrome.tabs.onUpdated.addListener((_, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || tab.url === undefined) {
    return;
  }

  const captureUrl = capturePdfUrlFromTab(tab.url);
  if (captureUrl === undefined) {
    return;
  }

    void capturePdfUrl({
    pdf_url: captureUrl,
    source_url: captureUrl,
    ...(tab.title === undefined ? {} : { title_hint: tab.title }),
  });
});



async function capturePdfUrl(request: CaptureUrlRequest): Promise<void> {
  const now = Date.now();
  const lastCaptureMs = recentSuccessfulCapturesMs.get(request.pdf_url);
  if (lastCaptureMs !== undefined && now - lastCaptureMs < captureCooldownMs) {
    return;
  }

  const inFlightCapture = inFlightCaptures.get(request.pdf_url);
  if (inFlightCapture !== undefined) {
    await inFlightCapture;
    return;
  }

  const capture = capturePdfUrlOnce(request);
  inFlightCaptures.set(request.pdf_url, capture);
  try {
    await capture;
    recentSuccessfulCapturesMs.set(request.pdf_url, Date.now());
  } finally {
    inFlightCaptures.delete(request.pdf_url);
  }
}

async function capturePdfUrlOnce(request: CaptureUrlRequest): Promise<void> {
  try {
    await postCaptureUrl({
      ...request,
      headers: await requestHeaders(request.pdf_url, request.source_url),
    }, captureUrlEndpointFromManifest(chrome.runtime.getManifest()));
  } catch (error) {
    console.error(`[mathread] capturePdfUrl failed for ${request.pdf_url}: ${String(error)}`);
  }
}

function isCaptureMessage(value: unknown): value is RuntimeCaptureMessage {
  if (!isRecord(value)) {
    return false;
  }
  if (value.type !== "mathread:capture-url") {
    return false;
  }
  return isCaptureRequest(value.request);
}

function isCaptureRequest(value: unknown): value is CaptureUrlRequest {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.pdf_url === "string"
    && typeof value.source_url === "string"
    && (typeof value.title_hint === "undefined" || typeof value.title_hint === "string")
    && (typeof value.headers === "undefined" || isCaptureHeaders(value.headers));
}

function isCaptureHeaders(value: unknown): value is CaptureHeaders {
  if (!isRecord(value)) {
    return false;
  }
  if (typeof value.referer !== "string") {
    return false;
  }
  return (typeof value.cookie === "undefined" || typeof value.cookie === "string");
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

async function requestHeaders(
  pdfUrl: string,
  sourceUrl: string,
): Promise<CaptureHeaders> {
  const cookies = await chrome.cookies.getAll({ url: pdfUrl });
  const headers: CaptureHeaders = { referer: sourceUrl };
  if (cookies.length === 0) {
    return headers;
  }

  return {
    ...headers,
    cookie: cookies.map(cookie => `${cookie.name}=${cookie.value}`).join("; "),
  };
}

function capturePdfUrlFromTab(tabUrl: string): string | undefined {
  const viewerUrl = chrome.runtime.getURL("content/web/viewer.html");
  if (!tabUrl.startsWith(viewerUrl)) {
    return captureUrlFromExtensionChromeScheme(tabUrl) ?? captureUrlFromTopLevelPdfUrl(tabUrl);
  }

  const queryString = new URL(tabUrl).search.slice(1);
  const fileMatch = /(?:^|&)file=([^&]*)/.exec(queryString);
  const fileMatchValue = fileMatch?.[1];
  if (fileMatchValue !== undefined && fileMatchValue.length > 0) {
    const candidate = decodeCandidate(fileMatchValue);
    return parsePdfUrl(candidate);
  }

  if (!queryString.startsWith("DNR:")) {
    return undefined;
  }

  const candidate = decodeCandidate(queryString.slice(4));
  return parsePdfUrl(candidate);
}

function decodeCandidate(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isLikelyPdfUrl(rawUrl: string): boolean {
  try {
    const parsedUrl = new URL(rawUrl);
    return (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:")
      && parsedUrl.pathname.toLowerCase().endsWith(".pdf");
  } catch {
    return false;
  }
}

function parsePdfUrl(rawUrl: string): string | undefined {
  try {
    const parsedUrl = new URL(rawUrl);
    return parsedUrl.href;
  } catch {
    return undefined;
  }
}

function captureUrlFromExtensionChromeScheme(tabUrl: string): string | undefined {
  try {
    const parsedUrl = new URL(tabUrl);
    if (parsedUrl.protocol !== "chrome-extension:") {
      return undefined;
    }

    const candidate = decodeCandidate(parsedUrl.pathname.replace(/^\//, ""));
    if (!/^(?:https?|file):\/\//i.test(candidate)) {
      return undefined;
    }
    return parsePdfUrl(candidate);
  } catch {
    return undefined;
  }
}

function captureUrlFromTopLevelPdfUrl(tabUrl: string): string | undefined {
  if (!isLikelyPdfUrl(tabUrl)) {
    return undefined;
  }
  return tabUrl;
}
