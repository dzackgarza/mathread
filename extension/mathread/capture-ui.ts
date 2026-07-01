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
    getManifest(): { host_permissions?: string[] };
    sendMessage(message: unknown): Promise<unknown>;
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
  root: string;
  inbox: string;
  service: {
    name: string;
    version: string;
  };
  storage: {
    root_exists: boolean;
    root_writable: boolean;
    inbox_exists: boolean;
    inbox_writable: boolean;
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
};

type RuntimeCaptureResponse =
  | { ok: true; result: CaptureResult }
  | { ok: false; error: string };

type BackendState =
  | { kind: "checking" }
  | { kind: "ready"; status: BackendStatus }
  | { kind: "unavailable"; error: string };

type CaptureState =
  | { kind: "idle" }
  | { kind: "in-flight" }
  | { kind: "success"; storedPath: string }
  | { kind: "failure"; error: string };

const captureUiConfig: CaptureUiConfig = {
  initializationRetryMs: 250,
  urlResolutionRetryMs: 200,
  urlResolutionMaxRetries: 60,
};

let installedCaptureUi = false;
let backendState: BackendState = { kind: "checking" };
let captureState: CaptureState = { kind: "idle" };

void initCaptureUi();

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

  const observer = new MutationObserver(() => {
    synchronizeCaptureButton();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.setInterval(() => {
    synchronizeCaptureButton();
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

async function initializeCaptureButton(): Promise<void> {
  for (let attempt = 0; attempt < captureUiConfig.urlResolutionMaxRetries; attempt += 1) {
    if (synchronizeCaptureButton()) {
      await refreshBackendStatus();
      return;
    }
    await wait(captureUiConfig.initializationRetryMs);
  }
}

async function triggerCapture(captureBtn: HTMLButtonElement): Promise<void> {
  const resolved = await resolveCaptureUrlsWithRetries();
  if (resolved === undefined) {
    captureState = { kind: "failure", error: "PDF URL unavailable" };
    renderCaptureButton(captureBtn);
    return;
  }
  captureState = { kind: "in-flight" };
  renderCaptureButton(captureBtn);
  const response = await chrome.runtime.sendMessage({
    type: "mathread:capture-url",
    request: {
      pdf_url: resolved.pdfUrl,
      source_url: resolved.sourceUrl,
      title_hint: document.title,
    },
  });
  const captureResponse = parseRuntimeCaptureResponse(response);
  if (captureResponse.ok) {
    captureState = { kind: "success", storedPath: captureResponse.result.stored_path };
    renderCaptureButton(captureBtn);
    return;
  }
  captureState = { kind: "failure", error: captureResponse.error };
  renderCaptureButton(captureBtn);
}

function synchronizeCaptureButton(): boolean {
  const captureBtn = document.getElementById("mathreadCaptureButton");
  if (!(captureBtn instanceof HTMLButtonElement)) {
    return false;
  }
  if (captureBtn.dataset.mathreadCaptureBound !== "true") {
    captureBtn.dataset.mathreadCaptureBound = "true";
    captureBtn.addEventListener("click", event => {
      event.preventDefault();
      void triggerCapture(captureBtn).catch(error => {
        captureState = { kind: "failure", error: String(error) };
        renderCaptureButton(captureBtn);
      });
    });
  }
  renderCaptureButton(captureBtn);
  return true;
}

async function refreshBackendStatus(): Promise<void> {
  try {
    const response = await fetch(captureStatusEndpointFromManifest(chrome.runtime.getManifest()));
    if (!response.ok) {
      backendState = { kind: "unavailable", error: `${response.status} ${response.statusText}` };
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

function captureStatusEndpointFromManifest(manifest: { host_permissions?: string[] }): string {
  const hostPermissions = manifest.host_permissions;
  invariant(hostPermissions !== undefined, "extension manifest must declare localhost backend host_permissions");
  const backendPermission = hostPermissions.find(permission => permission.startsWith("http://127.0.0.1:"));
  invariant(backendPermission !== undefined, "extension manifest must declare http://127.0.0.1 backend permission");
  invariant(backendPermission.endsWith("/*"), `extension backend permission must end with /*: ${backendPermission}`);
  return `${backendPermission.slice(0, -2)}/status`;
}

function renderBackendChecking(captureBtn: HTMLButtonElement): void {
  setButtonPresentation(captureBtn, {
    disabled: true,
    text: "Checking",
    title: "Checking MathRead backend",
  });
  renderCaptureStatus("MathRead: checking backend");
}

function renderBackendReady(captureBtn: HTMLButtonElement, status: BackendStatus): void {
  setButtonPresentation(captureBtn, {
    disabled: !status.capabilities.capture,
    text: status.capabilities.capture ? "Capture" : "Storage",
    title: status.capabilities.capture
      ? `Capture to ${status.inbox}`
      : `MathRead storage root is not ready: ${status.root}`,
  });
  renderCaptureStatus(backendReadinessText(status));
}

function renderBackendUnavailable(captureBtn: HTMLButtonElement, error: string): void {
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

function renderCaptureSuccess(captureBtn: HTMLButtonElement, storedPath: string): void {
  setButtonPresentation(captureBtn, {
    disabled: false,
    text: "Captured",
    title: storedPath,
  });
  renderCaptureStatus(`Captured to ${storedPath}`);
}

function renderCaptureFailure(captureBtn: HTMLButtonElement, error: string): void {
  setButtonPresentation(captureBtn, {
    disabled: false,
    text: "Failed",
    title: error,
  });
  renderCaptureStatus(`Capture failed: ${error}`);
}

function renderCaptureButton(captureBtn: HTMLButtonElement): void {
  if (captureState.kind === "in-flight") {
    renderCaptureInFlight(captureBtn);
    return;
  }
  if (captureState.kind === "success") {
    renderCaptureSuccess(captureBtn, captureState.storedPath);
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
  invariant(typeof value.root === "string", "MathRead backend status response must declare root");
  invariant(typeof value.inbox === "string", "MathRead backend status response must declare inbox");
  invariant(isRecord(value.service), "MathRead backend status response must declare service");
  invariant(typeof value.service.name === "string", "MathRead backend service status must declare name");
  invariant(typeof value.service.version === "string", "MathRead backend service status must declare version");
  invariant(isRecord(value.storage), "MathRead backend status response must declare storage");
  invariant(typeof value.storage.root_exists === "boolean", "MathRead backend storage status must declare root_exists");
  invariant(typeof value.storage.root_writable === "boolean", "MathRead backend storage status must declare root_writable");
  invariant(typeof value.storage.inbox_exists === "boolean", "MathRead backend storage status must declare inbox_exists");
  invariant(typeof value.storage.inbox_writable === "boolean", "MathRead backend storage status must declare inbox_writable");
  invariant(isRecord(value.capabilities), "MathRead backend status response must declare capabilities");
  invariant(typeof value.capabilities.capture === "boolean", "MathRead backend capabilities must declare capture");
  invariant(typeof value.capabilities.open_file === "boolean", "MathRead backend capabilities must declare open_file");
  invariant(typeof value.capabilities.reveal_file === "boolean", "MathRead backend capabilities must declare reveal_file");
  invariant(typeof value.capabilities.open_root === "boolean", "MathRead backend capabilities must declare open_root");
  invariant(typeof value.ready === "boolean", "MathRead backend status response must declare ready");
  return {
    backend_url: value.backend_url,
    root: value.root,
    inbox: value.inbox,
    service: {
      name: value.service.name,
      version: value.service.version,
    },
    storage: {
      root_exists: value.storage.root_exists,
      root_writable: value.storage.root_writable,
      inbox_exists: value.storage.inbox_exists,
      inbox_writable: value.storage.inbox_writable,
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
    invariant(isRecord(value.result), "MathRead capture success response must declare result");
    invariant(typeof value.result.stored_path === "string", "MathRead capture result must declare stored_path");
    return { ok: true, result: { stored_path: value.result.stored_path } };
  }
  invariant(value.ok === false, "MathRead capture response must declare ok");
  invariant(typeof value.error === "string", "MathRead capture failure response must declare error");
  return { ok: false, error: value.error };
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
    status.ready ? "MathRead backend ready" : "MathRead backend storage not ready",
    `Backend: ${status.backend_url}`,
    `Root: ${status.root}`,
    `Inbox: ${status.inbox}`,
    `Storage: ${storageState}`,
    `Root exists: ${status.storage.root_exists}`,
    `Root writable: ${status.storage.root_writable}`,
    `Inbox exists: ${status.storage.inbox_exists}`,
    `Inbox writable: ${status.storage.inbox_writable}`,
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
  panel.style.position = "fixed";
  panel.style.top = "38px";
  panel.style.right = "12px";
  panel.style.zIndex = "10000";
  panel.style.maxWidth = "min(680px, calc(100vw - 24px))";
  panel.style.padding = "6px 8px";
  panel.style.background = "rgba(255, 255, 255, 0.96)";
  panel.style.border = "1px solid rgba(0, 0, 0, 0.2)";
  panel.style.borderRadius = "4px";
  panel.style.color = "#1f2328";
  panel.style.font = "12px system-ui, sans-serif";
  panel.style.lineHeight = "1.35";
  panel.style.overflowWrap = "anywhere";
  panel.style.boxShadow = "0 2px 6px rgba(0, 0, 0, 0.16)";
  document.body.append(panel);
  return panel;
}
