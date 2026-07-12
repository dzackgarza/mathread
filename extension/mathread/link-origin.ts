import {
  captureRequestForClickedPdfLink,
  type ExtensionLocalStorage,
  isLikelyPdfUrl,
  rememberPdfLinkOrigin,
  runtimeCaptureMessage,
} from "./capture-client";
import { loadMathReadSettings } from "./settings";

type ChromeRuntime = {
  runtime: {
    sendMessage(message: unknown): Promise<unknown>;
  };
  storage: {
    local: ExtensionLocalStorage;
  };
};

declare const chrome: ChromeRuntime;

document.addEventListener(
  "click",
  event => {
    const anchor = clickedPdfAnchor(event);
    if (anchor === null) {
      return;
    }
    event.preventDefault();
    void captureClickedPdfLink(anchor);
  },
  true,
);

function clickedPdfAnchor(event: MouseEvent): HTMLAnchorElement | null {
  if (!isUnmodifiedPrimaryClick(event) || !(event.target instanceof Element)) {
    return null;
  }

  const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
  return anchor !== null && isLikelyPdfUrl(anchor.href) ? anchor : null;
}

function isUnmodifiedPrimaryClick(event: MouseEvent): boolean {
  return (
    event.button === 0 &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey
  );
}

async function captureClickedPdfLink(anchor: HTMLAnchorElement): Promise<void> {
  const request = captureRequestForClickedPdfLink(
    anchor.href,
    location.href,
    document.title,
  );
  try {
    if ((await loadMathReadSettings(chrome.storage.local)).autoCapturePdfs) {
      // Complete the source-owning capture before navigation. The DNR launcher can then
      // reuse this result without racing a second request whose only source is the PDF.
      await chrome.runtime.sendMessage(runtimeCaptureMessage(request));
      await rememberPdfLinkOrigin(chrome.storage.local, request);
    }
  } finally {
    location.assign(request.pdf_url);
  }
}
