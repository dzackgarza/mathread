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
