// End-to-end proof of the extension boundary: opening a PDF in a tab auto-captures it to
// the real local backend and swaps the document body for the MathRead reader iframe keyed
// by the backend library key, while the address bar keeps the original PDF URL. The
// reader's Key Points panel persists notes to the on-disk markdown sidecar and the
// Library panel lists/opens/trashes captured items against the same backend.
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
const documentControlIds = [
  "prev-page",
  "next-page",
  "page-input",
  "zoom-out",
  "zoom-in",
  "fit-width",
  "rotate",
  "download",
];

type ExtensionManifest = {
  host_permissions: string[];
};

type CaptureScenario =
  | "clicked-link"
  | "direct-pdf-tab"
  | "direct-pdf-without-extension"
  | "large-numdam-pdf";

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
  courseOrigin: string;
  courseRequests: CourseRequest[];
  key: string;
  mainFrameNavigations: string[];
  metadata: Record<string, string>;
  readerFrameUrl: string;
  storedPath: string;
};

type RunningBackend = {
  process: Bun.Subprocess<"ignore", number, number>;
  logFd: number;
};

type RunningCourseServer = Bun.Server<undefined> & {
  requests: CourseRequest[];
};

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

test("reader Library panel lists, opens, and trashes captured items against the backend", async () => {
  await withExtensionReader(async ({ backendPort, courseServer, extensionId, page, readingRoot }) => {
    const firstKey = await preCapturePdfThroughBackend(backendPort, courseServer, "direct-pdf-tab");
    const secondKey = await preCapturePdfThroughBackend(backendPort, courseServer, "large-numdam-pdf");
    writeFileSync(join(readingRoot, "inbox", firstKey.replace(/\.pdf$/, ".md")), "existing note\n");

    await page.goto(readerPageUrl(extensionId, firstKey), { waitUntil: "domcontentloaded" });
    await page.locator('.nav-expand-btn[data-tab="library"]').click();
    await waitForLibraryEntryCount(page, 2);

    // Entry cards carry the title, a has-note marker, and a relative last-read time.
    const firstEntry = page.locator('[data-testid="library-entry"]', { hasText: "notes" });
    await expectElementText(firstEntry.locator(".library-entry-meta"), text => text.includes("📝"));
    await expectElementText(firstEntry.locator(".library-entry-meta"), text => text.includes("just now"));

    // The library is URL-first: selecting an entry navigates the tab back to the item's
    // source URL (never GET /pdf/{key} - the local copy is provenance backup only), and
    // the interception path recognizes the already-captured PDF and mounts the reader.
    await page.locator('[data-testid="library-entry"]', { hasText: "AST_1992" })
      .locator('[data-testid="library-entry-open"]')
      .click();
    await waitForReaderFrame(page, secondKey);
    expect(new URL(page.url()).pathname).toBe(pdfPathForScenario("large-numdam-pdf"));

    const reader = await waitForReaderFrame(page, secondKey);
    // Let the reader finish its synchronous page-render pass before interacting -
    // canvas rasterization can otherwise stall input dispatch on a loaded machine.
    await waitForCanvasCount(reader, 6);

    // Copy view link must work from the cross-origin reader iframe (requires the
    // iframe's clipboard-write permissions-policy delegation) and carry mrpage/mrzoom
    // on the source URL.
    await reader.locator("#toggle-more").click();
    await reader.locator('.menu-item[data-action="copy-view-link"]').click();
    const expectedViewUrl = new URL(page.url());
    expectedViewUrl.searchParams.set("mrpage", "1");
    expectedViewUrl.searchParams.set("mrzoom", "1.25");
    await waitForClipboardText(page, text => text === expectedViewUrl.href);

    await reader.locator('.nav-expand-btn[data-tab="library"]').click();
    await waitForLibraryEntryCount(reader, 2);

    // Trash is guarded by a confirm dialog: dismissing keeps the item...
    page.once("dialog", dialog => void dialog.dismiss());
    await reader.locator('[data-testid="library-entry"]', { hasText: "notes" })
      .locator('[data-testid="library-entry-trash"]')
      .click();
    await Bun.sleep(500);
    await waitForLibraryEntryCount(reader, 2);

    // ...accepting removes the PDF and its sidecar from disk and from the list.
    page.once("dialog", dialog => void dialog.accept());
    await reader.locator('[data-testid="library-entry"]', { hasText: "notes" })
      .locator('[data-testid="library-entry-trash"]')
      .click();
    await waitForLibraryEntryCount(reader, 1);
    expect(existsSync(join(readingRoot, "inbox", firstKey))).toBe(false);
    expect(existsSync(join(readingRoot, "inbox", firstKey.replace(/\.pdf$/, ".md")))).toBe(false);
  });
}, 60_000);

