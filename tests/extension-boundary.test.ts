import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  chromium,
  type BrowserContext,
  type Frame,
  type Page,
  type Worker,
} from "playwright";

const pdfBytes = new TextEncoder().encode(
  [
    "%PDF-1.4",
    "1 0 obj",
    "<< /Type /Catalog /Pages 2 0 R >>",
    "endobj",
    "2 0 obj",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "endobj",
    "3 0 obj",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] >>",
    "endobj",
    "xref",
    "0 4",
    "0000000000 65535 f ",
    "0000000009 00000 n ",
    "0000000058 00000 n ",
    "0000000115 00000 n ",
    "trailer",
    "<< /Root 1 0 R /Size 4 >>",
    "startxref",
    "190",
    "%%EOF",
    "",
  ].join("\n"),
);

const cookieName = "mathread_session";
const cookieValue = "extension-test";

type ExtensionManifest = {
  host_permissions: string[];
};

type CaptureScenario = "clicked-link" | "direct-pdf-tab" | "direct-pdf-without-extension";

type CaptureArtifacts = {
  root: string;
  backendLogPath: string;
  eventsLogPath: string;
  screenshotBeforePath: string;
  screenshotAfterPath: string;
  tracePath: string;
};

type CourseRequest = {
  path: string;
  referer: string | null;
  cookie: string | null;
};

type ExtensionCaptureEvidence = {
  artifacts: CaptureArtifacts;
  backendCaptureRequestCount: number;
  portalRedirectUrl: string;
  courseOrigin: string;
  courseRequests: CourseRequest[];
  metadata: Record<string, string>;
  storedPath: string;
};

type RunningBackend = {
  process: Bun.Subprocess<"ignore", number, number>;
  logFd: number;
};

type RunningCourseServer = Bun.Server<undefined> & {
  requests: CourseRequest[];
};

type ViewerSurface = Frame | Page;

type PersistedEvent = {
  type: string;
  scenario?: string;
  path?: string;
  referer?: string | null;
  cookie?: string | null;
  storedPath?: string;
  text?: string;
  url?: string;
};

type CaptureRunOptions = {
  preExistingCapture?: boolean;
};

const defaultCaptureRunOptions: CaptureRunOptions = {
  preExistingCapture: false,
};

test("built extension captures a clicked PDF link through the real local backend", async () => {
  const evidence = await runExtensionCapture("clicked-link");
  const expectedCourseUrl = new URL("/course/", evidence.courseOrigin).href;
  const expectedPdfUrl = new URL("/notes.pdf", expectedCourseUrl).href;

  expect(evidence.metadata["/MathReadSourceURL"]).toBe(expectedCourseUrl);
  expect(evidence.metadata["/MathReadPDFURL"]).toBe(expectedPdfUrl);
  expect(evidence.metadata["/MathReadCapture"]).toBe("capture-url");
  expect(evidence.backendCaptureRequestCount).toBe(1);
  expect(evidence.metadata["/MathReadOriginalSHA256"]).toBe(pdfSha256());
  expect(
    evidence.courseRequests.some(request =>
      request.path === "/notes.pdf"
      && request.cookie?.includes(`${cookieName}=${cookieValue}`) === true
      && request.referer === expectedCourseUrl
    ),
  ).toBe(true);
  assertPortalRedirect(evidence);
  assertEvidenceArtifacts(evidence.artifacts, evidence.storedPath, "clicked-link");
}, 20_000);

test("built extension auto-captures a direct PDF and hands the tab to the portal without a manual click", async () => {
  const evidence = await runExtensionCapture("direct-pdf-tab");
  const expectedPath = pdfPathForScenario("direct-pdf-tab");
  const expectedPdfUrl = new URL(expectedPath, evidence.courseOrigin).href;

  expect(evidence.metadata["/MathReadSourceURL"]).toBe(expectedPdfUrl);
  expect(evidence.metadata["/MathReadPDFURL"]).toBe(expectedPdfUrl);
  expect(evidence.metadata["/MathReadCapture"]).toBe("capture-url");
  expect(evidence.backendCaptureRequestCount).toBe(1);
  assertPortalRedirect(evidence);
  assertEvidenceArtifacts(evidence.artifacts, evidence.storedPath, "direct-pdf-tab");
}, 30_000);

