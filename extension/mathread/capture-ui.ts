import {
  backendOriginFromManifest,
  type ExtensionLocalStorage,
  isBackendServedPdfUrl,
  isLikelyOriginalPdfUrl,
  pdfUrlFromLocation,
  storedPdfLinkOrigin,
} from "./capture-client";

type MathReadPdfViewerApplication = {
  url: string;
  initializedPromise: Promise<unknown>;
  page: number;
  eventBus?: {
    on(
      eventName: "pagechanging",
      listener: (event: { pageNumber: number }) => void,
    ): void;
  };
  pdfViewer: {
    currentPageNumber: number;
    currentScaleValue: string | null;
  };
};

declare global {
  interface Window {
    PDFViewerApplication?: MathReadPdfViewerApplication;
  }
}

type ChromeRuntime = {
  runtime: {
    getManifest(): { host_permissions?: string[] };
    getURL(path: string): string;
    sendMessage(message: unknown): Promise<unknown>;
  };
  storage: {
    local: ExtensionLocalStorage;
  };
};

declare const chrome: ChromeRuntime;

type CaptureUiConfig = {
  initializationRetryMs: number;
  urlResolutionRetryMs: number;
  urlResolutionMaxRetries: number;
};

type BackendStatus = {
  backend_url: string;
  portal_url: string;
  root: string;
  service: {
    name: string;
    version: string;
  };
  storage: {
    root_exists: boolean;
    root_writable: boolean;
  };
  capabilities: {
    capture: boolean;
    open_file: boolean;
    reveal_file: boolean;
    open_root: boolean;
  };
  ready: boolean;
};

type CaptureResult = {
  stored_path: string;
  original_sha256: string;
  stored_sha256: string;
  pdf_url: string;
  source_url: string;
  capture: "capture-url" | "capture-bytes";
  existing: boolean;
};

type RuntimeCaptureResponse =
  { ok: true; result: CaptureResult } | { ok: false; error: string };

type BackendState =
  | { kind: "checking" }
  | { kind: "ready"; status: BackendStatus }
  | { kind: "unavailable"; error: string };

type CaptureState =
  | { kind: "idle" }
  | { kind: "in-flight" }
  | { kind: "success"; result: CaptureResult }
  | { kind: "failure"; error: string };

const captureUiConfig: CaptureUiConfig = {
  initializationRetryMs: 250,
  urlResolutionRetryMs: 200,
  urlResolutionMaxRetries: 60,
};

let installedCaptureUi = false;
let installedViewerHistoryNavigation = false;
let backendState: BackendState = { kind: "checking" };
let captureState: CaptureState = { kind: "idle" };
let libraryReopenPage = false;
const automaticCapturePdfUrls = new Set<string>();
const viewerPageHistory = {
  backStack: [] as number[],
  forwardStack: [] as number[],
  currentPage: undefined as number | undefined,
  navigating: false,
};

// PDF-document interception lives in reader-swap.ts; this script only serves the
// (retired) vendored-viewer capture UI surface.
void initCaptureUi();

function getPdfUrlFromPage(): string | undefined {
  const fromLocation = pdfUrlFromLocation(
    window.location.search,
    window.location.pathname,
  );
  if (fromLocation !== undefined) {
    return isBackendServedPdfUrl(fromLocation, chrome.runtime.getManifest())
      ? undefined
      : fromLocation;
  }

  const app = window.PDFViewerApplication;
  if (app !== undefined && isLikelyOriginalPdfUrl(app.url)) {
    return isBackendServedPdfUrl(app.url, chrome.runtime.getManifest())
      ? undefined
      : app.url;
  }

  return undefined;
}

