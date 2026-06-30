type MathReadPdfViewerApplication = {
  url: string;
  initializedPromise: Promise<unknown>;
};

declare global {
  interface Window {
    PDFViewerApplication?: MathReadPdfViewerApplication;
  }
}

type ChromeRuntime = {
  runtime: {
    getManifest(): unknown;
    sendMessage(message: unknown): Promise<unknown>;
  };
};

declare const chrome: ChromeRuntime;

type CaptureUiConfig = {
  initializationRetryMs: number;
  urlResolutionRetryMs: number;
  urlResolutionMaxRetries: number;
  captureMessageRetryMs: number;
  captureMessageMaxRetries: number;
};

const captureUiConfig = captureUiConfigFromManifest(chrome.runtime.getManifest());

void initCaptureUi();

let installedCaptureUi = false;

function isLikelyOriginalPdfUrl(value: string): boolean {
  return /^[-a-zA-Z0-9+.]+:\/\//.test(value) || value.startsWith("file://");
}

function getPdfUrlFromPage(): string | undefined {
  const queryString = window.location.search.slice(1);
  const fileMatch = /(?:^|&)file=([^&]*)/.exec(queryString);
  const fileParam = fileMatch?.[1];
  if (fileParam !== undefined && fileParam.length > 0) {
    const decodedFile = safeDecode(fileParam);
    if (isLikelyOriginalPdfUrl(decodedFile)) {
      return decodedFile;
    }
  }
  if (queryString.startsWith("DNR:")) {
    const dnrFile = safeDecode(queryString.slice(4));
    if (isLikelyOriginalPdfUrl(dnrFile)) {
      return dnrFile;
    }
  }

  const dnrPath = window.location.pathname;
  if (dnrPath.startsWith("/")) {
    const candidate = safeDecode(dnrPath.slice(1));
    if (isLikelyOriginalPdfUrl(candidate)) {
      return candidate;
    }
  }

  const app = window.PDFViewerApplication;
  if (app !== undefined && isLikelyOriginalPdfUrl(app.url)) {
    return app.url;
  }

  return undefined;
}

function getCaptureSourceUrl(pdfUrl: string): string {
  const referrer = document.referrer;
  if (referrer.length > 0) {
    try {
      const referrerUrl = new URL(referrer);
      const pdfDocumentUrl = new URL(pdfUrl);
      const referrerPathname = referrerUrl.pathname;
      if (
        referrerUrl.href !== pdfDocumentUrl.href
        && referrerPathname !== "/"
        && referrer !== `${pdfDocumentUrl.origin}/`
      ) {
        return referrer;
      }
    } catch {
      return referrer;
    }
  }
  return pdfUrl;
}

function resolveCaptureUrls(): { pdfUrl: string; sourceUrl: string } | undefined {
  const pdfUrl = getPdfUrlFromPage();
  if (pdfUrl === undefined || pdfUrl.length === 0) {
    return undefined;
  }
  return {
    pdfUrl,
    sourceUrl: getCaptureSourceUrl(pdfUrl),
  };
}

function installCaptureUi(): void {
  if (installedCaptureUi) {
    return;
  }
  installedCaptureUi = true;

  const triggerCapture = () => {
    const resolved = resolveCaptureUrls();
    if (resolved === undefined) {
      return;
    }
    void sendCaptureMessage({
      type: "mathread:capture-url",
      request: {
        pdf_url: resolved.pdfUrl,
        source_url: resolved.sourceUrl,
        title_hint: document.title,
      },
    }).catch(() => {});
  };

  triggerCapture();

  const captureBtn = document.getElementById("mathreadCaptureButton");
  if (captureBtn) {
    captureBtn.addEventListener("click", () => {
      triggerCapture();

      const originalText = captureBtn.innerText;
      captureBtn.innerText = "Capturing...";
      setTimeout(() => {
        captureBtn.innerText = originalText;
      }, 2000);
    });
  }
}

async function sendCaptureMessage(message: unknown): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < captureUiConfig.captureMessageMaxRetries; attempt += 1) {
    try {
      await chrome.runtime.sendMessage(message);
      return;
    } catch (error) {
      lastError = error;
      await wait(captureUiConfig.captureMessageRetryMs);
    }
  }
  throw lastError;
}

async function initCaptureUi(): Promise<void> {
  const app = window.PDFViewerApplication;
  if (app === undefined) {
    setTimeout(() => {
      void initCaptureUi();
    }, captureUiConfig.initializationRetryMs);
    return;
  }

  await app.initializedPromise;
  const resolved = await resolveCaptureUrlsWithRetries();
  if (resolved === undefined) {
    return;
  }
  installCaptureUi();
}

async function resolveCaptureUrlsWithRetries(): Promise<{
  pdfUrl: string;
  sourceUrl: string;
} | undefined> {
  for (let attempt = 0; attempt < captureUiConfig.urlResolutionMaxRetries; attempt += 1) {
    const resolved = resolveCaptureUrls();
    if (resolved !== undefined && resolved.pdfUrl.length > 0) {
      return resolved;
    }
    await wait(captureUiConfig.urlResolutionRetryMs);
  }
  return undefined;
}

function captureUiConfigFromManifest(manifest: unknown): CaptureUiConfig {
  invariant(isRecord(manifest), "extension manifest must be an object");
  const mathread = manifest.mathread;
  invariant(isRecord(mathread), "extension manifest must declare mathread config");
  const captureUi = mathread.capture_ui;
  invariant(isRecord(captureUi), "extension manifest must declare mathread.capture_ui config");

  return {
    initializationRetryMs: requiredPositiveInteger(
      captureUi.initialization_retry_ms,
      "mathread.capture_ui.initialization_retry_ms",
    ),
    urlResolutionRetryMs: requiredPositiveInteger(
      captureUi.url_resolution_retry_ms,
      "mathread.capture_ui.url_resolution_retry_ms",
    ),
    urlResolutionMaxRetries: requiredPositiveInteger(
      captureUi.url_resolution_max_retries,
      "mathread.capture_ui.url_resolution_max_retries",
    ),
    captureMessageRetryMs: requiredPositiveInteger(
      captureUi.capture_message_retry_ms,
      "mathread.capture_ui.capture_message_retry_ms",
    ),
    captureMessageMaxRetries: requiredPositiveInteger(
      captureUi.capture_message_max_retries,
      "mathread.capture_ui.capture_message_max_retries",
    ),
  };
}

function requiredPositiveInteger(value: unknown, key: string): number {
  invariant(
    typeof value === "number" && Number.isInteger(value) && value > 0,
    `extension manifest ${key} must be a positive integer`,
  );
  return value;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
