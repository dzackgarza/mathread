import {
  captureRequestForClickedPdfLink,
  type CaptureModeStorage,
  isLikelyPdfUrl,
  rememberPdfLinkOrigin,
  runtimeCaptureMessage,
  storedCaptureMode,
} from "./capture-client";

type ChromeRuntime = {
  runtime: {
    sendMessage(message: unknown): Promise<unknown>;
  };
  storage: {
    local: CaptureModeStorage;
  };
};

declare const chrome: ChromeRuntime;

void capturePdfFromCurrentDocument();
document.addEventListener(
  "DOMContentLoaded",
  () => {
    void capturePdfFromCurrentDocument();
  },
  true,
);

document.addEventListener(
  "click",
  event => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    void captureClickedPdfLink(target);
  },
  true,
);

async function captureClickedPdfLink(target: Element): Promise<void> {
  const anchor = target.closest<HTMLAnchorElement>("a[href]");
  if (anchor === null) {
    return;
  }

  const request = captureRequestForClickedPdfLink(
    anchor.href,
    location.href,
    document.title,
  );
  if (!isLikelyPdfUrl(request.pdf_url)) {
    return;
  }

  await rememberPdfLinkOrigin(chrome.storage.local, request);
  if (await storedCaptureMode(chrome.storage.local) === "automatic") {
    void chrome.runtime.sendMessage(runtimeCaptureMessage(request));
    return;
  }
}

async function capturePdfFromCurrentDocument(): Promise<void> {
  if (await storedCaptureMode(chrome.storage.local) !== "automatic") {
    return;
  }

  if (document.contentType.toLowerCase() !== "application/pdf") {
    return;
  }

  const request = captureRequestForClickedPdfLink(
    document.location.href,
    document.referrer || document.location.href,
    document.title,
  );

  if (!isLikelyPdfUrlForCurrentDocument(document.location.href)) {
    return;
  }

  void chrome.runtime.sendMessage(runtimeCaptureMessage(request));
}

function isLikelyPdfUrlForCurrentDocument(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}