async function getCaptureSourceUrl(pdfUrl: string): Promise<string> {
  const storedOrigin = await storedPdfLinkOrigin(chrome.storage.local, pdfUrl);
  if (storedOrigin !== undefined) {
    return storedOrigin.source_url;
  }

  const referrer = document.referrer;
  if (referrer.length > 0) {
    try {
      const referrerUrl = new URL(referrer);
      const pdfDocumentUrl = new URL(pdfUrl);
      const referrerPathname = referrerUrl.pathname;
      if (
        referrerUrl.href !== pdfDocumentUrl.href &&
        referrerPathname !== "/" &&
        referrer !== `${pdfDocumentUrl.origin}/`
      ) {
        return referrer;
      }
    } catch {
      return referrer;
    }
  }
  return pdfUrl;
}

async function resolveCaptureTarget(): Promise<
  { pdfUrl: string; sourceUrl: string } | undefined
> {
  const pdfUrl = getPdfUrlFromPage();
  if (pdfUrl === undefined || pdfUrl.length === 0) {
    return undefined;
  }
  return {
    pdfUrl,
    sourceUrl: await getCaptureSourceUrl(pdfUrl),
  };
}

function installCaptureUi(): void {
  if (installedCaptureUi) {
    return;
  }
  installedCaptureUi = true;

  const observer = new MutationObserver(() => {
    synchronizeCaptureButton();
    synchronizeCopyLinkButtons();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.setInterval(() => {
    synchronizeCaptureButton();
    synchronizeCopyLinkButtons();
  }, captureUiConfig.initializationRetryMs);
  void initializeCaptureButton();
}

async function initCaptureUi(): Promise<void> {
  installCaptureUi();
  const app = window.PDFViewerApplication;
  if (app === undefined) {
    setTimeout(() => {
      void initCaptureUi();
    }, captureUiConfig.initializationRetryMs);
    return;
  }

  await app.initializedPromise;
  installViewerHistoryNavigation(app);
  synchronizeCopyLinkButtons();
}

async function resolveCaptureTargetWithRetries(): Promise<
  | {
      pdfUrl: string;
      sourceUrl: string;
    }
  | undefined
> {
  for (
    let attempt = 0;
    attempt < captureUiConfig.urlResolutionMaxRetries;
    attempt += 1
  ) {
    const resolved = await resolveCaptureTarget();
    if (resolved !== undefined && resolved.pdfUrl.length > 0) {
      return resolved;
    }
    await wait(captureUiConfig.urlResolutionRetryMs);
  }
  return undefined;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function initializeCaptureButton(): Promise<void> {
  for (
    let attempt = 0;
    attempt < captureUiConfig.urlResolutionMaxRetries;
    attempt += 1
  ) {
    if (synchronizeCaptureButton()) {
      if (isCurrentPageBackendServedPdf()) {
        renderLibraryReopenState();
        return;
      }
      await refreshBackendStatus();
      const captureBtn = currentCaptureButton();
      if (captureBtn !== undefined) {
        void triggerAutomaticCapture(captureBtn);
      }
      return;
    }
    await wait(captureUiConfig.initializationRetryMs);
  }
}

function isCurrentPageBackendServedPdf(): boolean {
  const raw =
    pdfUrlFromLocation(window.location.search, window.location.pathname) ??
    rawViewerApplicationUrl();
  return (
    raw !== undefined &&
    isBackendServedPdfUrl(raw, chrome.runtime.getManifest())
  );
}

function rawViewerApplicationUrl(): string | undefined {
  const app = window.PDFViewerApplication;
  return app !== undefined && isLikelyOriginalPdfUrl(app.url)
    ? app.url
    : undefined;
}

function renderLibraryReopenState(): void {
  libraryReopenPage = true;
  const captureBtn = currentCaptureButton();
  if (captureBtn === undefined) {
    return;
  }
  setButtonPresentation(captureBtn, {
    disabled: true,
    text: "Library",
    title: "Opened from the MathRead library",
  });
  renderCaptureStatus("Opened from MathRead library");
}

async function triggerCapture(captureBtn: HTMLButtonElement): Promise<void> {
  const resolved = await resolveCaptureTargetWithRetries();
  if (resolved === undefined) {
    captureState = { kind: "failure", error: "PDF URL unavailable" };
    renderCaptureButton(captureBtn);
    return;
  }
  await captureResolvedPdf(captureBtn, resolved);
}

async function triggerAutomaticCapture(
  captureBtn: HTMLButtonElement,
): Promise<void> {
  if (
    backendState.kind !== "ready" ||
    !backendState.status.capabilities.capture
  ) {
    return;
  }
  if (captureState.kind !== "idle") {
    return;
  }
  const resolved = await resolveCaptureTargetWithRetries();
  if (resolved === undefined) {
    captureState = { kind: "failure", error: "PDF URL unavailable" };
    renderCaptureButton(captureBtn);
    return;
  }
  if (automaticCapturePdfUrls.has(resolved.pdfUrl)) {
    return;
  }
  automaticCapturePdfUrls.add(resolved.pdfUrl);
  await captureResolvedPdf(captureBtn, resolved);
}

async function captureResolvedPdf(
  captureBtn: HTMLButtonElement,
  resolved: { pdfUrl: string; sourceUrl: string },
): Promise<void> {
  captureState = { kind: "in-flight" };
  renderCaptureButton(captureBtn);
  const response = await chrome.runtime.sendMessage({
    type: "mathread:capture",
    request: {
      pdf_url: resolved.pdfUrl,
      source_url: resolved.sourceUrl,
      title_hint: document.title,
    },
  });
  const captureResponse = parseRuntimeCaptureResponse(response);
  if (captureResponse.ok) {
    captureState = { kind: "success", result: captureResponse.result };
    renderCaptureButton(captureBtn);
    return;
  }
  captureState = { kind: "failure", error: captureResponse.error };
  renderCaptureButton(captureBtn);
}

function currentCaptureButton(): HTMLButtonElement | undefined {
  const captureBtn = document.getElementById("mathreadCaptureButton");
  if (!(captureBtn instanceof HTMLButtonElement)) {
    return undefined;
  }
  return captureBtn;
}

function synchronizeCaptureButton(): boolean {
  const captureBtn = document.getElementById("mathreadCaptureButton");
  if (!(captureBtn instanceof HTMLButtonElement)) {
    return false;
  }
  captureBtn.classList.add("mathreadToolbarTextButton");
  if (captureBtn.dataset.mathreadCaptureBound !== "true") {
    captureBtn.dataset.mathreadCaptureBound = "true";
    captureBtn.addEventListener("click", (event) => {
      event.preventDefault();
      void triggerCapture(captureBtn).catch((error) => {
        captureState = { kind: "failure", error: String(error) };
        renderCaptureButton(captureBtn);
      });
    });
  }
  renderCaptureButton(captureBtn);
  return true;
}

function synchronizeCopyLinkButtons(): void {
  const plainLinkButton = document.getElementById(
    "mathreadCopyPlainLinkButton",
  );
  if (plainLinkButton instanceof HTMLButtonElement) {
    synchronizeCopyLinkButton(plainLinkButton, "plain");
  }

  const currentViewButton = document.getElementById(
    "mathreadCopyCurrentViewLinkButton",
  );
  if (currentViewButton instanceof HTMLButtonElement) {
    synchronizeCopyLinkButton(currentViewButton, "current-view");
  }
}

function synchronizeCopyLinkButton(
  button: HTMLButtonElement,
  mode: "plain" | "current-view",
): void {
  button.classList.add("mathreadToolbarTextButton");
  button.disabled = getPdfUrlFromPage() === undefined;
  if (button.dataset.mathreadCopyLinkBound === "true") {
    return;
  }
  button.dataset.mathreadCopyLinkBound = "true";
  button.addEventListener("click", (event) => {
    event.preventDefault();
    void copyPdfLink(mode, button).catch((error) => {
      renderCaptureStatus(`Copy link failed: ${String(error)}`);
    });
  });
}

async function copyPdfLink(
  mode: "plain" | "current-view",
  button: HTMLButtonElement,
): Promise<void> {
  const pdfUrl = getPdfUrlFromPage();
  if (pdfUrl === undefined) {
    throw new Error("PDF URL unavailable");
  }
  const link = mode === "plain" ? pdfUrl : currentViewUrl(pdfUrl);
  await navigator.clipboard.writeText(link);
  button.disabled = false;
  renderCaptureStatus(
    mode === "plain"
      ? "Copied original PDF link"
      : "Copied current PDF view link",
  );
}

function currentViewUrl(pdfUrl: string): string {
  const url = new URL(pdfUrl);
  const app = window.PDFViewerApplication;
  const pageNumber = app === undefined ? undefined : currentViewerPage(app);
  if (pageNumber !== undefined) {
    url.searchParams.set("page", String(pageNumber));
  }
  const scale = app?.pdfViewer.currentScaleValue;
  if (typeof scale === "string" && scale.length > 0) {
    url.searchParams.set("zoom", scale);
  }
  return url.href;
}

function installViewerHistoryNavigation(
  app: MathReadPdfViewerApplication,
): void {
  if (installedViewerHistoryNavigation) {
    return;
  }
  installedViewerHistoryNavigation = true;
  viewerPageHistory.currentPage = currentViewerPage(app);
  app.eventBus?.on("pagechanging", (event) => {
    recordViewerPage(event.pageNumber);
  });
  window.addEventListener(
    "keydown",
    (event) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      navigateViewerHistory(event.key === "ArrowLeft" ? "back" : "forward");
    },
    true,
  );
}

function recordViewerPage(pageNumber: number): void {
  if (!Number.isFinite(pageNumber) || pageNumber < 1) {
    return;
  }
  if (viewerPageHistory.navigating) {
    viewerPageHistory.currentPage = pageNumber;
    return;
  }
  if (viewerPageHistory.currentPage === undefined) {
    viewerPageHistory.currentPage = pageNumber;
    return;
  }
  if (viewerPageHistory.currentPage === pageNumber) {
    return;
  }
  viewerPageHistory.backStack.push(viewerPageHistory.currentPage);
  viewerPageHistory.forwardStack = [];
  viewerPageHistory.currentPage = pageNumber;
}

function navigateViewerHistory(direction: "back" | "forward"): void {
  const app = window.PDFViewerApplication;
  if (app === undefined) {
    return;
  }
  const sourceStack =
    direction === "back"
      ? viewerPageHistory.backStack
      : viewerPageHistory.forwardStack;
  const targetPage = sourceStack.pop();
  if (targetPage === undefined) {
    return;
  }
  const currentPage = viewerPageHistory.currentPage ?? currentViewerPage(app);
  if (currentPage !== undefined) {
    const destinationStack =
      direction === "back"
        ? viewerPageHistory.forwardStack
        : viewerPageHistory.backStack;
    destinationStack.push(currentPage);
  }
  viewerPageHistory.navigating = true;
  viewerPageHistory.currentPage = targetPage;
  app.page = targetPage;
  window.setTimeout(() => {
    viewerPageHistory.navigating = false;
  }, 0);
}

function currentViewerPage(
  app: MathReadPdfViewerApplication,
): number | undefined {
  const pageNumber = app.pdfViewer.currentPageNumber || app.page;
  if (!Number.isFinite(pageNumber) || pageNumber < 1) {
    return undefined;
  }
  return pageNumber;
}

async function refreshBackendStatus(): Promise<void> {
  try {
    const response = await fetch(
      captureStatusEndpointFromManifest(chrome.runtime.getManifest()),
    );
    if (!response.ok) {
      backendState = {
        kind: "unavailable",
        error: `${response.status} ${response.statusText}`,
      };
      synchronizeCaptureButton();
      return;
    }
    const status = parseBackendStatus(await response.json());
    backendState = { kind: "ready", status };
    synchronizeCaptureButton();
  } catch (error) {
    backendState = { kind: "unavailable", error: String(error) };
    synchronizeCaptureButton();
  }
}

function captureStatusEndpointFromManifest(manifest: {
  host_permissions?: string[];
}): string {
  return `${backendOriginFromManifest(manifest)}/status`;
}

function renderBackendChecking(captureBtn: HTMLButtonElement): void {
  setButtonPresentation(captureBtn, {
    disabled: true,
    text: "Checking",
    title: "Checking MathRead backend",
  });
  renderCaptureStatus("MathRead: checking backend");
}

function renderBackendReady(
  captureBtn: HTMLButtonElement,
  status: BackendStatus,
): void {
  setButtonPresentation(captureBtn, {
    disabled: !status.capabilities.capture,
    text: status.capabilities.capture ? "Capture" : "Storage",
    title: status.capabilities.capture
      ? `Capture to ${status.root}`
      : `MathRead storage root is not ready: ${status.root}`,
  });
  renderCaptureStatus(backendReadinessText(status));
}

function renderBackendUnavailable(
  captureBtn: HTMLButtonElement,
  error: string,
): void {
  setButtonPresentation(captureBtn, {
    disabled: true,
    text: "Offline",
    title: `MathRead backend unavailable: ${error}`,
  });
  renderCaptureStatus(`MathRead backend unavailable: ${error}`);
}

function renderCaptureInFlight(captureBtn: HTMLButtonElement): void {
  setButtonPresentation(captureBtn, {
    disabled: true,
    text: "Capturing",
    title: "Capturing PDF to MathRead",
  });
  renderCaptureStatus("Capturing to MathRead...");
}

function renderCaptureSuccess(
  captureBtn: HTMLButtonElement,
  result: CaptureResult,
): void {
  setButtonPresentation(captureBtn, {
    disabled: false,
    text: result.existing ? "Already" : "Captured",
    title: result.stored_path,
  });
  renderCaptureStatus(
    result.existing
      ? `Already captured at ${result.stored_path}`
      : `Captured to ${result.stored_path}`,
  );
}

function renderCaptureFailure(
  captureBtn: HTMLButtonElement,
  error: string,
): void {
  setButtonPresentation(captureBtn, {
    disabled: false,
    text: "Failed",
    title: error,
  });
  renderCaptureStatus(`Capture failed: ${error}`);
}

function renderCaptureButton(captureBtn: HTMLButtonElement): void {
  if (libraryReopenPage) {
    renderLibraryReopenState();
    return;
  }
  if (captureState.kind === "in-flight") {
    renderCaptureInFlight(captureBtn);
    return;
  }
  if (captureState.kind === "success") {
    renderCaptureSuccess(captureBtn, captureState.result);
    return;
  }
  if (captureState.kind === "failure") {
    renderCaptureFailure(captureBtn, captureState.error);
    return;
  }
  if (backendState.kind === "checking") {
    renderBackendChecking(captureBtn);
    return;
  }
  if (backendState.kind === "ready") {
    renderBackendReady(captureBtn, backendState.status);
    return;
  }
  renderBackendUnavailable(captureBtn, backendState.error);
}

function parseBackendStatus(value: unknown): BackendStatus {
  invariant(isRecord(value), "MathRead backend status response must be an object");
  invariant(typeof value.backend_url === "string", "MathRead backend status response must declare backend_url");
  invariant(typeof value.portal_url === "string", "MathRead backend status response must declare portal_url");
  invariant(typeof value.root === "string", "MathRead backend status response must declare root");
  invariant(isRecord(value.service), "MathRead backend status response must declare service");
  invariant(typeof value.service.name === "string", "MathRead backend service status must declare name");
  invariant(typeof value.service.version === "string", "MathRead backend service status must declare version");
  invariant(isRecord(value.storage), "MathRead backend status response must declare storage");
  invariant(typeof value.storage.root_exists === "boolean", "MathRead backend storage status must declare root_exists");
  invariant(typeof value.storage.root_writable === "boolean", "MathRead backend storage status must declare root_writable");
  invariant(isRecord(value.capabilities), "MathRead backend status response must declare capabilities");
  invariant(typeof value.capabilities.capture === "boolean", "MathRead backend capabilities must declare capture");
  invariant(typeof value.capabilities.open_file === "boolean", "MathRead backend capabilities must declare open_file");
  invariant(typeof value.capabilities.reveal_file === "boolean", "MathRead backend capabilities must declare reveal_file");
  invariant(typeof value.capabilities.open_root === "boolean", "MathRead backend capabilities must declare open_root");
  invariant(typeof value.ready === "boolean", "MathRead backend status response must declare ready");
  return {
    backend_url: value.backend_url,
    portal_url: value.portal_url,
    root: value.root,
    service: {
      name: value.service.name,
      version: value.service.version,
    },
    storage: {
      root_exists: value.storage.root_exists,
      root_writable: value.storage.root_writable,
    },
    capabilities: {
      capture: value.capabilities.capture,
      open_file: value.capabilities.open_file,
      reveal_file: value.capabilities.reveal_file,
      open_root: value.capabilities.open_root,
    },
    ready: value.ready,
  };
}

function parseRuntimeCaptureResponse(value: unknown): RuntimeCaptureResponse {
  invariant(isRecord(value), "MathRead capture response must be an object");
  if (value.ok === true) {
    invariant(
      isRecord(value.result),
      "MathRead capture success response must declare result",
    );
    return { ok: true, result: parseCaptureResult(value.result) };
  }
  invariant(value.ok === false, "MathRead capture response must declare ok");
  invariant(
    typeof value.error === "string",
    "MathRead capture failure response must declare error",
  );
  return { ok: false, error: value.error };
}

function parseCaptureResult(value: unknown): CaptureResult {
  invariant(isRecord(value), "MathRead capture result must be an object");
  const capture = value.capture;
  invariant(
    capture === "capture-url" || capture === "capture-bytes",
    "MathRead capture result must declare capture",
  );
  invariant(
    typeof value.stored_path === "string",
    "MathRead capture result must declare stored_path",
  );
  invariant(
    typeof value.original_sha256 === "string",
    "MathRead capture result must declare original_sha256",
  );
  invariant(
    typeof value.stored_sha256 === "string",
    "MathRead capture result must declare stored_sha256",
  );
  invariant(
    typeof value.pdf_url === "string",
    "MathRead capture result must declare pdf_url",
  );
  invariant(
    typeof value.source_url === "string",
    "MathRead capture result must declare source_url",
  );
  invariant(
    typeof value.existing === "boolean",
    "MathRead capture result must declare existing",
  );
  return {
    stored_path: value.stored_path,
    original_sha256: value.original_sha256,
    stored_sha256: value.stored_sha256,
    pdf_url: value.pdf_url,
    source_url: value.source_url,
    capture,
    existing: value.existing,
  };
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function setButtonPresentation(
  captureBtn: HTMLButtonElement,
  state: { disabled: boolean; text: string; title: string },
): void {
  if (captureBtn.disabled !== state.disabled) {
    captureBtn.disabled = state.disabled;
  }
  if (captureBtn.innerText !== state.text) {
    captureBtn.innerText = state.text;
  }
  if (captureBtn.title !== state.title) {
    captureBtn.title = state.title;
  }
}

function backendReadinessText(status: BackendStatus): string {
  const storageState = status.ready ? "ready" : "not ready";
  return [
    status.ready
      ? "MathRead backend ready"
      : "MathRead backend storage not ready",
    `Backend: ${status.backend_url}`,
    `Library folder: ${status.root}`,
    `Storage: ${storageState}`,
    `Folder exists: ${status.storage.root_exists}`,
    `Folder writable: ${status.storage.root_writable}`,
    `Service: ${status.service.name} ${status.service.version}`,
  ].join("\n");
}

function renderCaptureStatus(text: string): void {
  const panel = captureStatusPanel();
  if (panel.innerText !== text) {
    panel.innerText = text;
  }
}

function captureStatusPanel(): HTMLDivElement {
  const existing = document.getElementById("mathreadCaptureStatus");
  if (existing instanceof HTMLDivElement) {
    return existing;
  }

  const panel = document.createElement("div");
  panel.id = "mathreadCaptureStatus";
  panel.setAttribute("role", "status");
  document.body.append(panel);
  return panel;
}