test("built extension marks a pre-existing capture as existing and still routes to the portal", async () => {
  const evidence = await runExtensionCapture("direct-pdf-tab", {
    preExistingCapture: true,
  });
  const expectedPath = pdfPathForScenario("direct-pdf-tab");
  const expectedPdfUrl = new URL(expectedPath, evidence.courseOrigin).href;

  expect(evidence.metadata["/MathReadSourceURL"]).toBe(expectedPdfUrl);
  expect(evidence.metadata["/MathReadPDFURL"]).toBe(expectedPdfUrl);
  expect(evidence.metadata["/MathReadCapture"]).toBe("capture-url");
  expect(evidence.backendCaptureRequestCount).toBe(2);
  expect(evidence.metadata["/MathReadOriginalSHA256"]).toBe(pdfSha256());
  expect(
    evidence.courseRequests.some(request =>
      request.path === expectedPath
      && request.cookie?.includes(`${cookieName}=${cookieValue}`) === true
      && request.referer === expectedPdfUrl
    ),
  ).toBe(true);
  assertPortalRedirect(evidence);
  assertEvidenceArtifacts(evidence.artifacts, evidence.storedPath, "direct-pdf-tab");
}, 45_000);

test("built extension auto-captures an application/pdf URL without a .pdf suffix", async () => {
  const evidence = await runExtensionCapture("direct-pdf-without-extension");
  const expectedPath = pdfPathForScenario("direct-pdf-without-extension");
  const expectedPdfUrl = new URL(expectedPath, evidence.courseOrigin).href;

  expect(evidence.metadata["/MathReadSourceURL"]).toBe(expectedPdfUrl);
  expect(evidence.metadata["/MathReadPDFURL"]).toBe(expectedPdfUrl);
  expect(evidence.metadata["/MathReadCapture"]).toBe("capture-url");
  expect(evidence.backendCaptureRequestCount).toBe(1);
  expect(evidence.metadata["/MathReadOriginalSHA256"]).toBe(pdfSha256());
  expect(
    evidence.courseRequests.some(request =>
      request.path === expectedPath
      && request.cookie?.includes(`${cookieName}=${cookieValue}`) === true
      && request.referer === expectedPdfUrl
    ),
  ).toBe(true);
  assertPortalRedirect(evidence);
  assertEvidenceArtifacts(evidence.artifacts, evidence.storedPath, "direct-pdf-without-extension");
}, 30_000);

test("built extension shows backend unavailable when the capture backend is down", async () => {
  await runBackendUnavailable();
}, 30_000);

function assertPortalRedirect(evidence: ExtensionCaptureEvidence): void {
  const redirect = new URL(evidence.portalRedirectUrl);
  expect(redirect.hostname).toBe("markdown-editor.localhost");
  const key = evidence.storedPath.split("/").pop();
  assert(key !== undefined && key !== "");
  expect(redirect.searchParams.get("key")).toBe(key);
}