test("built extension captures a clicked PDF link and swaps in the reader without leaving the PDF URL", async () => {
  const evidence = await runExtensionCapture("clicked-link");
  const expectedCourseUrl = new URL("/course/", evidence.courseOrigin).href;
  const expectedPdfUrl = new URL("/notes.pdf", expectedCourseUrl).href;

  // Reader identity (issue #1): the tab never navigates to an extension page - the
  // reader mounts as an iframe inside the PDF document, so the address bar keeps the
  // original source URL.
  expect(evidence.mainFrameNavigations.every(url => !url.startsWith("chrome-extension:"))).toBe(true);
  expect(evidence.mainFrameNavigations.some(url => url === expectedPdfUrl)).toBe(true);
  assertReaderFrameUrl(evidence.readerFrameUrl, evidence.key);

  expect(evidence.metadata["/MathReadSourceURL"]).toBe(expectedCourseUrl);
  expect(evidence.metadata["/MathReadPDFURL"]).toBe(expectedPdfUrl);
  expect(evidence.metadata["/MathReadCapture"]).toBe("capture-url");
  expect(evidence.metadata["/MathReadOriginalSHA256"]).toBe(pdfSha256());
  // link-origin's click-time capture and reader-swap's document capture dedupe in the
  // background worker to a single backend POST.
  expect(evidence.backendCaptureRequestCount).toBe(1);
  expect(
    evidence.courseRequests.some(request =>
      request.path === "/notes.pdf"
      && request.cookie?.includes(`${cookieName}=${cookieValue}`) === true
      && request.referer === expectedCourseUrl
    ),
  ).toBe(true);
  assertEvidenceArtifacts(evidence.artifacts, evidence.storedPath, "clicked-link");
}, 60_000);

test("built extension reuses a pre-existing capture and still mounts the reader", async () => {
  const evidence = await runExtensionCapture("direct-pdf-tab", {
    preExistingCapture: true,
  });
  const expectedPath = pdfPathForScenario("direct-pdf-tab");
  const expectedPdfUrl = new URL(expectedPath, evidence.courseOrigin).href;

  expect(evidence.metadata["/MathReadSourceURL"]).toBe(expectedPdfUrl);
  expect(evidence.metadata["/MathReadPDFURL"]).toBe(expectedPdfUrl);
  expect(evidence.metadata["/MathReadCapture"]).toBe("capture-url");
  expect(evidence.metadata["/MathReadOriginalSHA256"]).toBe(pdfSha256());
  // Setup POST plus the extension's own (deduplicated, existing=true) capture round trip.
  expect(evidence.backendCaptureRequestCount).toBeGreaterThanOrEqual(2);
  assertReaderFrameUrl(evidence.readerFrameUrl, evidence.key);
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
  assertReaderFrameUrl(evidence.readerFrameUrl, evidence.key);
  assertEvidenceArtifacts(evidence.artifacts, evidence.storedPath, "direct-pdf-without-extension");
}, 30_000);

test("built extension renders every page of a large captured PDF in the reader", async () => {
  const evidence = await runExtensionCapture("large-numdam-pdf");
  assertReaderFrameUrl(evidence.readerFrameUrl, evidence.key);
}, 60_000);

test("reader renders all pages of a large PDF with real content", async () => {
  await withExtensionReader(async ({ backendPort, courseServer, extensionId, page }) => {
    const key = await preCapturePdfThroughBackend(backendPort, courseServer, "large-numdam-pdf");
    // View-link restore: page/zoom params (forwarded from mrpage/mrzoom on the source
    // URL by reader-swap) re-open the document at that view.
    await page.goto(`${readerPageUrl(extensionId, key)}&page=3&zoom=0.9`, { waitUntil: "domcontentloaded" });

    // The reader renders every page as a stacked canvas; a fully rendered 6-page
    // document has 6 canvases and the last one has real ink - proof that late pages
    // don't silently stay blank.
    await waitForCanvasCount(page, 6);
    const rendered = await canvasPixelEvidence(page, 5);
    expect(rendered.canvasSize).toBeGreaterThan(10_000);
    expect(rendered.nonWhitePixels).toBeGreaterThan(250);
    await expectElementText(page.locator("#zoom-level"), text => text === "72%");
    await expectInputValue(page.locator("#page-input"), value => value === "3");
  });
}, 60_000);

test("built extension fails loudly when the capture backend is down", async () => {
  await runBackendUnavailable();
}, 60_000);

