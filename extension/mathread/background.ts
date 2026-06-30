import {
  type CaptureHeaders,
  type CaptureUrlRequest,
  captureUrlEndpointFromManifest,
  isLikelyPdfUrl,
  postCaptureUrl,
} from "./capture-client";

type RuntimeMessage = {
  type: "mathread:capture-url";
  request: CaptureUrlRequest;
};

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
          message: unknown,
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

declare const chrome: ChromeApi;

chrome.runtime.onMessage.addListener(message => {
  void handleRuntimeMessage(message);
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || tab.url === undefined) {
    return;
  }
  if (!isLikelyPdfUrl(tab.url)) {
    return;
  }

  void capturePdfUrl({
    pdf_url: tab.url,
    source_url: tab.url,
    ...(tab.title === undefined ? {} : { title_hint: tab.title }),
  });
});

async function handleRuntimeMessage(message: unknown): Promise<void> {
  assertRuntimeMessage(message);
  await capturePdfUrl(message.request);
}

async function capturePdfUrl(request: CaptureUrlRequest): Promise<void> {
  await postCaptureUrl({
    ...request,
    headers: await requestHeaders(request.pdf_url, request.source_url),
  }, captureUrlEndpointFromManifest(chrome.runtime.getManifest()));
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

function assertRuntimeMessage(
  message: unknown,
): asserts message is RuntimeMessage {
  invariant(
    typeof message === "object" && message !== null,
    "runtime message must be an object",
  );
  invariant(
    (message as RuntimeMessage).type === "mathread:capture-url",
    "runtime message type must be mathread:capture-url",
  );
  invariant(
    typeof (message as RuntimeMessage).request?.pdf_url === "string",
    "runtime message request.pdf_url must be a string",
  );
  invariant(
    typeof (message as RuntimeMessage).request?.source_url === "string",
    "runtime message request.source_url must be a string",
  );
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