async function runBackendUnavailable(): Promise<void> {
  const backendPort = await unusedTcpPort();
  const testRoot = mkdtemp("mathread-extension-backend-down-");
  const artifacts = createCaptureArtifacts(testRoot, "clicked-link");
  const extensionPath = configuredExtensionCopy(testRoot, backendPort);
  const courseServer = startCourseServer(artifacts.eventsLogPath);
  const profilePath = join(testRoot, "profile");
  let context: BrowserContext | undefined;

  try {
    context = await chromium.launchPersistentContext(profilePath, {
      executablePath: "/bin/chromium",
      headless: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    const extensionId = await waitForLoadedExtensionId(profilePath, extensionPath);
    await context.addCookies([
      {
        name: cookieName,
        value: cookieValue,
        url: courseServer.url.origin,
      },
    ]);
    const page = await context.newPage();
    attachPageDiagnostics(page, artifacts, "clicked-link");
    const pdfUrl = `${courseServer.url.origin}/notes.pdf`;
    await page.goto(
      `chrome-extension://${extensionId}/content/web/viewer.html?file=${encodeURIComponent(pdfUrl)}`,
      { waitUntil: "domcontentloaded" },
    );
    const viewer = await waitForMathReadViewer(context, page);
    await waitForPdfDocumentLoaded(viewer);

    const buttonText = await waitForCaptureButtonText(viewer, text => text === "Offline");
    const statusText = await waitForCaptureStatusText(viewer, text => text.startsWith("MathRead backend unavailable: "));
    await page.screenshot({ path: artifacts.screenshotAfterPath });
    expect(buttonText).toBe("Offline");
    expect(statusText).toContain("MathRead backend unavailable");
    assertPng(artifacts.screenshotAfterPath);
  } finally {
    if (context !== undefined) {
      await context.close();
    }
    courseServer.stop(true);
  }
}

async function runExtensionCapture(
  scenario: CaptureScenario,
  options: CaptureRunOptions = defaultCaptureRunOptions,
): Promise<ExtensionCaptureEvidence> {
  const backendPort = await unusedTcpPort();
  const testRoot = mkdtemp("mathread-extension-boundary-");
  const readingRoot = join(testRoot, "reading-root");
  mkdirSync(readingRoot);
  const artifacts = createCaptureArtifacts(testRoot, scenario);
  const extensionPath = configuredExtensionCopy(testRoot, backendPort);
  const backend = startMathReadBackend(backendPort, readingRoot, artifacts.backendLogPath);
  const courseServer = startCourseServer(artifacts.eventsLogPath);
  let context: BrowserContext | undefined;
  let traceStarted = false;

  try {
    await waitForHttpService(`http://127.0.0.1:${backendPort}/openapi.json`);
    if (options.preExistingCapture === true) {
      await preCapturePdfThroughBackend(backendPort, courseServer, scenario);
    }

    context = await chromium.launchPersistentContext(join(testRoot, "profile"), {
      executablePath: "/bin/chromium",
      headless: true,
      artifactsDir: artifacts.root,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    if (scenario === "clicked-link") {
      await context.tracing.start({
        screenshots: true,
        snapshots: true,
        sources: true,
        title: `MathRead ${scenario}`,
      });
      traceStarted = true;
    }
    const serviceWorker = await waitForExtensionServiceWorker(context);
    serviceWorker.on("console", message => {
      appendEvent(artifacts.eventsLogPath, {
        type: "service-worker-console",
        scenario,
        text: message.text(),
      });
    });
    appendEvent(artifacts.eventsLogPath, {
      type: "service-worker",
      scenario,
      url: serviceWorker.url(),
    });
    await context.addCookies([
      {
        name: cookieName,
        value: cookieValue,
        url: courseServer.url.origin,
      },
    ]);

    // The portal app is the reader: intercept its origin so the redirect target is
    // asserted without loading the live portal.
    const portalRedirectUrls: string[] = [];
    await context.route(url => url.hostname === "markdown-editor.localhost", route => {
      portalRedirectUrls.push(route.request().url());
      void route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>portal</title>portal",
      });
    });

    const page = await context.newPage();
    attachPageDiagnostics(page, artifacts, scenario);

    if (scenario === "clicked-link") {
      // The realistic flow: clicking a PDF link triggers the extension's DNR redirect
      // into the viewer, which auto-captures and hands the tab to the portal.
      await page.goto(`${courseServer.url.origin}/course/`);
      await page.screenshot({ path: artifacts.screenshotBeforePath });
      await page.getByRole("link", { name: "Notes" }).click();
    } else {
      // Load the viewer directly on the PDF URL. Headless Chromium does not reliably run
      // the extension's DNR raw-PDF interception (clicked-link covers that path); opening
      // the viewer URL deterministically exercises capture-ui's URL-shape handling.
      const extensionId = new URL(serviceWorker.url()).host;
      const pdfUrl = `${courseServer.url.origin}${pdfPathForScenario(scenario)}`;
      await page.goto(
        `chrome-extension://${extensionId}/content/web/viewer.html?file=${encodeURIComponent(pdfUrl)}`,
        { waitUntil: "domcontentloaded" },
      );
    }

    // Capture is automatic and always-on: opening the PDF stores it (no click, no mode
    // toggle), then the viewer hands the tab to the portal at /?key=<stored-filename>.
    await page.waitForURL(url => url.hostname === "markdown-editor.localhost", { timeout: 20_000 });
    const portalRedirectUrl = portalRedirectUrls[0] ?? page.url();
    const storedPath = await waitForStoredPdf(readingRoot);
    await page.screenshot({ path: artifacts.screenshotAfterPath });

    appendEvent(artifacts.eventsLogPath, {
      type: "stored-pdf",
      scenario,
      storedPath,
    });
    const metadata = pdfDocinfo(storedPath);
    const backendCaptureRequestCount = countBackendCaptureRequests(artifacts.backendLogPath);

    return {
      artifacts,
      backendCaptureRequestCount,
      portalRedirectUrl,
      courseOrigin: courseServer.url.origin,
      courseRequests: courseServer.requests,
      metadata,
      storedPath,
    };
  } finally {
    if (context !== undefined) {
      if (traceStarted) {
        await context.tracing.stop({ path: artifacts.tracePath });
      }
      await context.close();
    }
    courseServer.stop(true);
    backend.process.kill();
    await backend.process.exited;
    closeSync(backend.logFd);
  }
}

async function preCapturePdfThroughBackend(
  backendPort: number,
  courseServer: RunningCourseServer,
  scenario: CaptureScenario,
): Promise<void> {
  const pdfUrl = `${courseServer.url.origin}${pdfPathForScenario(scenario)}`;
  const response = await fetch(`http://127.0.0.1:${backendPort}/capture-url`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pdf_url: pdfUrl,
      source_url: pdfUrl,
      headers: {
        referer: pdfUrl,
        cookie: `${cookieName}=${cookieValue}`,
      },
    }),
  });
  expect(response.ok).toBe(true);
}