test("reader Key Points panel persists notes to the on-disk sidecar and renders a live preview", async () => {
  await withExtensionReader(async ({ backendPort, courseServer, extensionId, page, readingRoot }) => {
    const key = await preCapturePdfThroughBackend(backendPort, courseServer, "direct-pdf-tab");
    await page.goto(readerPageUrl(extensionId, key), { waitUntil: "domcontentloaded" });
    await waitForCanvasCount(page, 1);

    await page.locator('.nav-expand-btn[data-tab="keypoints"]').click();
    const editor = page.locator("#ai-editor .cm-content");
    await editor.click();
    await page.keyboard.type("# Heading\n\nSome **bold** text.");

    // Debounced autosave writes the markdown sidecar next to the stored PDF.
    // The Notes tab (tab-bar button + rail chip) is colored once nontrivial notes exist.
    await waitForHasNoteMarker(page);

    const noteText = await waitForNoteSaved(
      backendPort,
      key,
      text => text.includes("# Heading") && text.includes("**bold**"),
    );
    const sidecarPath = join(readingRoot, "inbox", key.replace(/\.pdf$/, ".md"));
    expect(readFileSync(sidecarPath, "utf8")).toBe(noteText);
    await expectElementText(page.locator("#notes-status"), text => text === "Saved");

    // Live preview renders sanitized GFM from the same buffer.
    await page.locator("#notes-mode-preview").click();
    await expectElementText(page.locator("#notes-preview h1"), text => text === "Heading");
    await expectElementText(page.locator("#notes-preview strong"), text => text === "bold");

    // Reload: the editor restores from the sidecar, not any browser-local store.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator('.nav-expand-btn[data-tab="keypoints"]').click();
    await expectElementText(page.locator("#ai-editor .cm-content"), text => text.includes("Heading") && text.includes("bold"));
  });
}, 60_000);

test("reader Key Points panel surfaces a loud error when the backend dies (no localStorage fallback)", async () => {
  await withExtensionReader(async ({ backend, backendPort, courseServer, extensionId, page }) => {
    const key = await preCapturePdfThroughBackend(backendPort, courseServer, "direct-pdf-tab");
    await page.goto(readerPageUrl(extensionId, key), { waitUntil: "domcontentloaded" });
    await waitForCanvasCount(page, 1);

    backend.process.kill();
    await backend.process.exited;

    // The note loaded at boot; with the backend gone, the autosave PUT must surface a
    // visible save failure - never fall back to a browser-local store.
    await page.locator('.nav-expand-btn[data-tab="keypoints"]').click();
    const editor = page.locator("#ai-editor .cm-content");
    await editor.click();
    await page.keyboard.type("orphaned edit");
    await expectElementText(
      page.locator("#notes-status"),
      text => text.startsWith("Save failed:"),
    );
  });
}, 60_000);

test("reader keeps legacy highlight source until migration is durably saved", async () => {
  await withExtensionReader(async ({ backendPort, courseServer, extensionId, page }) => {
    const key = await preCapturePdfThroughBackend(backendPort, courseServer, "direct-pdf-tab");
    await seedLegacyReaderState(page, extensionId, key, [legacyHighlight()], 15_000);

    await page.goto(readerPageUrl(extensionId, key), { waitUntil: "domcontentloaded" });
    await waitForCanvasCount(page, 1);
    await page.locator('.nav-expand-btn[data-tab="keypoints"]').click();

    await expectElementText(page.locator("#ai-editor .cm-content"), text => text.includes("legacy lattice quote"));
    await expectElementText(page.locator("#notes-status"), text => text === "Unsaved changes");
    expect(await legacyHighlightsRaw(page, key)).not.toBeNull();
  });
}, 120_000);

test("legacy highlight migration rejects incomplete records instead of fabricating defaults", async () => {
  await withExtensionReader(async ({ backendPort, courseServer, extensionId, page }) => {
    const key = await preCapturePdfThroughBackend(backendPort, courseServer, "direct-pdf-tab");
    await seedLegacyReaderState(
      page,
      extensionId,
      key,
      [
        {
          id: "legacy-incomplete",
          pageNumber: 1,
          color: "#91edd0",
          rects: legacyRects(),
          text: "legacy highlight missing required fields",
        },
      ],
      15_000,
    );

    await page.goto(readerPageUrl(extensionId, key), { waitUntil: "domcontentloaded" });
    await waitForCanvasCount(page, 1);
    await page.locator('.nav-expand-btn[data-tab="keypoints"]').click();
    await expectElementText(page.locator("#notes-status"), text => text === "Saved" || text === "Unsaved changes");

    const editorText = await page.locator("#ai-editor .cm-content").innerText();
    expect(editorText).not.toContain("1970-01-01T00:00:00.000Z");
    expect(editorText).not.toContain("legacy highlight missing required fields");
    expect(await legacyHighlightsRaw(page, key)).not.toBeNull();
  });
}, 120_000);

