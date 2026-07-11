import {
  type CaptureRequest,
  type CaptureResult,
  type RuntimeCaptureMessage,
  type RuntimeCaptureResponse,
  captureBytesEndpointFromManifest,
  postCaptureBytes,
} from "./capture-client";

type ChromeApi = {
  runtime: {
    getManifest(): { host_permissions?: string[] };
    getURL(path: string): string;
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
  action: {
    onClicked: {
      addListener(listener: () => void): void;
    };
  };
  tabs: {
    create(properties: { url: string }): Promise<unknown>;
  };
};

type UnknownRecord = Record<string, unknown>;

const captureCooldownMs = 3_000;
const inFlightCaptures = new Map<string, Promise<CaptureResult>>();
const recentSuccessfulCaptures = new Map<
  string,
  { capturedAtMs: number; result: CaptureResult }
>();

declare const chrome: ChromeApi;

chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({ url: chrome.runtime.getURL("reader/reader.html") });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isCaptureMessage(message)) {
    return undefined;
  }
  void capturePdf(message.request)
    .then((result) => {
      sendResponse({ ok: true, result });
    })
    .catch((error) => {
      sendResponse({ ok: false, error: String(error) });
    });
  return true;
});

async function capturePdf(request: CaptureRequest): Promise<CaptureResult> {
  const now = Date.now();
  const lastCapture = recentSuccessfulCaptures.get(request.pdf_url);
  if (
    lastCapture !== undefined &&
    now - lastCapture.capturedAtMs < captureCooldownMs
  ) {
    return lastCapture.result;
  }

  const inFlightCapture = inFlightCaptures.get(request.pdf_url);
  if (inFlightCapture !== undefined) {
    return inFlightCapture;
  }

  const capture = capturePdfOnce(request);
  inFlightCaptures.set(request.pdf_url, capture);
  try {
    const result = await capture;
    recentSuccessfulCaptures.set(request.pdf_url, {
      capturedAtMs: Date.now(),
      result,
    });
    return result;
  } finally {
    inFlightCaptures.delete(request.pdf_url);
  }
}

async function capturePdfOnce(request: CaptureRequest): Promise<CaptureResult> {
  const response = await fetch(request.pdf_url, { credentials: "include" });
  if (!response.ok) {
    throw new Error(
      `Fetch failed for ${request.pdf_url}: ${response.status} ${response.statusText}`,
    );
  }
  const pdfBytes = await response.arrayBuffer();

  const filename = filenameFromUrl(request.pdf_url);
  return postCaptureBytes(
    request,
    pdfBytes,
    filename,
    captureBytesEndpointFromManifest(chrome.runtime.getManifest()),
  );
}

function filenameFromUrl(pdfUrl: string): string {
  try {
    const pathname = new URL(pdfUrl).pathname;
    const basename = pathname.split("/").pop();
    if (basename !== undefined && basename.length > 0) {
      return basename;
    }
  } catch {
    // Fall through to default.
  }
  return "document.pdf";
}

function isCaptureMessage(value: unknown): value is RuntimeCaptureMessage {
  if (!isRecord(value)) {
    return false;
  }
  if (value.type !== "mathread:capture") {
    return false;
  }
  return isCaptureRequest(value.request);
}

function isCaptureRequest(value: unknown): value is CaptureRequest {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.pdf_url === "string" &&
    typeof value.source_url === "string" &&
    (typeof value.title_hint === "undefined" ||
      typeof value.title_hint === "string")
  );
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}
