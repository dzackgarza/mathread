import {
  captureRequestForClickedPdfLink,
  type ExtensionLocalStorage,
  isLikelyPdfUrl,
  rememberPdfLinkOrigin,
  runtimeCaptureMessage,
} from "./capture-client";

type ChromeRuntime = {
  runtime: {
    sendMessage(message: unknown): Promise<unknown>;
  };
  storage: {
    local: ExtensionLocalStorage;
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

  // Capture with the click origin as the source immediately. This capture is dispatched
  // at click time — long before the viewer exists — so it wins the pdf_url-keyed dedup
  // against the viewer's own auto-capture, which cannot resolve the true source. Persist
  // the origin afterward as a backup for viewers opened later on the same PDF.
  void chrome.runtime.sendMessage(runtimeCaptureMessage(request));
  await rememberPdfLinkOrigin(chrome.storage.local, request);
}

async function capturePdfFromCurrentDocument(): Promise<void> {
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