test("reader disables document-only toolbar actions when no document key is open", async () => {
  await withExtensionReader(async ({ extensionId, page }) => {
    await page.goto(`chrome-extension://${extensionId}/poc/reader.html`, { waitUntil: "domcontentloaded" });
    const state = await waitForNoDocumentReaderState(page);
    expect(state.docTitle).toBe("MathRead Library");
    expect(state.viewerText).toContain("No document open");
    expect(state.enabledDocumentControls).toEqual([]);
  });
}, 120_000);

test("reader keeps exactly one coherent page set after rapid toolbar rerenders", async () => {
  await withExtensionReader(async ({ backendPort, courseServer, extensionId, page }) => {
    const key = await preCapturePdfThroughBackend(backendPort, courseServer, "large-numdam-pdf");
    await page.goto(readerPageUrl(extensionId, key), { waitUntil: "domcontentloaded" });
    await waitForCanvasCount(page, 6);

    const pageTotal = Number(await page.locator("#page-total").textContent());
    await page.evaluate(() => {
      const sequence = ["zoom-in", "zoom-out", "rotate", "fit-width", "zoom-in", "rotate", "zoom-out", "fit-width"];
      for (let round = 0; round < 3; round += 1) {
        for (const id of sequence) {
          document.getElementById(id)?.click();
        }
      }
    });

    const dom = await waitForStablePageDom(page);
    expect(dom.canvasCount).toBe(pageTotal);
    expect(dom.pageNumbers).toEqual(Array.from({ length: pageTotal }, (_, index) => String(index + 1)));
  });
}, 120_000);

function readerPageUrl(extensionId: string, key: string): string {
  return `chrome-extension://${extensionId}/poc/reader.html?key=${encodeURIComponent(key)}`;
}

function assertReaderFrameUrl(url: string, expectedKey: string): void {
  const parsed = new URL(url);
  expect(parsed.protocol).toBe("chrome-extension:");
  expect(parsed.pathname).toContain("/poc/reader.html");
  expect(parsed.searchParams.get("key")).toBe(expectedKey);
}