async function waitForExtensionServiceWorker(context: BrowserContext): Promise<Worker> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const serviceWorker = context
      .serviceWorkers()
      .find(worker => worker.url().startsWith("chrome-extension://"));
    if (serviceWorker !== undefined) {
      return serviceWorker;
    }
    await Bun.sleep(100);
  }
  throw new Error("Timed out waiting for MathRead extension service worker");
}

async function waitForLoadedExtensionId(
  profilePath: string,
  extensionPath: string,
): Promise<string> {
  const preferencesPath = join(profilePath, "Default", "Preferences");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (existsSync(preferencesPath)) {
      const extensionId = loadedExtensionIdFromPreferences(
        readFileSync(preferencesPath, "utf8"),
        extensionPath,
      );
      if (extensionId !== undefined) {
        return extensionId;
      }
    }
    await Bun.sleep(100);
  }
  throw new Error(`Timed out waiting for Chromium profile to register extension at ${extensionPath}`);
}

function loadedExtensionIdFromPreferences(
  source: string,
  extensionPath: string,
): string | undefined {
  const value: unknown = JSON.parse(source);
  assertChromiumPreferences(value);
  for (const [extensionId, settings] of Object.entries(value.extensions.settings)) {
    if (settings.path === extensionPath) {
      return extensionId;
    }
  }
  return undefined;
}

function assertChromiumPreferences(value: unknown): asserts value is {
  extensions: { settings: Record<string, { path?: string }> };
} {
  assert(typeof value === "object" && value !== null);
  const extensions = (value as { extensions?: unknown }).extensions;
  assert(typeof extensions === "object" && extensions !== null);
  const settings = (extensions as { settings?: unknown }).settings;
  assert(typeof settings === "object" && settings !== null);
}

