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
    if (
      event.button !== 0 ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    ) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const anchor = target.closest<HTMLAnchorElement>("a[href]");
    if (anchor === null || !isLikelyPdfUrl(anchor.href)) {
      return;
    }
    event.preventDefault();
    void captureClickedPdfLink(anchor);
  },
  true,
);

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
