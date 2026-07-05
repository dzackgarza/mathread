import {
  captureRequestForClickedPdfLink,
  type ExtensionLocalStorage,
  isBackendServedPdfUrl,
  isLikelyPdfUrl,
  rememberPdfLinkOrigin,
  runtimeCaptureMessage,
} from "./capture-client";
import { loadMathReadSettings } from "./settings";

type ChromeRuntime = {
  runtime: {
    getManifest(): { host_permissions?: string[] };
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
  if (!(await loadMathReadSettings(chrome.storage.local)).autoCapturePdfs) {
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

  // Capture with the click origin as the source immediately. This capture is dispatched
  // at click time — long before the viewer exists — so it wins the pdf_url-keyed dedup
  // against the viewer's own auto-capture, which cannot resolve the true source. Persist
  // the origin afterward as a backup for viewers opened later on the same PDF.
  await chrome.runtime.sendMessage(runtimeCaptureMessage(request));
  await rememberPdfLinkOrigin(chrome.storage.local, request);
}

async function capturePdfFromCurrentDocument(): Promise<void> {
  if (document.contentType.toLowerCase() !== "application/pdf") {
    return;
  }
  // A PDF served from the backend's own /pdf/{key} route (library reopen) is already
  // captured — capturing it again would store the backend's copy as a new item.
  if (isBackendServedPdfUrl(document.location.href, chrome.runtime.getManifest())) {
    return;
  }
  if (!(await loadMathReadSettings(chrome.storage.local)).autoCapturePdfs) {
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

  await chrome.runtime.sendMessage(runtimeCaptureMessage(request));
}

function isLikelyPdfUrlForCurrentDocument(value: string): boolean {
  return URL.canParse(value);
}