async function waitForCaptureButtonText(
  page: ViewerSurface,
  predicate: (text: string) => boolean,
): Promise<string> {
  const button = page.locator("#mathreadCaptureButton");
  let lastText = "<missing>";
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await button.count() === 0) {
      await Bun.sleep(100);
      continue;
    }
    const text = (await button.textContent())?.trim() ?? "";
    lastText = text;
    if (predicate(text)) {
      return text;
    }
    await Bun.sleep(100);
  }
  throw new Error(`Timed out waiting for MathRead capture button text; last text: ${lastText}`);
}

async function waitForCaptureStatusText(
  page: ViewerSurface,
  predicate: (text: string) => boolean,
): Promise<string> {
  const status = page.locator("#mathreadCaptureStatus");
  let lastText = "<missing>";
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await status.count() === 0) {
      await Bun.sleep(100);
      continue;
    }
    const text = (await status.textContent())?.trim() ?? "";
    lastText = text;
    if (predicate(text)) {
      return text;
    }
    await Bun.sleep(100);
  }
  throw new Error(`Timed out waiting for MathRead capture status text; last text: ${lastText}`);
}

async function waitForMathReadViewer(context: BrowserContext, page: Page): Promise<ViewerSurface> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const viewer = findMathReadViewer(context, page);
    if (viewer !== undefined) {
      await viewer.waitForLoadState("domcontentloaded");
      return viewer;
    }
    await Bun.sleep(100);
  }
  throw new Error(`Timed out waiting for MathRead extension viewer; surfaces: ${viewerSurfaceUrls(context).join(", ")}`);
}

async function waitForPdfDocumentLoaded(page: ViewerSurface): Promise<void> {
  const pageCount = page.locator("#numPages");
  let lastText = "<missing>";
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await pageCount.count() === 0) {
      await Bun.sleep(100);
      continue;
    }
    const text = (await pageCount.textContent())?.trim() ?? "";
    lastText = text;
    if (text.replace(/\D/g, "") === "1") {
      return;
    }
    await Bun.sleep(100);
  }
  throw new Error(`Timed out waiting for PDF.js document load; last page count: ${lastText}`);
}

function findMathReadViewer(context: BrowserContext, currentPage: Page): ViewerSurface | undefined {
  if (isExtensionUrl(currentPage.url())) {
    return currentPage;
  }
  const currentFrame = currentPage.frames().find(frame => isExtensionUrl(frame.url()));
  if (currentFrame !== undefined) {
    return currentFrame;
  }
  for (const candidatePage of context.pages()) {
    if (isExtensionUrl(candidatePage.url())) {
      return candidatePage;
    }
    const candidateFrame = candidatePage.frames().find(frame => isExtensionUrl(frame.url()));
    if (candidateFrame !== undefined) {
      return candidateFrame;
    }
  }
  return undefined;
}

function isExtensionUrl(url: string): boolean {
  if (url.length === 0) {
    return false;
  }
  return new URL(url).protocol === "chrome-extension:";
}

function viewerSurfaceUrls(context: BrowserContext): string[] {
  return context.pages().flatMap(page => [
    page.url(),
    ...page.frames().map(frame => frame.url()),
  ]);
}

function attachPageDiagnostics(
  page: Page,
  artifacts: CaptureArtifacts,
  scenario: CaptureScenario,
): void {
  page.on("console", message => {
    appendEvent(artifacts.eventsLogPath, {
      type: "browser-console",
      scenario,
      text: message.text(),
    });
  });
  page.on("pageerror", error => {
    appendEvent(artifacts.eventsLogPath, {
      type: "browser-pageerror",
      scenario,
      text: String(error),
    });
  });
}

