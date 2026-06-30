import {
  captureRequestForClickedPdfLink,
  isLikelyPdfUrl,
  runtimeCaptureMessage,
} from "./capture-client";

type ChromeRuntime = {
  runtime: {
    sendMessage(message: unknown): Promise<unknown>;
  };
};

declare const chrome: ChromeRuntime;

capturePdfFromCurrentDocument();
document.addEventListener(
  "DOMContentLoaded",
  () => {
    capturePdfFromCurrentDocument();
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

    void chrome.runtime.sendMessage(runtimeCaptureMessage(request));
  },
  true,
);

function capturePdfFromCurrentDocument(): void {
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
