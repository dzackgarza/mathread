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
import { chromium, type BrowserContext, type Frame, type Page } from "playwright";

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
  screenshotReadinessPath: string;
  screenshotAfterPath: string;
  tracePath: string;
  videoDir: string;
};

type CourseRequest = {
  path: string;
  referer: string | null;
  cookie: string | null;
};

type ExtensionCaptureEvidence = {
  artifacts: CaptureArtifacts;
  captureButtonText: string;
  captureStatusText: string;
  courseOrigin: string;
  courseRequests: CourseRequest[];
  metadata: Record<string, string>;
  readinessStatusText: string;
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

test("built extension captures a clicked PDF link through the real local backend", async () => {
  const evidence = await runExtensionCapture("clicked-link");
  const expectedCourseUrl = new URL("/course/", evidence.courseOrigin).href;
  const expectedPdfUrl = new URL("/notes.pdf", expectedCourseUrl).href;

  expect(evidence.metadata["/MathReadSourceURL"]).toBe(expectedCourseUrl);
  expect(evidence.metadata["/MathReadPDFURL"]).toBe(expectedPdfUrl);
  expect(evidence.metadata["/MathReadCapture"]).toBe("capture-url");
  expect(evidence.readinessStatusText).toContain("Storage: ready");
  expect(evidence.captureButtonText).toBe("Captured");
  expect(evidence.captureStatusText).toContain(evidence.storedPath);
  expect(evidence.metadata["/MathReadOriginalSHA256"]).toBe(pdfSha256());
  expect(
    evidence.courseRequests.some(request =>
      request.path === "/notes.pdf"
      && request.cookie?.includes(`${cookieName}=${cookieValue}`) === true
      && request.referer === expectedCourseUrl
    ),
  ).toBe(true);
  assertEvidenceArtifacts(evidence.artifacts, evidence.storedPath, "clicked-link");
}, 20_000);

test("built extension captures a direct PDF tab through the real local backend", async () => {
  const evidence = await runExtensionCapture("direct-pdf-tab");
  const expectedPath = pdfPathForScenario("direct-pdf-tab");
  const expectedPdfUrl = new URL(expectedPath, evidence.courseOrigin).href;

  expect(evidence.metadata["/MathReadSourceURL"]).toBe(expectedPdfUrl);
  expect(evidence.metadata["/MathReadPDFURL"]).toBe(expectedPdfUrl);
  expect(evidence.metadata["/MathReadCapture"]).toBe("capture-url");
  expect(evidence.captureButtonText).toBe("Captured");
  expect(evidence.captureStatusText).toContain(evidence.storedPath);
  expect(evidence.metadata["/MathReadOriginalSHA256"]).toBe(pdfSha256());
  expect(
    evidence.courseRequests.some(request =>
      request.path === expectedPath
      && request.cookie?.includes(`${cookieName}=${cookieValue}`) === true
      && request.referer === expectedPdfUrl
    ),
  ).toBe(true);
  assertEvidenceArtifacts(evidence.artifacts, evidence.storedPath, "direct-pdf-tab");
}, 30_000);

test("built extension captures an application/pdf URL without a .pdf suffix", async () => {
  const evidence = await runExtensionCapture("direct-pdf-without-extension");
  const expectedPath = pdfPathForScenario("direct-pdf-without-extension");
  const expectedPdfUrl = new URL(expectedPath, evidence.courseOrigin).href;

  expect(evidence.metadata["/MathReadSourceURL"]).toBe(expectedPdfUrl);
  expect(evidence.metadata["/MathReadPDFURL"]).toBe(expectedPdfUrl);
  expect(evidence.metadata["/MathReadCapture"]).toBe("capture-url");
  expect(evidence.captureButtonText).toBe("Captured");
  expect(evidence.captureStatusText).toContain(evidence.storedPath);
  expect(evidence.metadata["/MathReadOriginalSHA256"]).toBe(pdfSha256());
  expect(
    evidence.courseRequests.some(request =>
      request.path === expectedPath
      && request.cookie?.includes(`${cookieName}=${cookieValue}`) === true
      && request.referer === expectedPdfUrl
    ),
  ).toBe(true);
  assertEvidenceArtifacts(evidence.artifacts, evidence.storedPath, "direct-pdf-without-extension");
}, 30_000);

test("built extension shows backend unavailable when capture backend is down", async () => {
  const backendPort = await unusedTcpPort();
  const testRoot = mkdtemp("mathread-extension-backend-down-");
  const artifacts = createCaptureArtifacts(testRoot, "clicked-link");
  const extensionPath = configuredExtensionCopy(testRoot, backendPort);
  const courseServer = startCourseServer(artifacts.eventsLogPath);
  let context: BrowserContext | undefined;

  try {
    context = await chromium.launchPersistentContext(join(testRoot, "profile"), {
      executablePath: "/bin/chromium",
      headless: true,
      artifactsDir: artifacts.root,
      recordVideo: { dir: artifacts.videoDir },
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    await context.addCookies([
      {
        name: cookieName,
        value: cookieValue,
        url: courseServer.url.origin,
      },
    ]);
    const page = await context.newPage();
    await page.goto(`${courseServer.url.origin}/notes.pdf`, { waitUntil: "domcontentloaded" });
    const viewer = await waitForMathReadViewer(context, page);

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
}, 30_000);

async function runExtensionCapture(
  scenario: CaptureScenario,
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

    context = await chromium.launchPersistentContext(join(testRoot, "profile"), {
      executablePath: "/bin/chromium",
      headless: true,
      artifactsDir: artifacts.root,
      recordVideo: { dir: artifacts.videoDir },
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
    let [serviceWorker] = context.serviceWorkers();
    if (serviceWorker === undefined) {
      serviceWorker = await context.waitForEvent("serviceworker");
    }
    assert(serviceWorker.url().startsWith("chrome-extension://"));
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
    let page = await context.newPage();
    attachPageDiagnostics(page, artifacts, scenario);

    if (scenario === "clicked-link") {
      await page.goto(`${courseServer.url.origin}/course/`);
      await page.screenshot({ path: artifacts.screenshotBeforePath });
      await page.getByRole("link", { name: "Notes" }).click();
    } else {
      await page.goto(`${courseServer.url.origin}${pdfPathForScenario(scenario)}`, {
        waitUntil: "domcontentloaded",
      });
    }
    const viewer = await waitForMathReadViewer(context, page);
    await waitForCaptureButtonText(viewer, text => text === "Capture");
    const readinessStatusText = await waitForCaptureStatusText(viewer, text =>
      text.includes(`Backend: http://127.0.0.1:${backendPort}`)
      && text.includes(`Root: ${readingRoot}`)
      && text.includes(`Inbox: ${join(readingRoot, "inbox")}`)
      && text.includes("Storage: ready")
    );
    await page.screenshot({ path: artifacts.screenshotReadinessPath });
    await viewer.locator("#mathreadCaptureButton").click();
    const storedPath = await waitForStoredPdf(readingRoot);
    const captureButtonText = await waitForCaptureButtonText(viewer, text => text === "Captured");
    const captureStatusText = await waitForCaptureStatusText(viewer, text => text.includes(storedPath));
    await page.screenshot({ path: artifacts.screenshotAfterPath });
    appendEvent(artifacts.eventsLogPath, {
      type: "stored-pdf",
      scenario,
      storedPath,
    });
    const metadata = pdfDocinfo(storedPath);

    return {
      artifacts,
      captureButtonText,
      captureStatusText,
      courseOrigin: courseServer.url.origin,
      courseRequests: courseServer.requests,
      metadata,
      readinessStatusText,
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
  const videoDir = join(root, "videos");
  mkdirSync(screenshotDir, { recursive: true });
  mkdirSync(videoDir, { recursive: true });

  const artifacts = {
    root,
    backendLogPath: join(root, "backend.log"),
    eventsLogPath: join(root, "events.jsonl"),
    screenshotBeforePath: join(screenshotDir, "before.png"),
    screenshotReadinessPath: join(screenshotDir, "readiness.png"),
    screenshotAfterPath: join(screenshotDir, "after.png"),
    tracePath: join(root, "trace.zip"),
    videoDir,
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
  assertPng(artifacts.screenshotReadinessPath);
  assertPng(artifacts.screenshotAfterPath);
  assertWebmVideo(artifacts.videoDir);

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

function assertWebmVideo(videoDir: string): void {
  const videos = readdirSync(videoDir)
    .filter(filename => filename.endsWith(".webm"))
    .map(filename => join(videoDir, filename));
  expect(videos.length).toBeGreaterThanOrEqual(1);
  const [videoPath] = videos;
  assert(videoPath !== undefined);
  const bytes = readFileSync(videoPath);
  expect(Array.from(bytes.subarray(0, 4))).toEqual([26, 69, 223, 163]);
  expect(statSync(videoPath).size).toBeGreaterThan(100);
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