function configuredExtensionCopy(testRoot: string, backendPort: number): string {
  const extensionPath = join(testRoot, "extension");
  cpSync(join(process.cwd(), "dist", "extension"), extensionPath, { recursive: true });

  const manifestPath = join(extensionPath, "manifest.json");
  const manifest = parseExtensionManifest(readFileSync(manifestPath, "utf8"));
  manifest.host_permissions = [
    `http://127.0.0.1:${backendPort}/*`,
    ...manifest.host_permissions.filter(permission => !permission.startsWith("http://127.0.0.1:")),
  ];
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return extensionPath;
}

function parseExtensionManifest(source: string): ExtensionManifest {
  const value: unknown = JSON.parse(source);
  assertExtensionManifest(value);
  return value;
}

function assertExtensionManifest(value: unknown): asserts value is ExtensionManifest {
  assert(typeof value === "object" && value !== null);
  const hostPermissions = (value as { host_permissions?: unknown }).host_permissions;
  assert(Array.isArray(hostPermissions));
  assert(hostPermissions.every(permission => typeof permission === "string"));
}

function startMathReadBackend(
  backendPort: number,
  readingRoot: string,
  backendLogPath: string,
): RunningBackend {
  const logFd = openSync(backendLogPath, "a");
  const process = Bun.spawn(
    [
      "uv",
      "run",
      "mathread",
      "serve",
      "--host",
      "127.0.0.1",
      "--port",
      String(backendPort),
      "--root",
      readingRoot,
    ],
    {
      stdout: logFd,
      stderr: logFd,
    },
  );
  return { process, logFd };
}