async function runBackendUnavailable(): Promise<void> {
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
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    await waitForExtensionServiceWorker(context);
    await context.addCookies([
      {
        name: cookieName,
        value: cookieValue,
        url: courseServer.url.origin,
      },
    ]);
    const page = await context.newPage();
    attachPageDiagnostics(page, artifacts, "clicked-link");
    await page.goto(`${courseServer.url.origin}/notes.pdf`);

    // No backend means capture fails, and the content script replaces the document with a loud
    // error, never a silent local viewer.
    await expectElementText(
      page.locator("#mathread-capture-error"),
      text => text.includes("MathRead could not capture this PDF"),
    );
    await page.screenshot({ path: artifacts.screenshotAfterPath });
    assertPng(artifacts.screenshotAfterPath);
    await page.close();
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

  try {
    await waitForHttpService(`http://127.0.0.1:${backendPort}/openapi.json`);
    if (options.preExistingCapture === true) {
      await preCapturePdfThroughBackend(backendPort, courseServer, scenario);
    }

    // No context.tracing here: Playwright tracing's screencast/snapshot CDP traffic
    // intermittently deadlocks the bun event loop under load, hanging the whole test.
    context = await chromium.launchPersistentContext(join(testRoot, "profile"), {
      executablePath: "/bin/chromium",
      headless: true,
      artifactsDir: artifacts.root,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    const serviceWorker = await waitForExtensionServiceWorker(context);
    serviceWorker.on("console", message => {
      appendEvent(artifacts.eventsLogPath, {
        type: "service-worker-console",
        scenario,
        text: message.text(),
      });
    });
    await context.addCookies([
      {
        name: cookieName,
        value: cookieValue,
        url: courseServer.url.origin,
      },
    ]);

    const page = await context.newPage();
    attachPageDiagnostics(page, artifacts, scenario);
    const mainFrameNavigations: string[] = [];
    page.on("framenavigated", frame => {
      if (frame === page.mainFrame()) {
        mainFrameNavigations.push(frame.url());
      }
    });

    if (scenario === "clicked-link") {
      // The realistic flow: a click on a PDF link records the click origin as capture
      // provenance (link-origin.ts), then the PDF document itself is intercepted by
      // reader-swap.ts.
      await page.goto(`${courseServer.url.origin}/course/`);
      await page.screenshot({ path: artifacts.screenshotBeforePath });
      await page.getByRole("link", { name: "Notes" }).click();
    } else {
      await page.goto(`${courseServer.url.origin}${pdfPathForScenario(scenario)}`);
    }

    // Capture is automatic and always-on: opening the PDF stores it, then the reader
    // mounts keyed by the stored filename.
    const storedPath = await waitForStoredPdf(readingRoot);
    const key = storedKeyFromPath(storedPath);
    const readerFrame = await waitForReaderFrame(page, key);
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
      courseOrigin: courseServer.url.origin,
      courseRequests: courseServer.requests,
      key,
      mainFrameNavigations,
      metadata,
      readerFrameUrl: readerFrame.url(),
      storedPath,
    };
  } finally {
    if (context !== undefined) {
      await context.close();
    }
    courseServer.stop(true);
    backend.process.kill();
    await backend.process.exited;
    closeSync(backend.logFd);
  }
}

type ExtensionReaderEvidence = {
  backend: RunningBackend;
  backendPort: number;
  context: BrowserContext;
  courseServer: RunningCourseServer;
  extensionId: string;
  page: Page;
  readingRoot: string;
};

async function withExtensionReader(
  callback: (evidence: ExtensionReaderEvidence) => Promise<void>,
): Promise<void> {
  const backendPort = await unusedTcpPort();
  const testRoot = mkdtemp("mathread-extension-reader-");
  const readingRoot = join(testRoot, "reading-root");
  mkdirSync(readingRoot);
  const artifacts = createCaptureArtifacts(testRoot, "direct-pdf-tab");
  const extensionPath = configuredExtensionCopy(testRoot, backendPort);
  const backend = startMathReadBackend(backendPort, readingRoot, artifacts.backendLogPath);
  const courseServer = startCourseServer(artifacts.eventsLogPath);
  let context: BrowserContext | undefined;

  try {
    await waitForHttpService(`http://127.0.0.1:${backendPort}/openapi.json`);
    context = await chromium.launchPersistentContext(join(testRoot, "profile"), {
      executablePath: "/bin/chromium",
      headless: true,
      artifactsDir: artifacts.root,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    const serviceWorker = await waitForExtensionServiceWorker(context);
    const extensionId = new URL(serviceWorker.url()).host;
    await context.grantPermissions(["clipboard-read"]);
    await context.addCookies([
      {
        name: cookieName,
        value: cookieValue,
        url: courseServer.url.origin,
      },
    ]);
    const page = await context.newPage();
    attachPageDiagnostics(page, artifacts, "direct-pdf-tab");

    await callback({ backend, backendPort, context, courseServer, extensionId, page, readingRoot });
    await page.close();
  } finally {
    if (context !== undefined) {
      await context.close();
    }
    courseServer.stop(true);
    backend.process.kill();
    await backend.process.exited;
    closeSync(backend.logFd);
  }
}

/** Capture a scenario PDF straight through the backend; returns its library key. */
async function preCapturePdfThroughBackend(
  backendPort: number,
  courseServer: RunningCourseServer,
  scenario: CaptureScenario,
): Promise<string> {
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
  const value: unknown = await response.json();
  assert(isRecord(value) && typeof value.stored_path === "string");
  const key = storedKeyFromPath(value.stored_path);
  await waitForBackendLibraryKey(backendPort, key);
  return key;
}

async function waitForExtensionServiceWorker(context: BrowserContext) {
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

function storedKeyFromPath(storedPath: string): string {
  const segments = storedPath.split("/");
  const key = segments[segments.length - 1];
  assert(key !== undefined && key.length > 0);
  return key;
}

async function waitForReaderFrame(page: Page, expectedKey: string): Promise<Frame> {
  let lastUrlError: unknown = undefined;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const frame = page.frames().find(candidate => {
      if (candidate.name() !== "mathreadReaderFrame") {
        return false;
      }
      try {
        return new URL(candidate.url()).searchParams.get("key") === expectedKey;
      } catch (error) {
        lastUrlError = error;
        return false;
      }
    });
    if (frame !== undefined) {
      await frame.waitForLoadState("domcontentloaded");
      return frame;
    }
    await Bun.sleep(100);
  }
  const surfaces = page.frames().map(frame => `${frame.name()} ${frame.url()}`);
  throw new Error(
    `Timed out waiting for reader frame with key=${expectedKey}; frames: ${surfaces.join(", ")}; last URL error: ${String(lastUrlError)}`,
  );
}

type ReaderSurface = Page | Frame;

async function waitForCanvasCount(surface: ReaderSurface, expectedCount: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const readerErrors = surface.locator("#reader-error");
    if (await readerErrors.count() > 0) {
      const text = await readerErrors.first().textContent();
      throw new Error(`Reader failed before rendering ${expectedCount} canvas(es): ${text}`);
    }
    if (await surface.locator("#viewer canvas").count() === expectedCount) {
      return;
    }
    await Bun.sleep(100);
  }
  const lastCount = await surface.locator("#viewer canvas").count();
  throw new Error(`Timed out waiting for ${expectedCount} PDF canvas(es); last count: ${lastCount}`);
}

async function waitForBackendLibraryKey(backendPort: number, key: string): Promise<void> {
  let lastKeys: string[] = [];
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetch(`http://127.0.0.1:${backendPort}/library`);
    expect(response.ok).toBe(true);
    const value: unknown = await response.json();
    assert(Array.isArray(value));
    lastKeys = value
      .filter(isRecord)
      .map(entry => entry.key)
      .filter((entryKey): entryKey is string => typeof entryKey === "string");
    if (lastKeys.includes(key)) {
      return;
    }
    await Bun.sleep(100);
  }
  throw new Error(`Timed out waiting for backend library key ${key}; last keys: ${lastKeys.join(", ")}`);
}

async function canvasPixelEvidence(
  surface: ReaderSurface,
  canvasIndex: number,
): Promise<{ canvasSize: number; nonWhitePixels: number }> {
  let lastEvidence = { canvasSize: 0, nonWhitePixels: 0 };
  for (let attempt = 0; attempt < 100; attempt += 1) {
    lastEvidence = await surface.evaluate(targetIndex => {
      const channel = (value: number | undefined, fallback: number): number => {
        if (value === undefined) return fallback;
        return value;
      };
      const pixelAlpha = (pixels: Uint8ClampedArray, offset: number): number => {
        return channel(pixels[offset + 3], 0);
      };
      const pixelMinimumColor = (pixels: Uint8ClampedArray, offset: number): number => {
        return Math.min(
          channel(pixels[offset], 255),
          channel(pixels[offset + 1], 255),
          channel(pixels[offset + 2], 255),
        );
      };
      const isNonWhitePixel = (pixels: Uint8ClampedArray, offset: number): boolean => {
        return pixelAlpha(pixels, offset) > 0 && pixelMinimumColor(pixels, offset) < 245;
      };
      const canvases = document.querySelectorAll<HTMLCanvasElement>("#viewer canvas");
      const canvas = canvases[targetIndex];
      if (canvas === undefined) {
        return { canvasSize: 0, nonWhitePixels: 0 };
      }
      const context = canvas.getContext("2d");
      if (context === null || canvas.width === 0 || canvas.height === 0) {
        return { canvasSize: canvas.width * canvas.height, nonWhitePixels: 0 };
      }
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let nonWhitePixels = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        if (isNonWhitePixel(pixels, offset)) {
          nonWhitePixels += 1;
        }
      }
      return { canvasSize: canvas.width * canvas.height, nonWhitePixels };
    }, canvasIndex);
    if (lastEvidence.canvasSize > 10_000 && lastEvidence.nonWhitePixels > 250) {
      return lastEvidence;
    }
    await Bun.sleep(100);
  }
  return lastEvidence;
}

