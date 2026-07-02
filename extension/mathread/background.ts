import {
  type CaptureResult,
  type CaptureHeaders,
  type RuntimeCaptureResponse,
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
    onMessage: {
      addListener(
        listener: (
          message: RuntimeCaptureMessage,
          sender: { tab?: { id?: number; url?: string; title?: string } },
          sendResponse: (response: RuntimeCaptureResponse) => void,
        ) => boolean | undefined,
      ): void;
    };
  };
  cookies: {
    getAll(details: { url: string }): Promise<ChromeCookie[]>;
  };
};

type UnknownRecord = Record<string, unknown>;

const captureCooldownMs = 3_000;
const inFlightCaptures = new Map<string, Promise<CaptureResult>>();
const recentSuccessfulCaptures = new Map<string, { capturedAtMs: number; result: CaptureResult }>();

declare const chrome: ChromeApi;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isCaptureMessage(message)) {
    return undefined;
  }
  void capturePdfUrl(message.request)
    .then(result => {
      sendResponse({ ok: true, result });
    })
    .catch(error => {
      sendResponse({ ok: false, error: String(error) });
    });
  return true;
});

async function capturePdfUrl(request: CaptureUrlRequest): Promise<CaptureResult> {
  const now = Date.now();
  const lastCapture = recentSuccessfulCaptures.get(request.pdf_url);
  if (lastCapture !== undefined && now - lastCapture.capturedAtMs < captureCooldownMs) {
    return lastCapture.result;
  }

  const inFlightCapture = inFlightCaptures.get(request.pdf_url);
  if (inFlightCapture !== undefined) {
    return await inFlightCapture;
  }

  const capture = capturePdfUrlOnce(request);
  inFlightCaptures.set(request.pdf_url, capture);
  try {
    const result = await capture;
    recentSuccessfulCaptures.set(request.pdf_url, { capturedAtMs: Date.now(), result });
    return result;
  } finally {
    inFlightCaptures.delete(request.pdf_url);
  }
}

async function capturePdfUrlOnce(request: CaptureUrlRequest): Promise<CaptureResult> {
  return await postCaptureUrl({
    ...request,
    headers: await requestHeaders(request.pdf_url, request.source_url),
  }, captureUrlEndpointFromManifest(chrome.runtime.getManifest()));
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