function startCourseServer(eventsLogPath: string): RunningCourseServer {
  const requests: CourseRequest[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      const courseRequest = {
        path: url.pathname,
        referer: request.headers.get("referer"),
        cookie: request.headers.get("cookie"),
      };
      requests.push(courseRequest);
      appendEvent(eventsLogPath, {
        type: "course-request",
        path: courseRequest.path,
        referer: courseRequest.referer,
        cookie: courseRequest.cookie,
      });
      if (url.pathname === "/course/") {
        return new Response('<a href="/notes.pdf">Notes</a>', {
          headers: { "content-type": "text/html" },
        });
      }
      if (url.pathname === "/notes.pdf" || url.pathname === "/pdf/2301.12345") {
        if (courseRequest.cookie?.includes(`${cookieName}=${cookieValue}`) !== true) {
          return new Response("missing browser session cookie", { status: 403 });
        }
        return new Response(pdfBytes, {
          headers: { "content-type": "application/pdf" },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  Object.defineProperty(server, "requests", {
    value: requests,
    enumerable: true,
    configurable: true,
    writable: true,
  });
  return server as RunningCourseServer;
}

function createCaptureArtifacts(
  testRoot: string,
  scenario: CaptureScenario,
): CaptureArtifacts {
  const root = join(testRoot, "artifacts", scenario);
  const screenshotDir = join(root, "screenshots");
  mkdirSync(screenshotDir, { recursive: true });

  const artifacts = {
    root,
    backendLogPath: join(root, "backend.log"),
    eventsLogPath: join(root, "events.jsonl"),
    screenshotBeforePath: join(screenshotDir, "before.png"),
    screenshotAfterPath: join(screenshotDir, "after.png"),
    tracePath: join(root, "trace.zip"),
  };
  writeFileSync(artifacts.backendLogPath, "");
  writeFileSync(artifacts.eventsLogPath, "");
  return artifacts;
}

function appendEvent(logPath: string, event: PersistedEvent): void {
  appendFileSync(logPath, `${JSON.stringify(event)}\n`);
}

function assertEvidenceArtifacts(
  artifacts: CaptureArtifacts,
  storedPath: string,
  scenario: CaptureScenario,
): void {
  if (scenario === "clicked-link") {
    assertPng(artifacts.screenshotBeforePath);
    assertZip(artifacts.tracePath);
  }
  assertPng(artifacts.screenshotAfterPath);

  const events = readPersistedEvents(artifacts.eventsLogPath);
  expect(
    events.some(event =>
      event.type === "stored-pdf"
      && event.scenario === scenario
      && event.storedPath === storedPath
    ),
  ).toBe(true);
  expect(
    events.some(event =>
      event.type === "course-request"
      && event.path === pdfPathForScenario(scenario)
      && event.cookie?.includes(`${cookieName}=${cookieValue}`) === true
    ),
  ).toBe(true);
}

function countBackendCaptureRequests(backendLogPath: string): number {
  return readFileSync(backendLogPath, "utf8")
    .split("\n")
    .filter(line => line.includes('"POST /capture-url HTTP/1.1" 200 OK'))
    .length;
}

function assertPng(path: string): void {
  const bytes = readFileSync(path);
  expect(Array.from(bytes.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(statSync(path).size).toBeGreaterThan(100);
}

function assertZip(path: string): void {
  const bytes = readFileSync(path);
  expect(bytes.subarray(0, 2).toString("utf8")).toBe("PK");
  expect(statSync(path).size).toBeGreaterThan(100);
}

function readPersistedEvents(logPath: string): PersistedEvent[] {
  return readFileSync(logPath, "utf8")
    .trim()
    .split("\n")
    .filter(line => line !== "")
    .map(line => {
      const value: unknown = JSON.parse(line);
      assertPersistedEvent(value);
      return value;
    });
}

function assertPersistedEvent(value: unknown): asserts value is PersistedEvent {
  assert(typeof value === "object" && value !== null);
  const type = (value as { type?: unknown }).type;
  assert(typeof type === "string");
}

function pdfSha256(): string {
  return createHash("sha256").update(pdfBytes).digest("hex");
}

function pdfPathForScenario(scenario: CaptureScenario): string {
  if (scenario === "direct-pdf-without-extension") {
    return "/pdf/2301.12345";
  }
  return "/notes.pdf";
}

async function waitForHttpService(url: string): Promise<void> {
  const result = Bun.spawnSync([
    "curl",
    "--fail",
    "--silent",
    "--show-error",
    "--output",
    "/dev/null",
    "--retry",
    "50",
    "--retry-connrefused",
    "--retry-delay",
    "0",
    "--retry-max-time",
    "10",
    url,
  ]);
  assert.equal(result.exitCode, 0, result.stderr.toString());
}

async function waitForStoredPdf(readingRoot: string): Promise<string> {
  const inbox = join(readingRoot, "inbox");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (existsSync(inbox)) {
      const pdfs = readdirSync(inbox)
        .filter(filename => filename.endsWith(".pdf"))
        .map(filename => join(inbox, filename));
      if (pdfs.length > 0) {
        assert.equal(pdfs.length, 1);
        const storedPath = pdfs[0];
        assert(storedPath !== undefined);
        return storedPath;
      }
    }
    await Bun.sleep(100);
  }
  throw new Error(`MathRead backend did not store a PDF under ${inbox}`);
}

function pdfDocinfo(storedPath: string): Record<string, string> {
  const result = Bun.spawnSync([
    "uv",
    "run",
    "python",
    "-c",
    [
      "import json",
      "import sys",
      "import pikepdf",
      "with pikepdf.open(sys.argv[1]) as pdf:",
      "    print(json.dumps({str(key): str(value) for key, value in pdf.docinfo.items()}))",
    ].join("\n"),
    storedPath,
  ]);
  assert.equal(result.exitCode, 0, result.stderr.toString());
  const value: unknown = JSON.parse(result.stdout.toString());
  assertRecordOfStrings(value);
  return value;
}

function assertRecordOfStrings(value: unknown): asserts value is Record<string, string> {
  assert(typeof value === "object" && value !== null);
  assert(
    Object.values(value).every(item => typeof item === "string"),
    "PDF docinfo must be a string-valued object",
  );
}

function unusedTcpPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert(typeof address === "object" && address !== null);
      const port = address.port;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

function mkdtemp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}