async function waitForLibraryEntryCount(surface: ReaderSurface, expectedCount: number): Promise<void> {
  const entries = surface.locator('[data-testid="library-entry"]');
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await entries.count() === expectedCount) {
      return;
    }
    await Bun.sleep(100);
  }
  throw new Error(`Timed out waiting for ${expectedCount} library entry(ies); last count: ${await entries.count()}`);
}

async function expectElementText(
  locator: ReturnType<Page["locator"]>,
  predicate: (text: string) => boolean,
): Promise<void> {
  let lastText = "<missing>";
  let lastError: unknown = undefined;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let text: string | null = null;
    try {
      text = await locator.textContent();
    } catch (error) {
      lastError = error;
    }
    if (text !== null) {
      lastText = text;
      if (predicate(text)) {
        return;
      }
    }
    await Bun.sleep(100);
  }
  throw new Error(`Timed out waiting for element text; last text: ${lastText}; last error: ${String(lastError)}`);
}

async function waitForClipboardText(
  page: Page,
  predicate: (text: string) => boolean,
): Promise<void> {
  let lastText = "<unread>";
  let lastError: unknown = undefined;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let text: string | null = null;
    try {
      text = await page.evaluate(() => navigator.clipboard.readText());
    } catch (error) {
      lastError = error;
    }
    if (text !== null) {
      lastText = text;
      if (predicate(text)) {
        return;
      }
    }
    await Bun.sleep(100);
  }
  throw new Error(`Timed out waiting for clipboard text; last: ${lastText}; last error: ${String(lastError)}`);
}

async function waitForHasNoteMarker(surface: ReaderSurface): Promise<void> {
  const marked = surface.locator('.nav-tb-btn.has-note[data-tab="keypoints"]');
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await marked.count() === 1) {
      return;
    }
    await Bun.sleep(100);
  }
  throw new Error("Timed out waiting for the Notes tab has-note marker");
}

async function expectInputValue(
  locator: ReturnType<Page["locator"]>,
  predicate: (value: string) => boolean,
): Promise<void> {
  let lastValue = "<missing>";
  let lastError: unknown = undefined;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let value: string | null = null;
    try {
      value = await locator.inputValue();
    } catch (error) {
      lastError = error;
    }
    if (value !== null) {
      lastValue = value;
      if (predicate(value)) {
        return;
      }
    }
    await Bun.sleep(100);
  }
  throw new Error(`Timed out waiting for input value; last value: ${lastValue}; last error: ${String(lastError)}`);
}

async function waitForNoteSaved(
  backendPort: number,
  key: string,
  predicate: (text: string) => boolean,
): Promise<string> {
  let lastText = "<missing>";
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetch(`http://127.0.0.1:${backendPort}/notes/${encodeURIComponent(key)}`);
    if (response.ok) {
      const value: unknown = await response.json();
      assert(isRecord(value) && typeof value.text === "string");
      lastText = value.text;
      if (predicate(lastText)) {
        return lastText;
      }
    }
    await Bun.sleep(100);
  }
  throw new Error(`Timed out waiting for saved note text; last text: ${lastText}`);
}

async function waitForNoDocumentReaderState(
  page: Page,
): Promise<{ docTitle: string; enabledDocumentControls: string[]; viewerText: string }> {
  let lastState = { docTitle: "", enabledDocumentControls: [] as string[], viewerText: "" };
  for (let attempt = 0; attempt < 100; attempt += 1) {
    lastState = await page.evaluate(ids => {
      const disabledCapable = (element: HTMLElement): element is HTMLButtonElement | HTMLInputElement => {
        return element instanceof HTMLButtonElement || element instanceof HTMLInputElement;
      };
      const enabledDocumentControlSelector = (id: string): string | undefined => {
        const element = document.getElementById(id);
        if (element === null || !disabledCapable(element) || !element.disabled) {
          return `#${id}`;
        }
        return undefined;
      };
      const enabledDocumentControls = ids.flatMap(id => {
        const selector = enabledDocumentControlSelector(id);
        return selector === undefined ? [] : [selector];
      });
      return {
        docTitle: document.getElementById("doc-title")?.textContent ?? "",
        enabledDocumentControls,
        viewerText: document.getElementById("viewer")?.textContent ?? "",
      };
    }, documentControlIds);
    if (
      lastState.docTitle === "MathRead Library" &&
      lastState.viewerText.includes("No document open")
    ) {
      return lastState;
    }
    await Bun.sleep(100);
  }
  throw new Error(`Timed out waiting for no-document reader state: ${JSON.stringify(lastState)}`);
}

type LegacyHighlight = {
  id: string;
  pageNumber: number;
  color: string;
  createdAt?: string;
  rects: { xPct: number; yPct: number; wPct: number; hPct: number }[];
  text: string;
  comment?: string;
};

function legacyRects(): LegacyHighlight["rects"] {
  return [{ xPct: 0.1, yPct: 0.1, wPct: 0.25, hPct: 0.05 }];
}

function legacyHighlight(): LegacyHighlight {
  return {
    id: "legacy-complete",
    pageNumber: 1,
    color: "#91edd0",
    createdAt: "2026-07-04T00:00:00.000Z",
    rects: legacyRects(),
    text: "legacy lattice quote",
    comment: "legacy migration comment",
  };
}

async function seedLegacyReaderState(
  page: Page,
  extensionId: string,
  key: string,
  highlights: LegacyHighlight[],
  autosaveMs: number,
): Promise<void> {
  await page.goto(`chrome-extension://${extensionId}/poc/reader.css`, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ({ key, highlights }) => {
      localStorage.setItem(`mathread-poc-highlights:${key}`, JSON.stringify(highlights));
    },
    { key, highlights },
  );
  const serviceWorker = page.context().serviceWorkers().find(worker => worker.url().startsWith("chrome-extension://"));
  assert(serviceWorker !== undefined);
  await serviceWorker.evaluate(
    async autosaveMs => {
      const chromeApi = (globalThis as typeof globalThis & {
        chrome: {
          storage: {
            local: {
              set(items: Record<string, unknown>): Promise<void>;
            };
          };
        };
      }).chrome;
      await chromeApi.storage.local.set({
        "mathread.settings": {
          autosaveMs,
          fitWidthOnOpen: false,
          lineNumbers: true,
        },
      });
    },
    autosaveMs,
  );
}

async function legacyHighlightsRaw(page: Page, key: string): Promise<string | null> {
  return page.evaluate(key => localStorage.getItem(`mathread-poc-highlights:${key}`), key);
}

async function waitForStablePageDom(page: Page): Promise<{ canvasCount: number; pageNumbers: string[] }> {
  let lastSignature = "";
  let stableSamples = 0;
  let lastDom = { canvasCount: 0, pageNumbers: [] as string[] };
  for (let attempt = 0; attempt < 100; attempt += 1) {
    lastDom = await page.evaluate(() => ({
      canvasCount: document.querySelectorAll("#viewer canvas").length,
      pageNumbers: Array.from(document.querySelectorAll("#viewer .page"))
        .map(page => page.getAttribute("data-page-number") ?? ""),
    }));
    const signature = JSON.stringify(lastDom);
    if (signature === lastSignature) {
      stableSamples += 1;
      if (stableSamples >= 5) {
        return lastDom;
      }
    } else {
      lastSignature = signature;
      stableSamples = 0;
    }
    await Bun.sleep(100);
  }
  return lastDom;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
  page.on("framenavigated", frame => {
    appendEvent(artifacts.eventsLogPath, {
      type: "frame-navigated",
      scenario,
      text: `${frame === page.mainFrame() ? "main" : "sub"} ${frame.name()} ${frame.url()}`,
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
  // .venv binaries directly: `uv run` takes the project lock, and concurrent uv
  // invocations across tests intermittently hang a synchronous spawn for minutes.
  const process = Bun.spawn(
    [
      join(import.meta.dir, "..", ".venv", "bin", "mathread"),
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
      if (url.pathname === "/notes.pdf" || url.pathname === "/pdf/2301.12345" || url.pathname === "/item/AST_1992__211__1_0.pdf") {
        if (courseRequest.cookie?.includes(`${cookieName}=${cookieValue}`) !== true) {
          return new Response("missing browser session cookie", { status: 403 });
        }
        return new Response(pdfBytesForPath(url.pathname), {
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
  if (scenario === "large-numdam-pdf") {
    return "/item/AST_1992__211__1_0.pdf";
  }
  if (scenario === "direct-pdf-without-extension") {
    return "/pdf/2301.12345";
  }
  return "/notes.pdf";
}

function pdfBytesForPath(path: string): Uint8Array<ArrayBuffer> {
  if (path === "/item/AST_1992__211__1_0.pdf") {
    return multipagePdfBytes(6);
  }
  return pdfBytes;
}

function multipagePdfBytes(pageCount: number): Uint8Array<ArrayBuffer> {
  const objects = new Map<number, string>();
  objects.set(1, "<< /Type /Catalog /Pages 2 0 R >>");
  objects.set(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  const pageObjectNumbers: number[] = [];
  let nextObjectNumber = 4;
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const pageObjectNumber = nextObjectNumber;
    const contentObjectNumber = nextObjectNumber + 1;
    nextObjectNumber += 2;
    pageObjectNumbers.push(pageObjectNumber);
    objects.set(
      pageObjectNumber,
      [
        "<< /Type /Page",
        "/Parent 2 0 R",
        "/MediaBox [0 0 300 300]",
        `/Contents ${contentObjectNumber} 0 R`,
        "/Resources << /Font << /F1 3 0 R >> >>",
        ">>",
      ].join(" "),
    );
    const stream = [
      "BT",
      "/F1 24 Tf",
      "72 180 Td",
      `(MathRead page ${pageNumber}) Tj`,
      "ET",
      "0 0 1 rg",
      "72 72 100 50 re f",
      "",
    ].join("\n");
    objects.set(
      contentObjectNumber,
      `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
    );
  }

  objects.set(
    2,
    `<< /Type /Pages /Kids [${pageObjectNumbers.map(objectNumber => `${objectNumber} 0 R`).join(" ")}] /Count ${pageCount} >>`,
  );

  let source = "%PDF-1.4\n";
  const offsets = [0];
  for (const objectNumber of [...objects.keys()].sort((left, right) => left - right)) {
    offsets[objectNumber] = source.length;
    source += `${objectNumber} 0 obj\n${objects.get(objectNumber)}\nendobj\n`;
  }
  const startXref = source.length;
  source += `xref\n0 ${objects.size + 1}\n`;
  source += "0000000000 65535 f \n";
  for (let objectNumber = 1; objectNumber <= objects.size; objectNumber += 1) {
    const offset = offsets[objectNumber];
    assert(offset !== undefined);
    source += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  source += `trailer\n<< /Root 1 0 R /Size ${objects.size + 1} >>\n`;
  source += `startxref\n${startXref}\n%%EOF\n`;
  return new TextEncoder().encode(source);
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
    join(import.meta.dir, "..", ".venv", "bin", "python"),
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
