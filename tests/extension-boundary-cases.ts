// End-to-end proof of the extension boundary: opening a PDF in a tab commits an
// extension-owned launch page before Chrome's native viewer, auto-captures to the real
// local backend, and mounts the MathRead reader while preserving the source URL. The
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
  rmSync,
  statSync,
  utimesSync,
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
import { chromiumExecutablePath } from "./browser-helpers";

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
const extractLinkPdfBytes = new Uint8Array(
  readFileSync(join(import.meta.dir, "fixtures", "pdfjs", "extract_link.pdf")),
);

const cookieName = "mathread_session";
const cookieValue = "extension-test";
const numdamRegressionPdfUrl =
  "https://www.numdam.org/item/AST_1992__211__1_0.pdf";
const numdamFixtureDirectory = join(import.meta.dir, "fixtures", "numdam");
const numdamFixturePath = join(
  numdamFixtureDirectory,
  "AST_1992__211__1_0.pdf",
);
const numdamFixtureByteLength = 15_648_724;
const numdamFixtureSha256 =
  "0b81cacbf796f3ea72d35ab0faaeec2215a8f390e050c9142d621cfd6922976e";
const numdamFixtureChunkCount = 8;
const numdamFixtureFetchAttempts = 4;
type ExtensionManifest = {
  host_permissions: string[];
};

type CaptureScenario =
  | "clicked-link"
  | "direct-pdf-tab"
  | "direct-pdf-without-extension"
  | "large-numdam-pdf"
  | "arxiv-pdf";

type CaptureArtifacts = {
  root: string;
  backendLogPath: string;
  eventsLogPath: string;
  screenshotBeforePath: string;
  screenshotLaunchPath: string;
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
  cleanup: () => void;
  courseOrigin: string;
  courseRequests: CourseRequest[];
  key: string;
  mainFrameNavigations: string[];
  metadata: Record<string, string>;
  readerFrameUrl: string;
  storedPath: string;
  visibleReaderUrl: string;
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
  currentViewUrl?: string;
  plainLinkUrl?: string;
  desktopMenuPath?: string;
  narrowMenuPath?: string;
  readerScreenshotPath?: string;
  markdownScreenshotPath?: string;
  libraryScreenshotPath?: string;
};

type ReadEventRequest = {
  method: string;
  pathname: string;
  bodyText: string | null;
};

type BackendLibraryEntry = {
  key: string;
  first_read: string;
  last_read: string;
};

type CaptureRunOptions = {
  preExistingCapture?: boolean;
};

const defaultCaptureRunOptions: CaptureRunOptions = {
  preExistingCapture: false,
};
const launchCaptureDelayMs = 250;

export function registerCaptureBoundaryTests(): void {
  registerLibraryCaptureBoundaryTests();
  registerPdfInterceptionBoundaryTests();
  registerCapturedSourceBoundaryTests();
}

function registerLibraryCaptureBoundaryTests(): void {
test("reader Library panel lists, opens, and trashes captured items against the backend", async () => {
  await withExtensionReader(
    async ({ backendPort, courseServer, extensionId, page, readingRoot }) => {
      const firstKey = await preCapturePdfThroughBackend(
        backendPort,
        courseServer,
        "direct-pdf-tab",
      );
      const secondKey = await preCapturePdfThroughBackend(
        backendPort,
        courseServer,
        "large-numdam-pdf",
      );
      writeFileSync(
        join(readingRoot, firstKey.replace(/\.pdf$/, ".md")),
        "existing note\n",
      );

      await page.goto(readerPageUrl(extensionId, backendPort, firstKey), {
        waitUntil: "domcontentloaded",
      });
      await waitForCanvasCount(page, 1);
      await page.locator('.nav-expand-btn[data-tab="library"]').click();
      await waitForLibraryEntryCount(page, 2);

      // The MathRead library opens its stored entry through the reader handoff.
      await page
        .locator('[data-testid="library-entry"]', { hasText: "AST_1992" })
        .locator('[data-testid="library-entry-open"]')
        .click();
      await waitForReaderFrame(page, secondKey);
      const visibleReaderUrl = new URL(page.url());
      assertReaderFrameUrl(visibleReaderUrl.href, secondKey);

      const reader = await waitForReaderFrame(page, secondKey);
      // PDF.js owns a bounded canvas window; wait for the current page rather than
      // requiring every page canvas to exist simultaneously.
      await reader.locator("#viewer canvas").first().waitFor();

      await reader.locator('.nav-expand-btn[data-tab="library"]').click();
      await waitForLibraryEntryCount(reader, 2);

      // Trash is guarded by a confirm dialog: dismissing keeps the item...
      const notedEntry = reader
        .locator('[data-testid="library-entry"]')
        .filter({ hasText: "📝" });
      page.once("dialog", (dialog) => void dialog.dismiss());
      await notedEntry.locator('[data-testid="library-entry-trash"]').click();
      await Bun.sleep(500);
      await waitForLibraryEntryCount(reader, 2);

      // ...accepting removes the PDF and its note from disk and from the list.
      page.once("dialog", (dialog) => void dialog.accept());
      await notedEntry.locator('[data-testid="library-entry-trash"]').click();
      await waitForLibraryEntryCount(reader, 1);
      expect(existsSync(join(readingRoot, firstKey))).toBe(false);
      expect(
        existsSync(join(readingRoot, firstKey.replace(/\.pdf$/, ".md"))),
      ).toBe(false);
    },
  );
}, 60_000);

test("reader Library panel opens provenance-less local PDFs from the backend copy", async () => {
  await withExtensionReader(async ({ extensionId, page, readingRoot }) => {
    writeFileSync(join(readingRoot, "local.pdf"), pdfBytes);

    await page.goto(`chrome-extension://${extensionId}/reader/library.html`, {
      waitUntil: "domcontentloaded",
    });
    await waitForLibraryEntryCount(page, 1);
    await page
      .locator('[data-testid="library-entry"]', { hasText: "local" })
      .locator('[data-testid="library-entry-open"]')
      .click();

    await waitForReaderFrame(page, "local.pdf");
    await waitForCanvasCount(page, 1);
    assertReaderFrameUrl(page.url(), "local.pdf");
  });
}, 60_000);

}

function registerPdfInterceptionBoundaryTests(): void {

test("built extension intercepts a clicked PDF directly into an extension-owned reader", async () => {
  const evidence = await runExtensionCapture("clicked-link");
  const expectedCourseUrl = new URL("/course/", evidence.courseOrigin).href;
  const expectedPdfUrl = new URL("/notes.pdf", expectedCourseUrl).href;

  // Direct interception (issue #6): the source PDF response must be redirected before
  // Chrome commits its native PDF document. The visible extension URL still carries the
  // canonical source URL so capture provenance and shareable identity are preserved.
  expect(
    evidence.mainFrameNavigations.every(
      (url) => url !== expectedPdfUrl,
    ),
  ).toBe(true);
  const visibleReaderUrl = new URL(evidence.visibleReaderUrl);
  assertReaderFrameUrl(visibleReaderUrl.href, evidence.key);
  assertReaderFrameUrl(evidence.readerFrameUrl, evidence.key);

  expect(evidence.metadata["/MathReadSourceURL"]).toBe(expectedCourseUrl);
  expect(evidence.metadata["/MathReadPDFURL"]).toBe(expectedPdfUrl);
  expect(evidence.metadata["/MathReadCapture"]).toBe("capture-bytes");
  expect(evidence.metadata["/MathReadOriginalSHA256"]).toBe(pdfSha256());
  // link-origin's click-time capture and pdf-launch's document capture dedupe in the
  // background worker to a single backend POST.
  expect(evidence.backendCaptureRequestCount).toBe(1);
  expect(
    evidence.courseRequests.some(
      (request) =>
        request.path === "/notes.pdf" &&
        request.cookie?.includes(`${cookieName}=${cookieValue}`) === true &&
        request.referer === expectedCourseUrl,
    ),
  ).toBe(true);
  assertEvidenceArtifacts(
    evidence.artifacts,
    evidence.storedPath,
    "clicked-link",
  );
  evidence.cleanup();
}, 60_000);

test("built extension reuses a pre-existing capture and still mounts the reader", async () => {
  const evidence = await runExtensionCapture("direct-pdf-tab", {
    preExistingCapture: true,
  });
  const expectedPath = pdfPathForScenario("direct-pdf-tab");
  const expectedPdfUrl = new URL(expectedPath, evidence.courseOrigin).href;

  expect(evidence.metadata["/MathReadSourceURL"]).toBe(expectedPdfUrl);
  expect(evidence.metadata["/MathReadPDFURL"]).toBe(expectedPdfUrl);
  expect(evidence.metadata["/MathReadCapture"]).toBe("capture-bytes");
  expect(evidence.metadata["/MathReadOriginalSHA256"]).toBe(pdfSha256());
  // Setup POST plus the extension's own (deduplicated, existing=true) capture round trip.
  expect(evidence.backendCaptureRequestCount).toBeGreaterThanOrEqual(2);
  assertReaderFrameUrl(evidence.readerFrameUrl, evidence.key);
  assertEvidenceArtifacts(
    evidence.artifacts,
    evidence.storedPath,
    "direct-pdf-tab",
  );
  evidence.cleanup();
}, 45_000);

test("built extension auto-captures an application/pdf URL without a .pdf suffix", async () => {
  const evidence = await runExtensionCapture("direct-pdf-without-extension");
  const expectedPath = pdfPathForScenario("direct-pdf-without-extension");
  const expectedPdfUrl = new URL(expectedPath, evidence.courseOrigin).href;

  expect(evidence.metadata["/MathReadSourceURL"]).toBe(expectedPdfUrl);
  expect(evidence.metadata["/MathReadPDFURL"]).toBe(expectedPdfUrl);
  expect(evidence.metadata["/MathReadCapture"]).toBe("capture-bytes");
  expect(evidence.backendCaptureRequestCount).toBe(1);
  expect(evidence.metadata["/MathReadOriginalSHA256"]).toBe(pdfSha256());
  assertReaderFrameUrl(evidence.readerFrameUrl, evidence.key);
  assertEvidenceArtifacts(
    evidence.artifacts,
    evidence.storedPath,
    "direct-pdf-without-extension",
  );
  evidence.cleanup();
}, 30_000);

test("disabling automatic capture removes the PDF redirect rule", async () => {
  await withExtensionReader(async ({ context }) => {
    const serviceWorker = await waitForExtensionServiceWorker(context);
    await waitForPdfRedirectRule(serviceWorker);
    await serviceWorker.evaluate(async () => {
      const chromeApi = (
        globalThis as typeof globalThis & {
          chrome: {
            storage: {
              local: {
                set(items: Record<string, unknown>): Promise<void>;
              };
            };
          };
        }
      ).chrome;
      await chromeApi.storage.local.set({
        "mathread.settings": {
          autoCapturePdfs: false,
          autosaveMs: 800,
          fitWidthOnOpen: false,
          lineNumbers: true,
        },
      });
    });
    await waitForNoPdfRedirectRule(serviceWorker);
  });
}, 30_000);

test("extension synchronization removes legacy PDF redirect rules", async () => {
  await withExtensionReader(async ({ context }) => {
    const serviceWorker = await waitForExtensionServiceWorker(context);
    await waitForPdfRedirectRule(serviceWorker);
    await serviceWorker.evaluate(async () => {
      const chromeApi = (
        globalThis as typeof globalThis & {
          chrome: {
            declarativeNetRequest: {
              updateDynamicRules(update: {
                removeRuleIds: number[];
                addRules: unknown[];
              }): Promise<void>;
            };
            storage: {
              local: {
                set(items: Record<string, unknown>): Promise<void>;
              };
            };
          };
        }
      ).chrome;
      await chromeApi.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [5],
        addRules: [
          {
            id: 5,
            priority: 3,
            action: {
              type: "redirect",
              redirect: {
                regexSubstitution:
                  "chrome-extension://legacy/content/web/viewer.html?DNR:\\0",
              },
            },
            condition: {
              regexFilter: "^.*$",
              resourceTypes: ["main_frame", "sub_frame"],
              responseHeaders: [
                {
                  header: "content-type",
                  values: ["application/pdf", "application/pdf;*"],
                },
              ],
            },
          },
        ],
      });
      await chromeApi.storage.local.set({
        "mathread.settings": {
          autoCapturePdfs: true,
          autosaveMs: 800,
          fitWidthOnOpen: false,
          lineNumbers: true,
        },
      });
    });
    await waitForPdfRedirectRule(serviceWorker);
    expect(await pdfRedirectRuleIds(serviceWorker)).toEqual([1]);
  });
}, 30_000);

}

function registerCapturedSourceBoundaryTests(): void {
  registerExtensionOwnedWorkflowTest();
  registerCapturedRenderingBoundaryTests();
}

function registerExtensionOwnedWorkflowTest(): void {

test("reader, markdown, and library workflows remain extension-owned", async () => {
  await withExtensionReader(
    async ({ artifacts, backendPort, courseServer, extensionId, page, readingRoot }) => {
      const olderCapturedKey = await preCapturePdfThroughBackend(
        backendPort,
        courseServer,
        "arxiv-pdf",
      );
      const manualKey = "manual-local.pdf";
      writeFileSync(join(readingRoot, manualKey), pdfBytes);
      const key = await preCapturePdfThroughBackend(
        backendPort,
        courseServer,
        "large-numdam-pdf",
      );
      const originalReadTime = new Date("2020-01-01T00:00:00.000Z");
      for (const entryKey of [olderCapturedKey, manualKey, key]) {
        utimesSync(join(readingRoot, entryKey), originalReadTime, originalReadTime);
      }
      const readEvents = collectReadEventRequests(page, backendPort);

      await page.goto(readerPageUrl(extensionId, backendPort, key), {
        waitUntil: "domcontentloaded",
      });
      await page.locator("#viewer canvas").first().waitFor();
      await waitForReadEventCount(readEvents, 1);
      assertReadEventBodies(readEvents, [key]);
      const currentEntry = await waitForBackendLibraryEntry(
        backendPort,
        key,
        (entry) => readTimestamp(entry.last_read) > readTimestamp(entry.first_read),
      );
      expect(readTimestamp(currentEntry.first_read)).toBe(originalReadTime.getTime());
      const backendEntries = await fetchBackendLibraryEntries(backendPort);
      for (const entryKey of [key, olderCapturedKey, manualKey]) {
        const entry = backendEntries.find((candidate) => candidate.key === entryKey);
        assert(entry !== undefined);
        expect(Number.isFinite(readTimestamp(entry.first_read))).toBe(true);
        expect(Number.isFinite(readTimestamp(entry.last_read))).toBe(true);
      }

      const visibleReaderUrl = new URL(page.url());
      expect(visibleReaderUrl.hostname).toBe(extensionId);
      assertReaderFrameUrl(visibleReaderUrl.href, key);
      expect(page.url()).not.toContain("markdown-editor.localhost");
      const readerScreenshotPath = join(
        artifacts.root,
        "issue10-extension-reader.png",
      );
      await page.screenshot({ path: readerScreenshotPath });
      assertPng(readerScreenshotPath);

      const pageInput = page.locator("#pageNumber");
      await pageInput.fill("3");
      await pageInput.press("Enter");
      await expectInputValue(pageInput, (value) => value === "3");
      await page.locator("#zoomInButton").click();
      const zoomPercent = await currentViewerZoomPercent(page);
      expect(readEvents.length).toBe(1);
      await page.locator("#toggle-more").click();
      await page.locator('.menu-item[data-action="copy-view-link"]').click();
      await page.waitForFunction(() =>
        navigator.clipboard.readText().then((text) => text.length > 0),
      );
      const copiedViewUrl = await page.evaluate(() => navigator.clipboard.readText());
      const copiedView = new URL(copiedViewUrl);
      expect(copiedView.pathname).toBe(pdfPathForScenario("large-numdam-pdf"));
      const viewLink = copiedView.searchParams.getAll("mathread-link").at(-1);
      assert(viewLink !== undefined && viewLink.startsWith("v1."));

      await page.goto(copiedViewUrl, { waitUntil: "domcontentloaded" });
      const restoredReader = await waitForReaderFrame(page, key);
      await waitForReadEventCount(readEvents, 2);
      assertReadEventBodies(readEvents, [key, key]);
      await expectInputValue(
        restoredReader.locator("#pageNumber"),
        (value) => value === "3",
      );
      expect(await currentViewerZoomPercent(restoredReader)).toBe(zoomPercent);

      await restoredReader
        .locator('.nav-expand-btn[data-tab="notes"]')
        .click({ force: true });
      await expectElementText(
        restoredReader.locator("#notes-path"),
        (text) => text === key.replace(/\.pdf$/, ".md"),
      );
      const editor = restoredReader.locator("#ai-editor .cm-content");
      await editor.click();
      await page.keyboard.type("# issue10-probe\n");
      await waitForNoteSaved(
        backendPort,
        key,
        (text) => text.includes("issue10-probe"),
      );
      await expectElementText(
        restoredReader.locator("#notes-status"),
        (text) => text === "Saved",
      );
      const markdownScreenshotPath = join(
        artifacts.root,
        "issue10-extension-markdown.png",
      );
      await page.screenshot({ path: markdownScreenshotPath });
      assertPng(markdownScreenshotPath);

      await restoredReader
        .locator('.nav-expand-btn[data-tab="library"]')
        .click({ force: true });
      await waitForLibraryEntryCount(restoredReader, 3);
      await waitForLibraryOrder(restoredReader, [key, olderCapturedKey, manualKey]);
      const libraryScreenshotPath = join(
        artifacts.root,
        "issue10-extension-library-recently-read.png",
      );
      await page.screenshot({ path: libraryScreenshotPath });
      assertPng(libraryScreenshotPath);
      expect(readEvents.length).toBe(2);
      appendEvent(artifacts.eventsLogPath, {
        type: "issue10-extension-owned-proof",
        scenario: "large-numdam-pdf",
        readerScreenshotPath,
        markdownScreenshotPath,
        libraryScreenshotPath,
        currentViewUrl: copiedViewUrl,
      });
    },
  );
}, 120_000);
}

function registerCapturedRenderingBoundaryTests(): void {
test("built extension renders every page of a large captured PDF in the reader", async () => {
  const evidence = await runExtensionCapture("large-numdam-pdf");
  assertReaderFrameUrl(evidence.readerFrameUrl, evidence.key);
  evidence.cleanup();
}, 60_000);

test("reader renders all pages of a large PDF with real content", async () => {
  await withExtensionReader(
    async ({ backendPort, courseServer, extensionId, page }) => {
      const key = await preCapturePdfThroughBackend(
        backendPort,
        courseServer,
        "large-numdam-pdf",
      );
      // View-link restore: page/zoom params (forwarded from mrpage/mrzoom on the source
      // URL by pdf-launch) re-open the document at that view.
      await page.goto(`${readerPageUrl(extensionId, backendPort, key)}#page=3&zoom=90`, {
        waitUntil: "domcontentloaded",
      });

      await expectInputValue(page.locator("#scaleSelect"), (value) => value === "0.9");
      await expectInputValue(
        page.locator("#pageNumber"),
        (value) => value === "3",
      );

      // PDF.js bounds simultaneous canvas ownership. Navigate through the real reader
      // control so the late page enters that rendering window, then prove its canvas
      // contains the expected substantive ink rather than a blank placeholder.
      const pageInput = page.locator("#pageNumber");
      await pageInput.fill("6");
      await pageInput.press("Enter");
      await expectInputValue(pageInput, (value) => value === "6");
      await page
        .locator('#viewer .page[data-page-number="6"] canvas')
        .waitFor();
      const latePageCanvasIndex = await page
        .locator('#viewer .page[data-page-number="6"] canvas')
        .evaluate((latePageCanvas) =>
          Array.from(document.querySelectorAll("#viewer canvas")).indexOf(
            latePageCanvas,
          ),
        );
      const rendered = await canvasPixelEvidence(page, latePageCanvasIndex);
      expect(rendered.canvasSize).toBeGreaterThan(10_000);
      expect(rendered.nonWhitePixels).toBeGreaterThan(250);
    },
  );
}, 60_000);

test("built extension fails loudly when the capture backend is down", async () => {
  await runBackendUnavailable();
}, 60_000);
}

export function registerNumdamRenderingBoundaryTest(): void {
test("installed reader copies source-preserving current and plain links for the canonical Numdam PDF", async () => {
  await withExtensionReader(
    async ({ artifacts, backendPort, context, extensionId, page }) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(String(error)));
      const numdamBytes = await numdamFixtureBytes();
      const numdamSourceUrl = `${numdamRegressionPdfUrl}?title=source%20owned~query&mathread-view=source-owned&mathread-link=v1.source-owned`;
      const key = await preCaptureExternalPdfThroughBackend(
        backendPort,
        numdamSourceUrl,
        numdamBytes,
      );
      // The installed extension still performs the source fetch. Fulfill only its
      // service-worker fetch from the hash-verified canonical Numdam fixture so
      // the DNR/pdf-launch source handoff remains deterministic.
      let sourceFixtureFetches = 0;
      await context.route(
        (url) => url.toString().startsWith(numdamRegressionPdfUrl),
        async (route, request) => {
          if (request.serviceWorker() === null) {
            await route.continue();
            return;
          }
          sourceFixtureFetches += 1;
          await route.fulfill({
            contentType: "application/pdf",
            path: numdamFixturePath,
          });
        },
      );
      await page.goto(readerPageUrl(extensionId, backendPort, key), {
        waitUntil: "domcontentloaded",
      });
      await page.locator("#viewer canvas").first().waitFor();
      await expectElementText(
        page.locator("#numPages"),
        (text) => text.includes("265"),
      );
      const pageInput = page.locator("#pageNumber");
      await pageInput.fill("6");
      await pageInput.press("Enter");
      await expectInputValue(pageInput, (value) => value === "6");
      await page
        .locator('#viewer .page[data-page-number="6"] canvas')
        .waitFor();
      const latePageCanvasIndex = await page
        .locator('#viewer .page[data-page-number="6"] canvas')
        .evaluate((latePageCanvas) =>
          Array.from(document.querySelectorAll("#viewer canvas")).indexOf(
            latePageCanvas,
          ),
        );
      const rendered = await canvasPixelEvidence(page, latePageCanvasIndex);
      expect(rendered.canvasSize).toBeGreaterThan(10_000);
      expect(rendered.nonWhitePixels).toBeGreaterThan(250);
      await page.locator("#zoomInButton").click();
      const zoomPercent = await currentViewerZoomPercent(page);
      const capturedViewport = await page.locator("#viewerContainer").evaluate((viewer) => {
        const pageElement = document.querySelector(
          '#viewer .page[data-page-number="6"]',
        );
        if (!(pageElement instanceof HTMLElement)) {
          throw new Error("Numdam page 6 is unavailable");
        }
        viewer.scrollTop = pageElement.offsetTop + 132;
        return {
          x: Math.max(0, viewer.scrollLeft - pageElement.offsetLeft) / 1.1,
          y: Math.max(0, viewer.scrollTop - pageElement.offsetTop) / 1.1,
        };
      });
      expect(capturedViewport.y).toBeCloseTo(120, 0);
      await page.locator("#toggle-more").click();
      const desktopMenuPath = join(
        artifacts.root,
        "numdam-copy-actions-desktop.png",
      );
      await page.screenshot({ path: desktopMenuPath });
      assertPng(desktopMenuPath);
      await page.evaluate(() => navigator.clipboard.writeText(""));
      await page.locator('.menu-item[data-action="copy-view-link"]').click();
      await page.waitForFunction(() =>
        navigator.clipboard.readText().then((text) => text.length > 0),
      );
      const copiedViewUrl = await page.evaluate(() => navigator.clipboard.readText());
      const copiedView = new URL(copiedViewUrl);
      expect(copiedView.origin).toBe("https://www.numdam.org");
      expect(copiedView.pathname).toBe("/item/AST_1992__211__1_0.pdf");
      expect(copiedView.searchParams.get("mathread-view")).toBe("source-owned");
      const viewLinks = copiedView.searchParams.getAll("mathread-link");
      expect(viewLinks[0]).toBe("v1.source-owned");
      const viewLink = viewLinks[viewLinks.length - 1];
      if (viewLink === undefined) {
        throw new Error("Current-view link omitted its MathRead view state");
      }
      if (!viewLink.startsWith("v1.")) {
        throw new Error("Current-view link omitted its MathRead view state");
      }
      const viewState = atob(viewLink.slice(3));
      const [version, pageNumber, viewportX, viewportY, zoom] = viewState.split(":");
      expect(version).toBe("v1");
      expect(pageNumber).toBe("6");
      expect(zoom).toBe((zoomPercent / 100).toFixed(2));
      expect(Number.isFinite(Number(viewportX))).toBe(true);
      expect(Number(viewportY)).toBeGreaterThan(0);
      await page.locator("#toggle-more").click();
      await page.evaluate(() => navigator.clipboard.writeText(""));
      await page.locator('.menu-item[data-action="copy-plain-link"]').click();
      await waitForClipboardText(page, numdamSourceUrl);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator("#toggle-more").click();
      expect(
        await page.locator("#more-menu").isVisible(),
      ).toBe(true);
      const narrowMenuPath = join(
        artifacts.root,
        "numdam-copy-actions-narrow.png",
      );
      await page.screenshot({ path: narrowMenuPath });
      assertPng(narrowMenuPath);
      await page.locator("#toggle-more").click();
      await page.setViewportSize({ width: 1280, height: 720 });
      const plainLaunchUrl = new URL(
        `chrome-extension://${extensionId}/pdf-launch.html`,
      );
      plainLaunchUrl.searchParams.set("file", numdamSourceUrl);
      await page.goto(plainLaunchUrl.href, { waitUntil: "domcontentloaded" });
      await waitForReaderFrame(page, key);
      await page.goto(copiedViewUrl, { waitUntil: "domcontentloaded" });
      const restoredReader = await waitForReaderFrame(page, key);
      expect(sourceFixtureFetches).toBe(1);
      await expectInputValue(
        restoredReader.locator("#pageNumber"),
        (value) => value === "6",
      );
      expect(await currentViewerZoomPercent(restoredReader)).toBe(zoomPercent);
      await restoredReader.waitForFunction(() => {
        const viewer = document.getElementById("viewerContainer");
        const pageElement = document.querySelector(
          '#viewer .page[data-page-number="6"]',
        );
        if (!(viewer instanceof HTMLElement)) {
          return false;
        }
        if (!(pageElement instanceof HTMLElement)) {
          return false;
        }
        return viewer.scrollTop - pageElement.offsetTop > 5;
      });
      await restoredReader.locator("#toggle-more").click();
      await restoredReader.locator('.menu-item[data-action="copy-view-link"]').click();
      await waitForClipboardText(page, copiedViewUrl);
      const screenshotPath = join(
        artifacts.root,
        "numdam-page-6.png",
      );
      await page.screenshot({ path: screenshotPath });
      assertPng(screenshotPath);
      appendEvent(artifacts.eventsLogPath, {
        type: "numdam-source-link-proof",
        path: screenshotPath,
        currentViewUrl: copiedViewUrl,
        plainLinkUrl: numdamSourceUrl,
        desktopMenuPath,
        narrowMenuPath,
      });
      expect(pageErrors).toEqual([]);
    },
  );
}, 120_000);
}

export function registerReaderNotesBoundaryTests(): void {
  registerNoteEditingBoundaryTests();
  registerNoteMigrationBoundaryTests();
}

function registerNoteEditingBoundaryTests(): void {
test("reader Notes panel persists notes to the on-disk markdown file and renders a live preview", async () => {
  await withExtensionReader(
    async ({ backendPort, courseServer, extensionId, page, readingRoot }) => {
      const key = await preCapturePdfThroughBackend(
        backendPort,
        courseServer,
        "direct-pdf-tab",
      );
      await page.goto(readerPageUrl(extensionId, backendPort, key), {
        waitUntil: "domcontentloaded",
      });
      await waitForCanvasCount(page, 1);

      await page.locator('.nav-expand-btn[data-tab="notes"]').click();
      await expectElementText(
        page.locator("#notes-path"),
        (text) => text === key.replace(/\.pdf$/, ".md"),
      );
      const editor = page.locator("#ai-editor .cm-content");
      await editor.click();
      await page.keyboard.type("# Heading\n\nSome **bold** text.");

      // Debounced autosave writes the markdown sidecar next to the stored PDF.
      const noteText = await waitForNoteSaved(
        backendPort,
        key,
        (text) => text.includes("# Heading") && text.includes("**bold**"),
      );
      const notePath = join(readingRoot, key.replace(/\.pdf$/, ".md"));
      expect(readFileSync(notePath, "utf8")).toBe(noteText);
      await expectElementText(
        page.locator("#notes-status"),
        (text) => text === "Saved",
      );

      // Live preview renders sanitized GFM from the same buffer.
      await page.locator("#notes-mode-preview").click();
      await expectElementText(
        page.locator("#notes-preview h1"),
        (text) => text === "Heading",
      );
      await expectElementText(
        page.locator("#notes-preview strong"),
        (text) => text === "bold",
      );

      // Reload: the editor restores from the sidecar, not any browser-local store.
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator('.nav-expand-btn[data-tab="notes"]').click();
      await expectElementText(
        page.locator("#ai-editor .cm-content"),
        (text) => text.includes("Heading") && text.includes("bold"),
      );
    },
  );
}, 60_000);

test("reader Key Points panel blocks stale autosave and resolves disk conflicts", async () => {
  await withExtensionReader(
    async ({ backendPort, courseServer, extensionId, page, readingRoot }) => {
      const key = await preCapturePdfThroughBackend(
        backendPort,
        courseServer,
        "direct-pdf-tab",
      );
      const sidecarPath = join(readingRoot, key.replace(/\.pdf$/, ".md"));

      await page.goto(readerPageUrl(extensionId, backendPort, key), {
        waitUntil: "domcontentloaded",
      });
      await waitForCanvasCount(page, 1);
      await page.locator('.nav-expand-btn[data-tab="notes"]').click();

      const editor = page.locator("#ai-editor .cm-content");
      await editor.click();
      await page.keyboard.type("original buffer");
      await waitForNoteSaved(
        backendPort,
        key,
        (text) => text === "original buffer",
      );
      await expectElementText(
        page.locator("#notes-status"),
        (text) => text === "Saved",
      );

      writeFileSync(sidecarPath, "disk edit from another tab\n");
      await editor.click();
      await page.keyboard.type("\nstale local edit");
      await expectElementText(
        page.locator("#notes-status"),
        (text) => text === "Save failed: conflict",
      );
      await expectElementText(page.locator("#notes-error"), (text) =>
        text.includes("modified on disk"),
      );
      expect(readFileSync(sidecarPath, "utf8")).toBe(
        "disk edit from another tab\n",
      );

      await page.getByRole("button", { name: "Load from Disk" }).click();
      await expectElementText(
        page.locator("#notes-status"),
        (text) => text === "Saved",
      );
      await expectElementText(
        editor,
        (text) =>
          text.includes("disk edit from another tab") &&
          !text.includes("stale local edit"),
      );

      writeFileSync(sidecarPath, "second disk edit from another tab\n");
      await editor.click();
      await page.keyboard.type("\noverwrite local edit");
      await expectElementText(
        page.locator("#notes-status"),
        (text) => text === "Save failed: conflict",
      );
      expect(readFileSync(sidecarPath, "utf8")).toBe(
        "second disk edit from another tab\n",
      );

      await page.getByRole("button", { name: "Overwrite Disk" }).click();
      await waitForNoteSaved(
        backendPort,
        key,
        (text) =>
          text.includes("overwrite local edit") &&
          !text.includes("second disk edit"),
      );
      await expectElementText(
        page.locator("#notes-status"),
        (text) => text === "Saved",
      );
    },
  );
}, 60_000);

}

function registerNoteMigrationBoundaryTests(): void {

test("reader Key Points panel surfaces a loud error when the backend dies (no localStorage fallback)", async () => {
  await withExtensionReader(
    async ({ backend, backendPort, courseServer, extensionId, page }) => {
      const key = await preCapturePdfThroughBackend(
        backendPort,
        courseServer,
        "direct-pdf-tab",
      );
      await page.goto(readerPageUrl(extensionId, backendPort, key), {
        waitUntil: "domcontentloaded",
      });
      await waitForCanvasCount(page, 1);

      backend.process.kill();
      await backend.process.exited;

      // The note loaded at boot; with the backend gone, the autosave PUT must surface a
      // visible save failure - never fall back to a browser-local store.
      await page.locator('.nav-expand-btn[data-tab="notes"]').click();
      const editor = page.locator("#ai-editor .cm-content");
      await editor.click();
      await page.keyboard.type("orphaned edit");
      await expectElementText(page.locator("#notes-status"), (text) =>
        text.startsWith("Save failed:"),
      );
    },
  );
}, 60_000);

test("reader keeps legacy highlight source until migration is durably saved", async () => {
  await withExtensionReader(
    async ({ backendPort, courseServer, extensionId, page }) => {
      const key = await preCapturePdfThroughBackend(
        backendPort,
        courseServer,
        "direct-pdf-tab",
      );
      await seedLegacyReaderState(
        page,
        extensionId,
        key,
        [legacyHighlight()],
        15_000,
      );

      await page.goto(readerPageUrl(extensionId, backendPort, key), {
        waitUntil: "domcontentloaded",
      });
      await waitForCanvasCount(page, 1);
      await page.locator('.nav-expand-btn[data-tab="notes"]').click();

      await expectElementText(page.locator("#ai-editor .cm-content"), (text) =>
        text.includes("legacy lattice quote"),
      );
      await expectElementText(
        page.locator("#notes-status"),
        (text) => text === "Unsaved changes",
      );
      expect(await legacyHighlightsRaw(page, key)).not.toBeNull();
    },
  );
}, 120_000);

test("legacy highlight migration rejects incomplete records instead of fabricating defaults", async () => {
  await withExtensionReader(
    async ({ backendPort, courseServer, extensionId, page }) => {
      const key = await preCapturePdfThroughBackend(
        backendPort,
        courseServer,
        "direct-pdf-tab",
      );
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

      await page.goto(readerPageUrl(extensionId, backendPort, key), {
        waitUntil: "domcontentloaded",
      });
      await waitForCanvasCount(page, 1);
      await page.locator('.nav-expand-btn[data-tab="notes"]').click();
      await expectElementText(
        page.locator("#notes-status"),
        (text) => text === "Saved" || text === "Unsaved changes",
      );

      const editorText = await page
        .locator("#ai-editor .cm-content")
        .innerText();
      expect(editorText).not.toContain("1970-01-01T00:00:00.000Z");
      expect(editorText).not.toContain(
        "legacy highlight missing required fields",
      );
      expect(await legacyHighlightsRaw(page, key)).not.toBeNull();
    },
  );
}, 120_000);
}

export function registerReaderRenderingBoundaryTests(): void {
  registerReaderNavigationBoundaryTests();
  registerReaderRenderingSemanticsBoundaryTests();
}

function registerReaderNavigationBoundaryTests(): void {
test("reader presents the MathRead library without constructing a custom PDF viewer", async () => {
  await withExtensionReader(async ({ artifacts, extensionId, page }) => {
    await page.goto(`chrome-extension://${extensionId}/reader/library.html`, {
      waitUntil: "domcontentloaded",
    });
    await page.locator('.nav-expand-btn[data-tab="library"]').click();
    await page.locator('[data-testid="library-open-root"]').waitFor();
    expect(await page.locator("#viewer").count()).toBe(0);
    expect(await page.locator("#pageNumber").count()).toBe(0);
    const screenshotPath = join(artifacts.root, "reader-library.png");
    await page.screenshot({ path: screenshotPath });
    assertPng(screenshotPath);
  });
}, 120_000);

test("reader delegates stable responsive navigation to the PDF.js viewer", async () => {
  await withExtensionReader(
    async ({ artifacts, backendPort, courseServer, extensionId, page }) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(String(error)));
      const key = await preCapturePdfThroughBackend(
        backendPort,
        courseServer,
        "large-numdam-pdf",
      );
      await page.goto(readerPageUrl(extensionId, backendPort, key), {
        waitUntil: "domcontentloaded",
      });
      const pages = page.locator("#viewer .page");
      await pages.first().waitFor();
      await expectInputValue(page.locator("#pageNumber"), (value) => value === "1");
      expect(await page.locator("#page-input").count()).toBe(0);

      await pages.first().evaluate((element) => {
        element.setAttribute("data-stability-witness", "original-page-view");
      });
      await page.locator("#zoomInButton").click();
      await page.locator("#rotateCwButton").click();
      await page.locator("#zoomOutButton").click();
      expect(await page.locator('[data-stability-witness="original-page-view"]').count()).toBe(1);

      await page.locator("body").click({ position: { x: 700, y: 300 } });
      await page.keyboard.press("PageDown");
      await page.keyboard.press("PageDown");
      await expectInputValue(page.locator("#pageNumber"), (value) => value === "3");
      await page.screenshot({ path: join(artifacts.root, "viewer-desktop.png") });

      await page.locator("#scaleSelect").selectOption("page-width");
      await page.evaluate(() => {
        document.documentElement.dataset.resizeProofCount = "0";
        window.addEventListener("resize", () => {
          const current = Number(
            document.documentElement.dataset.resizeProofCount,
          );
          document.documentElement.dataset.resizeProofCount = String(current + 1);
        });
        window.addEventListener("error", (event) => {
          document.documentElement.dataset.resizeProofError = event.message;
        });
      });

      const initialGeometry = await waitForFitWidthConvergence(
        page,
        "initial",
      );
      await page.locator('.nav-expand-btn[data-tab="library"]').click();
      const overlayGeometry = await waitForFitWidthConvergence(
        page,
        "library-overlay",
      );
      expect(overlayGeometry.clientWidth).toBe(initialGeometry.clientWidth);

      const pageWidths: number[] = [];
      for (const viewport of [
        { width: 390, height: 844 },
        { width: 1100, height: 720 },
        { width: 480, height: 800 },
        { width: 900, height: 700 },
        { width: 390, height: 844 },
      ]) {
        const previousResizeCount = Number(
          await page.locator("html").getAttribute("data-resize-proof-count"),
        );
        await page.setViewportSize(viewport);
        await page.waitForFunction(
          (previousCount) =>
            Number(document.documentElement.dataset.resizeProofCount) >
            previousCount,
          previousResizeCount,
        );
        const geometry = await waitForFitWidthConvergence(
          page,
          `viewport-${viewport.width}x${viewport.height}`,
        );
        pageWidths.push(geometry.pageWidth);
        expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
      }
      assert(
        pageWidths[0] !== undefined &&
          pageWidths[1] !== undefined &&
          pageWidths[2] !== undefined &&
          pageWidths[3] !== undefined &&
          pageWidths[4] !== undefined,
      );
      expect(pageWidths[1]).toBeGreaterThan(pageWidths[0]);
      expect(pageWidths[2]).toBeLessThan(pageWidths[1]);
      expect(pageWidths[3]).toBeGreaterThan(pageWidths[2]);
      expect(pageWidths[4]).toBeLessThan(pageWidths[3]);

      await page.screenshot({ path: join(artifacts.root, "viewer-mobile.png") });
      const toolbarGeometry = await page.locator(".toolbar").evaluate((toolbar) => ({
        clientWidth: toolbar.clientWidth,
        scrollWidth: toolbar.scrollWidth,
      }));
      expect(toolbarGeometry.scrollWidth).toBeLessThanOrEqual(toolbarGeometry.clientWidth);
      expect(await page.locator("#scaleSelect").isVisible()).toBe(true);
      expect(pageErrors).toEqual([]);
      expect(
        await page.locator("html").getAttribute("data-resize-proof-error"),
      ).toBeNull();
    },
  );
}, 120_000);

test("reader exposes the upstream PDF.js application controls", async () => {
  await withExtensionReader(
    async ({ backendPort, courseServer, extensionId, page }) => {
      const key = await preCapturePdfThroughBackend(
        backendPort,
        courseServer,
        "large-numdam-pdf",
      );
      await page.goto(readerPageUrl(extensionId, backendPort, key), {
        waitUntil: "domcontentloaded",
      });
      await page.locator("#viewer canvas").first().waitFor();

      const pageNumber = page.locator("#pageNumber");
      await expectInputValue(pageNumber, (value) => value === "1");
      await page.locator("#next").click();
      await expectInputValue(pageNumber, (value) => value === "2");

      await page.locator("#viewFindButton").click();
      await page.locator("#findInput").fill("MathRead");
      await page.locator("#findbar").evaluate((element) =>
        !element.classList.contains("hidden"),
      );
    },
  );
}, 120_000);

}

function registerReaderRenderingSemanticsBoundaryTests(): void {

test("persisted fit-width setting controls ordinary reader opens without a zoom override", async () => {
  await withExtensionReader(
    async ({ artifacts, backendPort, context, courseServer, extensionId, page }) => {
      const key = await preCapturePdfThroughBackend(
        backendPort,
        courseServer,
        "large-numdam-pdf",
      );
      await persistFitWidthOnOpen(context);
      const ordinaryOpenUrl = readerPageUrl(extensionId, backendPort, key);
      expect(new URL(ordinaryOpenUrl).searchParams.has("zoom")).toBe(false);

      await page.setViewportSize({ width: 600, height: 760 });
      await page.goto(ordinaryOpenUrl, { waitUntil: "domcontentloaded" });
      await page.locator("#viewer .page").first().waitFor();
      const narrow = await waitForFitWidthConvergence(
        page,
        "persisted-setting-narrow",
      );
      await page.screenshot({
        path: join(artifacts.root, "persisted-fit-width-narrow.png"),
      });

      await page.setViewportSize({ width: 1000, height: 760 });
      const wide = await waitForFitWidthConvergence(
        page,
        "persisted-setting-wide",
      );
      await page.screenshot({
        path: join(artifacts.root, "persisted-fit-width-wide.png"),
      });
      expect(wide.clientWidth).toBeGreaterThan(narrow.clientWidth + 300);
      expect(wide.pageWidth).toBeGreaterThan(narrow.pageWidth + 300);

      await page.setViewportSize({ width: 600, height: 760 });
      const narrowAgain = await waitForFitWidthConvergence(
        page,
        "persisted-setting-narrow-again",
      );
      expect(
        Math.abs(narrowAgain.pageWidth - narrow.pageWidth),
      ).toBeLessThanOrEqual(1);
    },
  );
}, 120_000);

registerReaderHistoryBoundaryTest();
registerReaderPdfJsSemanticsBoundaryTest();
registerInterceptedReaderShortcutsBoundaryTest();

}

function registerReaderHistoryBoundaryTest(): void {

test("reader hands native Alt-left and Alt-right to browser history without a PDF-internal destination", async () => {
  await withExtensionReader(
    async ({ artifacts, backendPort, courseServer, page, readingRoot, x11Display }) => {
      assert(x11Display !== undefined, "Native browser shortcut proof requires an X11 display");
      const sourceUrl = `${courseServer.url.origin}/internal-link.pdf`;
      const readEventRequests = collectReadEventRequests(page, backendPort);
      await page.goto(`${courseServer.url.origin}/course/`, {
        waitUntil: "domcontentloaded",
      });
      await page.goto(sourceUrl, { waitUntil: "domcontentloaded" });

      const storedPath = await waitForStoredPdf(readingRoot);
      const key = storedKeyFromPath(storedPath);
      const reader = await waitForReaderFrame(page, key);
      await reader.locator("#viewer canvas").first().waitFor();
      await waitForReadEventCount(readEventRequests, 1);
      expect(await reader.locator("#pageNumber").inputValue()).toBe("1");
      expect(await reader.evaluate(() => {
        document.body.focus();
        return document.hasFocus() && document.activeElement === document.body;
      })).toBe(true);
      await page.screenshot({ path: join(artifacts.root, "browser-history-reader.png") });
      assertPng(join(artifacts.root, "browser-history-reader.png"));

      await page.bringToFront();
      await reader.locator("#viewer").click({ position: { x: 20, y: 20 } });
      const atCoursePage = page.waitForURL(`${courseServer.url.origin}/course/`);
      sendNativeHistoryShortcut(x11Display, "Left");
      await atCoursePage;
      await page.screenshot({ path: join(artifacts.root, "browser-history-parent.png") });
      assertPng(join(artifacts.root, "browser-history-parent.png"));
      const atReader = page.waitForURL((url) => (
        isReaderDocumentUrl(url, key)
      ));
      sendNativeHistoryShortcut(x11Display, "Right");
      await atReader;
      const returnedReader = await waitForReaderFrame(page, key);
      await returnedReader.locator("#viewer canvas").first().waitFor();
      await waitForReadEventCount(readEventRequests, 2);
      assertReadEventBodies(readEventRequests, [key, key]);
    },
    { nativeBrowserShortcuts: true },
  );
}, 120_000);

test("reader preserves PDF-internal history through the production launch redirect", async () => {
  await withExtensionReader(
    async ({ artifacts, backendPort, courseServer, page, readingRoot, x11Display }) => {
      assert(x11Display !== undefined, "Native browser shortcut proof requires an X11 display");
      const sourceUrl = `${courseServer.url.origin}/internal-link.pdf`;
      const readEventRequests = collectReadEventRequests(page, backendPort);
      await page.goto(`${courseServer.url.origin}/course/`, {
        waitUntil: "domcontentloaded",
      });
      await page.goto(sourceUrl, { waitUntil: "domcontentloaded" });

      const storedPath = await waitForStoredPdf(readingRoot);
      const key = storedKeyFromPath(storedPath);
      const reader = await waitForReaderFrame(page, key);
      await reader.locator("#viewer canvas").first().waitFor();
      await waitForReadEventCount(readEventRequests, 1);
      const launchUrl = new URL(page.url());
      assertReaderFrameUrl(launchUrl.href, key);

      const readView = () => reader.evaluate(() => {
        const pageInput = document.getElementById("pageNumber");
        const zoom = document.getElementById("scaleSelect");
        const viewer = document.getElementById("viewerContainer");
        if (
          !(pageInput instanceof HTMLInputElement)
          || !(zoom instanceof HTMLSelectElement)
          || !(viewer instanceof HTMLElement)
        ) {
          throw new TypeError("Expected the PDF.js application navigation controls");
        }
        return {
          page: pageInput.value,
          scrollTop: viewer.scrollTop,
          zoom: zoom.value,
        };
      });

      await reader.locator("#zoomInButton").click();
      const beforeLink = await readView();
      expect(beforeLink.page).toBe("1");
      await page.screenshot({ path: join(artifacts.root, "production-history-before-link.png") });
      assertPng(join(artifacts.root, "production-history-before-link.png"));

      const internalLink = reader.locator('#viewer .annotationLayer a').first();
      await internalLink.click();
      await reader.waitForFunction(() => {
        const input = document.getElementById("pageNumber");
        return input instanceof HTMLInputElement && input.value === "2";
      });
      const afterLink = await readView();
      expect(afterLink.page).toBe("2");
      await page.screenshot({ path: join(artifacts.root, "production-history-after-link.png") });
      assertPng(join(artifacts.root, "production-history-after-link.png"));

      // A real X11 shortcut traverses the PDF.js entry that the internal link created;
      // MathRead neither classifies nor consumes that browser history.
      await page.bringToFront();
      await reader.locator("#viewer").click({ position: { x: 20, y: 20 } });
      sendNativeHistoryShortcut(x11Display, "Left");
      await reader.waitForFunction((expected) => {
        const input = document.getElementById("pageNumber");
        const viewer = document.getElementById("viewerContainer");
        return input instanceof HTMLInputElement
          && viewer instanceof HTMLElement
          && input.value === expected.page
          && Math.abs(viewer.scrollTop - expected.scrollTop) <= 2;
      }, beforeLink);

      sendNativeHistoryShortcut(x11Display, "Right");
      await reader.waitForFunction((expected) => {
        const input = document.getElementById("pageNumber");
        const viewer = document.getElementById("viewerContainer");
        return input instanceof HTMLInputElement
          && viewer instanceof HTMLElement
          && input.value === expected.page
          && Math.abs(viewer.scrollTop - expected.scrollTop) <= 2;
      }, afterLink);
      const afterBrowserHistoryForward = await readView();
      expect(afterBrowserHistoryForward.zoom).toBe(afterLink.zoom);
      assertReadEventBodies(readEventRequests, [key]);
    },
    { nativeBrowserShortcuts: true },
  );
}, 120_000);

}

function registerReaderPdfJsSemanticsBoundaryTest(): void {

test("reader preserves PDF.js rotation, DPR, links, find, and JBig2 semantics", async () => {
  await withExtensionReader(
    async ({ backendPort, context, extensionId, page, readingRoot }) => {
      const fixtureRoot = join("tests", "fixtures", "pdfjs");
      const fixtureNames = [
        "annotation-link-text-popup.pdf",
        "hello_world_rotated.pdf",
        "extract_link.pdf",
        "copy_paste_ligatures.pdf",
        "cross-span-search.pdf",
        "bitmap-symbol-textcomposite.pdf",
      ];
      for (const fixtureName of fixtureNames) {
        writeFileSync(
          join(readingRoot, fixtureName),
          readFileSync(join(fixtureRoot, fixtureName)),
        );
      }

      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: 900,
        height: 900,
        deviceScaleFactor: 2,
        mobile: false,
      });

      await page.goto(readerPageUrl(extensionId, backendPort, "hello_world_rotated.pdf"), {
        waitUntil: "domcontentloaded",
      });
      const rotatedPage = page.locator('#viewer .page[data-page-number="1"]');
      const rotatedCanvas = rotatedPage.locator("canvas");
      await rotatedCanvas.waitFor();
      const rotatedGeometry = await rotatedPage.evaluate((element) => ({
        width: element.clientWidth,
        height: element.clientHeight,
      }));
      expect(rotatedGeometry.width).toBeGreaterThan(rotatedGeometry.height);
      const dprGeometry = await rotatedCanvas.evaluate<
        { backingWidth: number; cssWidth: number; devicePixelRatio: number },
        HTMLCanvasElement
      >((canvas) => ({
        backingWidth: canvas.width,
        cssWidth: canvas.getBoundingClientRect().width,
        devicePixelRatio: window.devicePixelRatio,
      }));
      expect(dprGeometry.devicePixelRatio).toBe(2);
      expect(Math.abs(dprGeometry.backingWidth - 2 * dprGeometry.cssWidth)).toBeLessThanOrEqual(2);

      await page.goto(readerPageUrl(extensionId, backendPort, "extract_link.pdf"), {
        waitUntil: "domcontentloaded",
      });
      const internalLink = page.locator('#viewer .annotationLayer a').first();
      await internalLink.waitFor();
      await internalLink.click();
      await page.waitForFunction(() => {
        const input = document.getElementById("pageNumber");
        return input instanceof HTMLInputElement && input.value === "2";
      });
      expect(await page.locator("#pageNumber").inputValue()).toBe("2");

      await page.goto(readerPageUrl(extensionId, backendPort, "annotation-link-text-popup.pdf"), {
        waitUntil: "domcontentloaded",
      });
      const externalLink = page.locator('#viewer .annotationLayer a[href="http://www.mozilla.org/"]');
      await externalLink.waitFor();
      const externalPagePromise = context.waitForEvent("page");
      await externalLink.click();
      const externalPage = await externalPagePromise;
      await externalPage.waitForLoadState("domcontentloaded");
      expect(new URL(externalPage.url()).hostname).toBe("www.mozilla.org");
      await externalPage.close();

      for (const [fixtureName, query] of [
        ["copy_paste_ligatures.pdf", "ffi"],
        ["cross-span-search.pdf", "theorem 4.2"],
      ] as const) {
        await page.goto(readerPageUrl(extensionId, backendPort, fixtureName), {
          waitUntil: "domcontentloaded",
        });
        await page.locator("#viewFindButton").click();
        await page.locator("#findInput").fill(query);
        await expectElementText(
          page.locator("#findResultsCount"),
          (text) => /^1 (?:of|\/) [1-9]\d*$/.test(text),
        );
      }

      await page.goto(readerPageUrl(extensionId, backendPort, "bitmap-symbol-textcomposite.pdf"), {
        waitUntil: "domcontentloaded",
      });
      const jbig2Evidence = await canvasPixelEvidence(page, 0);
      expect(jbig2Evidence.canvasSize).toBeGreaterThan(10_000);
      expect(jbig2Evidence.nonWhitePixels).toBeGreaterThan(250);
    },
  );
}, 120_000);

}

function registerInterceptedReaderShortcutsBoundaryTest(): void {

test("PDF.js owns reader controls while the MathRead Notes editor remains isolated", async () => {
  await withExtensionReader(
    async ({ courseServer, page, readingRoot }) => {
      await page.goto(`${courseServer.url.origin}/notes.pdf`);
      const storedPath = await waitForStoredPdf(readingRoot);
      const key = storedKeyFromPath(storedPath);
      const reader = await waitForReaderFrame(page, key);
      await reader.locator("#viewer .page canvas").first().waitFor();

      const initialZoom = await currentViewerZoomPercent(reader);
      await reader.locator("#zoomInButton").click();
      expect(await currentViewerZoomPercent(reader)).toBeGreaterThan(initialZoom);
      expect(await page.evaluate(() => window.devicePixelRatio)).toBe(1);

      await reader.locator('.nav-expand-btn[data-tab="notes"]').click();
      const editor = reader.locator("#ai-editor .cm-content");
      await editor.waitFor();
      await editor.click();
      const pageBeforeEditorKeys = await reader.locator("#pageNumber").inputValue();
      await page.keyboard.press("End");
      expect(await reader.locator("#pageNumber").inputValue()).toBe(pageBeforeEditorKeys);
    },
  );
}, 120_000);
}

function readerPageUrl(extensionId: string, backendPort: number, key: string): string {
  const file = `http://127.0.0.1:${backendPort}/pdf/${encodeURIComponent(key)}`;
  return `chrome-extension://${extensionId}/reader/reader.html?file=${encodeURIComponent(file)}`;
}

function assertReaderFrameUrl(url: string, expectedKey: string): void {
  const parsed = new URL(url);
  expect(parsed.protocol).toBe("chrome-extension:");
  expect(isReaderDocumentUrl(parsed, expectedKey)).toBe(true);
}

function isReaderDocumentUrl(url: URL, expectedKey: string): boolean {
  return decodeURIComponent(url.pathname).endsWith(`/pdf/${expectedKey}`);
}

async function runBackendUnavailable(): Promise<void> {
  const backendPort = await unusedTcpPort();
  const testRoot = mkdtemp("mathread-extension-backend-down-");
  const artifacts = createCaptureArtifacts(testRoot, "clicked-link");
  const extensionPath = configuredExtensionCopy(testRoot, backendPort);
  const courseServer = startCourseServer(artifacts.eventsLogPath);
  let context: BrowserContext | undefined;
  let completed = false;

  try {
    context = await chromium.launchPersistentContext(
      join(testRoot, "profile"),
      {
        executablePath: chromiumExecutablePath(),
        headless: true,
        artifactsDir: artifacts.root,
        args: [
          `--disable-extensions-except=${extensionPath}`,
          `--load-extension=${extensionPath}`,
        ],
      },
    );
    const serviceWorker = await waitForExtensionServiceWorker(context);
    await waitForPdfRedirectRule(serviceWorker);
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

    // No backend means the extension-owned launch document remains visible with a loud
    // capture error; Chrome's PDF viewer is never used as a failure fallback.
    await expectElementText(page.locator("#mathread-pdf-launch.failed"), (text) =>
      text.includes("MathRead could not open this PDF"),
    );
    await page.screenshot({ path: artifacts.screenshotAfterPath });
    assertPng(artifacts.screenshotAfterPath);
    await page.close();
    completed = true;
  } finally {
    if (context !== undefined) {
      await context.close();
    }
    courseServer.stop(true);
    if (completed) {
      rmSync(testRoot, { recursive: true, force: true });
    }
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
  const backend = startMathReadBackend(
    backendPort,
    readingRoot,
    artifacts.backendLogPath,
  );
  const courseServer = startCourseServer(
    artifacts.eventsLogPath,
    launchCaptureDelayMs,
  );
  let context: BrowserContext | undefined;

  try {
    await waitForHttpService(`http://127.0.0.1:${backendPort}/openapi.json`);
    if (options.preExistingCapture === true) {
      await preCapturePdfThroughBackend(backendPort, courseServer, scenario);
    }

    // No context.tracing here: Playwright tracing's screencast/snapshot CDP traffic
    // intermittently deadlocks the bun event loop under load, hanging the whole test.
    context = await chromium.launchPersistentContext(
      join(testRoot, "profile"),
      {
        executablePath: chromiumExecutablePath(),
        headless: true,
        artifactsDir: artifacts.root,
        args: [
          `--disable-extensions-except=${extensionPath}`,
          `--load-extension=${extensionPath}`,
        ],
      },
    );
    const serviceWorker = await waitForExtensionServiceWorker(context);
    await waitForPdfRedirectRule(serviceWorker);
    serviceWorker.on("console", (message) => {
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
    // `framenavigated` fires before the launch renderer is ready, while a chained
    // `waitForURL` continuation can run after the asynchronous capture has already
    // replaced it with the reader. Capture directly from the launch document's
    // `domcontentloaded` event, which fires with the static launch surface rendered.
    let launchScreenshot: Promise<Uint8Array<ArrayBufferLike>> | undefined;
    page.on("domcontentloaded", () => {
      const navigationUrl = new URL(page.url());
      if (
        navigationUrl.protocol === "chrome-extension:" &&
        navigationUrl.pathname === "/pdf-launch.html" &&
        launchScreenshot === undefined
      ) {
        launchScreenshot = page.screenshot({
          path: artifacts.screenshotLaunchPath,
        });
      }
    });
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) {
        mainFrameNavigations.push(frame.url());
      }
    });

    if (scenario === "clicked-link") {
      // The realistic flow: a click on a PDF link records the click origin as capture
      // provenance (link-origin.ts), then DNR commits the extension launch page before
      // Chrome can commit its native PDF document.
      await page.goto(`${courseServer.url.origin}/course/`);
      await page.screenshot({ path: artifacts.screenshotBeforePath });
      await page.getByRole("link", { name: "Notes" }).click();
    } else {
      await page.goto(
        `${courseServer.url.origin}${pdfPathForScenario(scenario)}`,
      );
    }

    // Capture is automatic and always-on: opening the PDF stores it, then the reader
    // mounts keyed by the stored filename.
    const storedPath = await waitForStoredPdf(readingRoot);
    const key = storedKeyFromPath(storedPath);
    const readerFrame = await waitForReaderFrame(page, key);
    assert(launchScreenshot !== undefined);
    await launchScreenshot;
    await readerFrame.locator("#viewer canvas").first().waitFor();
    await page.screenshot({ path: artifacts.screenshotAfterPath });

    appendEvent(artifacts.eventsLogPath, {
      type: "stored-pdf",
      scenario,
      storedPath,
    });
    const metadata = pdfDocinfo(storedPath);
    const backendCaptureRequestCount = countBackendCaptureRequests(
      artifacts.backendLogPath,
    );

    return {
      artifacts,
      backendCaptureRequestCount,
      cleanup: () => rmSync(testRoot, { recursive: true, force: true }),
      courseOrigin: courseServer.url.origin,
      courseRequests: courseServer.requests,
      key,
      mainFrameNavigations,
      metadata,
      readerFrameUrl: readerFrame.url(),
      storedPath,
      visibleReaderUrl: page.url(),
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
  artifacts: CaptureArtifacts;
  backend: RunningBackend;
  backendPort: number;
  context: BrowserContext;
  courseServer: RunningCourseServer;
  extensionId: string;
  page: Page;
  readingRoot: string;
  x11Display: string | undefined;
};

type ExtensionReaderOptions = {
  nativeBrowserShortcuts?: boolean;
};

type RunningXServer = {
  display: string;
  process: Bun.Subprocess<"ignore", "ignore", "pipe">;
};

async function withExtensionReader(
  callback: (evidence: ExtensionReaderEvidence) => Promise<void>,
  options: ExtensionReaderOptions = {},
): Promise<void> {
  const backendPort = await unusedTcpPort();
  const testRoot = mkdtemp("mathread-extension-reader-");
  const readingRoot = join(testRoot, "reading-root");
  mkdirSync(readingRoot);
  const artifacts = createCaptureArtifacts(testRoot, "direct-pdf-tab");
  const extensionPath = configuredExtensionCopy(testRoot, backendPort);
  const backend = startMathReadBackend(
    backendPort,
    readingRoot,
    artifacts.backendLogPath,
  );
  const courseServer = startCourseServer(artifacts.eventsLogPath);
  let context: BrowserContext | undefined;
  let xServer: RunningXServer | undefined;
  let completed = false;

  try {
    await waitForHttpService(`http://127.0.0.1:${backendPort}/openapi.json`);
    if (options.nativeBrowserShortcuts === true) {
      xServer = await startXServer();
    }
    context = await chromium.launchPersistentContext(
      join(testRoot, "profile"),
      {
        executablePath: chromiumExecutablePath(),
        headless: options.nativeBrowserShortcuts !== true,
        artifactsDir: artifacts.root,
        ...(xServer === undefined ? {} : { env: { ...process.env, DISPLAY: xServer.display } }),
        args: [
          `--disable-extensions-except=${extensionPath}`,
          `--load-extension=${extensionPath}`,
          ...(xServer === undefined ? [] : ["--ozone-platform=x11"]),
        ],
      },
    );
    const serviceWorker = await waitForExtensionServiceWorker(context);
    await waitForPdfRedirectRule(serviceWorker);
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

    await callback({
      artifacts,
      backend,
      backendPort,
      context,
      courseServer,
      extensionId,
      page,
      readingRoot,
      x11Display: xServer?.display,
    });
    await page.close();
    completed = true;
  } finally {
    if (context !== undefined) {
      await context.close();
    }
    if (xServer !== undefined) {
      xServer.process.kill();
      await xServer.process.exited;
    }
    courseServer.stop(true);
    backend.process.kill();
    await backend.process.exited;
    closeSync(backend.logFd);
    if (completed) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  }
}

async function startXServer(): Promise<RunningXServer> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const displayNumber = (await unusedTcpPort()) - 6000;
    const display = `:${displayNumber}`;
    const process = Bun.spawn(
      ["Xvfb", display, "-screen", "0", "1280x1024x24", "-nolisten", "tcp"],
      { stdout: "ignore", stderr: "pipe" },
    );
    const socketPath = `/tmp/.X11-unix/X${displayNumber}`;
    for (let wait = 0; wait < 100; wait += 1) {
      if (existsSync(socketPath)) {
        return { display, process };
      }
      const exited = await Promise.race([
        process.exited.then((exitCode) => ({ exitCode })),
        Bun.sleep(50).then(() => undefined),
      ]);
      if (exited !== undefined) {
        const stderr = await new Response(process.stderr).text();
        throw new Error(`Xvfb failed to start on ${display}: ${stderr}`);
      }
    }
    process.kill();
    await process.exited;
  }
  throw new Error("Xvfb did not create a display socket");
}

function sendNativeHistoryShortcut(display: string, direction: "Left" | "Right"): void {
  const result = Bun.spawnSync(
    ["xdotool", "key", "--clearmodifiers", `Alt+${direction}`],
    { env: { ...process.env, DISPLAY: display } },
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `xdotool failed to send Alt+${direction}: ${new TextDecoder().decode(result.stderr)}`,
    );
  }
}

/** Capture a scenario PDF straight through the backend; returns its library key. */
async function preCapturePdfThroughBackend(
  backendPort: number,
  courseServer: RunningCourseServer,
  scenario: CaptureScenario,
): Promise<string> {
  if (scenario === "arxiv-pdf") {
    const form = new FormData();
    form.set("pdf_url", "https://arxiv.org/pdf/2301.12345");
    form.set("source_url", "https://arxiv.org/abs/2301.12345");
    form.set("title_hint", "arXiv:2301.12345");
    form.set("pdf", new Blob([pdfBytes], { type: "application/pdf" }), "2301.12345.pdf");
    const response = await fetch(`http://127.0.0.1:${backendPort}/capture-bytes`, {
      method: "POST",
      body: form,
    });
    expect(response.ok).toBe(true);
    const value: unknown = await response.json();
    assert(isRecord(value) && typeof value.stored_path === "string");
    const key = storedKeyFromPath(value.stored_path);
    await waitForBackendLibraryKey(backendPort, key);
    return key;
  }
  const pdfUrl = `${courseServer.url.origin}${pdfPathForScenario(scenario)}`;
  const pdfResponse = await fetch(pdfUrl, {
    headers: { cookie: `${cookieName}=${cookieValue}` },
  });
  expect(pdfResponse.ok).toBe(true);
  const responsePdfBytes = await pdfResponse.arrayBuffer();
  const form = new FormData();
  const pdfFilename = pdfPathForScenario(scenario).split("/").pop();
  assert(pdfFilename !== undefined && pdfFilename !== "");
  form.append(
    "pdf",
    new Blob([responsePdfBytes], { type: "application/pdf" }),
    pdfFilename,
  );
  form.append("pdf_url", pdfUrl);
  form.append("source_url", pdfUrl);
  const response = await fetch(
    `http://127.0.0.1:${backendPort}/capture-bytes`,
    {
      method: "POST",
      body: form,
    },
  );
  expect(response.ok).toBe(true);
  const value: unknown = await response.json();
  assert(isRecord(value) && typeof value.stored_path === "string");
  const key = storedKeyFromPath(value.stored_path);
  await waitForBackendLibraryKey(backendPort, key);
  return key;
}

async function preCaptureExternalPdfThroughBackend(
  backendPort: number,
  pdfUrl: string,
  responsePdfBytes: Uint8Array,
): Promise<string> {
  const pdfFilename = new URL(pdfUrl).pathname.split("/").pop();
  assert(pdfFilename !== undefined && pdfFilename !== "");

  const form = new FormData();
  form.append(
    "pdf",
    new Blob([new Uint8Array(responsePdfBytes)], { type: "application/pdf" }),
    pdfFilename,
  );
  form.append("pdf_url", pdfUrl);
  form.append("source_url", pdfUrl);
  const response = await fetch(
    `http://127.0.0.1:${backendPort}/capture-bytes`,
    {
      method: "POST",
      body: form,
    },
  );
  expect(response.ok).toBe(true);
  const value: unknown = await response.json();
  assert(isRecord(value) && typeof value.stored_path === "string");
  const key = storedKeyFromPath(value.stored_path);
  await waitForBackendLibraryKey(backendPort, key);
  return key;
}

async function numdamFixtureBytes(): Promise<Uint8Array> {
  if (!existsSync(numdamFixturePath)) {
    mkdirSync(numdamFixtureDirectory, { recursive: true });
    const bytes = await downloadNumdamFixture();
    assertNumdamFixture(bytes);
    writeFileSync(numdamFixturePath, bytes);
  }

  const bytes = new Uint8Array(readFileSync(numdamFixturePath));
  assertNumdamFixture(bytes);
  return bytes;
}

async function downloadNumdamFixture(): Promise<Uint8Array> {
  const chunks = await Promise.all(
    Array.from({ length: numdamFixtureChunkCount }, (_, index) =>
      downloadNumdamFixtureRange(index),
    ),
  );
  const bytes = new Uint8Array(numdamFixtureByteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

async function downloadNumdamFixtureRange(index: number): Promise<Uint8Array> {
  const start = Math.floor(
    (index * numdamFixtureByteLength) / numdamFixtureChunkCount,
  );
  const end = Math.floor(
    ((index + 1) * numdamFixtureByteLength) / numdamFixtureChunkCount,
  ) - 1;

  for (let attempt = 0; attempt < numdamFixtureFetchAttempts; attempt += 1) {
    try {
      const response = await fetch(numdamRegressionPdfUrl, {
        headers: {
          range: `bytes=${start}-${end}`,
          "user-agent": "mathread-tests (+https://github.com/dzackgarza)",
        },
      });
      assert(response.status === 206);
      const bytes = new Uint8Array(await response.arrayBuffer());
      assert(bytes.length === end - start + 1);
      return bytes;
    } catch (error) {
      if (attempt === numdamFixtureFetchAttempts - 1) {
        throw error;
      }
    }
  }

  assert.fail("Unreachable Numdam fixture retry state");
}

function assertNumdamFixture(bytes: Uint8Array): void {
  assert(bytes.length === numdamFixtureByteLength);
  assert(new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-");
  assert(
    createHash("sha256").update(bytes).digest("hex") === numdamFixtureSha256,
  );
}

async function waitForExtensionServiceWorker(context: BrowserContext) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const serviceWorker = context
      .serviceWorkers()
      .find((worker) => worker.url().startsWith("chrome-extension://"));
    if (serviceWorker !== undefined) {
      return serviceWorker;
    }
    await Bun.sleep(100);
  }
  throw new Error("Timed out waiting for MathRead extension service worker");
}

async function waitForPdfRedirectRule(serviceWorker: Worker): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await hasPdfRedirectRule(serviceWorker)) {
      return;
    }
    await Bun.sleep(100);
  }
  throw new Error("Timed out waiting for the MathRead PDF redirect rule");
}

async function waitForNoPdfRedirectRule(serviceWorker: Worker): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!(await hasPdfRedirectRule(serviceWorker))) {
      return;
    }
    await Bun.sleep(100);
  }
  throw new Error("Timed out waiting for the MathRead PDF redirect rule removal");
}

async function hasPdfRedirectRule(serviceWorker: Worker): Promise<boolean> {
  return serviceWorker.evaluate(async () => {
    const chromeApi = (
      globalThis as typeof globalThis & {
        chrome: {
          declarativeNetRequest: {
            getDynamicRules(): Promise<Array<{ id: number }>>;
          };
        };
      }
    ).chrome;
    const rules = await chromeApi.declarativeNetRequest.getDynamicRules();
    return rules.some((rule) => rule.id === 1);
  });
}

async function pdfRedirectRuleIds(serviceWorker: Worker): Promise<number[]> {
  return serviceWorker.evaluate(async () => {
    const chromeApi = (
      globalThis as typeof globalThis & {
        chrome: {
          declarativeNetRequest: {
            getDynamicRules(): Promise<Array<{ id: number }>>;
          };
        };
      }
    ).chrome;
    const rules = await chromeApi.declarativeNetRequest.getDynamicRules();
    return rules.map(rule => rule.id).sort((left, right) => left - right);
  });
}

function storedKeyFromPath(storedPath: string): string {
  const segments = storedPath.split("/");
  const key = segments[segments.length - 1];
  assert(key !== undefined && key.length > 0);
  return key;
}

async function waitForReaderFrame(
  page: Page,
  expectedKey: string,
): Promise<Frame> {
  const isExpectedTopLevelReader = () => {
    const url = new URL(page.url());
    return isReaderDocumentUrl(url, expectedKey);
  };
  if (!isExpectedTopLevelReader()) {
    await page.waitForURL(url => isReaderDocumentUrl(url, expectedKey));
  }
  return page.mainFrame();
}

type ReaderSurface = Page | Frame;

async function waitForCanvasCount(
  surface: ReaderSurface,
  expectedCount: number,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const readerErrors = surface.locator("#reader-error");
    if ((await readerErrors.count()) > 0) {
      const text = await readerErrors.first().textContent();
      throw new Error(
        `Reader failed before rendering ${expectedCount} canvas(es): ${text}`,
      );
    }
    if ((await surface.locator("#viewer canvas").count()) === expectedCount) {
      return;
    }
    await Bun.sleep(100);
  }
  const lastCount = await surface.locator("#viewer canvas").count();
  throw new Error(
    `Timed out waiting for ${expectedCount} PDF canvas(es); last count: ${lastCount}`,
  );
}

async function waitForBackendLibraryKey(
  backendPort: number,
  key: string,
): Promise<void> {
  let lastKeys: string[] = [];
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetch(`http://127.0.0.1:${backendPort}/library`);
    expect(response.ok).toBe(true);
    const value: unknown = await response.json();
    assert(Array.isArray(value));
    lastKeys = value
      .filter(isRecord)
      .map((entry) => entry.key)
      .filter((entryKey): entryKey is string => typeof entryKey === "string");
    if (lastKeys.includes(key)) {
      return;
    }
    await Bun.sleep(100);
  }
  throw new Error(
    `Timed out waiting for backend library key ${key}; last keys: ${lastKeys.join(", ")}`,
  );
}

function collectReadEventRequests(
  page: Page,
  backendPort: number,
): ReadEventRequest[] {
  const requests: ReadEventRequest[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.origin === `http://127.0.0.1:${backendPort}` &&
      url.pathname === "/read-event"
    ) {
      requests.push({
        method: request.method(),
        pathname: url.pathname,
        bodyText: request.postData(),
      });
    }
  });
  return requests;
}

async function waitForReadEventCount(
  requests: ReadEventRequest[],
  expectedCount: number,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (requests.length === expectedCount) {
      return;
    }
    await Bun.sleep(100);
  }
  throw new Error(
    `Timed out waiting for ${expectedCount} read-event request(s); observed ${requests.length}`,
  );
}

function assertReadEventBodies(
  requests: ReadEventRequest[],
  expectedKeys: string[],
): void {
  expect(requests.length).toBe(expectedKeys.length);
  for (const [index, expectedKey] of expectedKeys.entries()) {
    const request = requests[index];
    assert(request !== undefined);
    expect(request.method).toBe("POST");
    expect(request.pathname).toBe("/read-event");
    assert(request.bodyText !== null);
    const body: unknown = JSON.parse(request.bodyText);
    assert(isRecord(body));
    expect(Object.keys(body).sort()).toEqual(["key"]);
    expect(body.key).toBe(expectedKey);
  }
}

async function fetchBackendLibraryEntries(
  backendPort: number,
): Promise<BackendLibraryEntry[]> {
  const response = await fetch(`http://127.0.0.1:${backendPort}/library`);
  expect(response.ok).toBe(true);
  const value: unknown = await response.json();
  assert(Array.isArray(value));
  return value.map(parseBackendLibraryEntry);
}

function parseBackendLibraryEntry(value: unknown): BackendLibraryEntry {
  assert(isRecord(value));
  assert(typeof value.key === "string");
  assert(typeof value.first_read === "string");
  assert(typeof value.last_read === "string");
  return {
    key: value.key,
    first_read: value.first_read,
    last_read: value.last_read,
  };
}

async function waitForBackendLibraryEntry(
  backendPort: number,
  key: string,
  predicate: (entry: BackendLibraryEntry) => boolean,
): Promise<BackendLibraryEntry> {
  let lastEntry: BackendLibraryEntry | undefined;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const entries = await fetchBackendLibraryEntries(backendPort);
    lastEntry = entries.find((entry) => entry.key === key);
    if (lastEntry !== undefined && predicate(lastEntry)) {
      return lastEntry;
    }
    await Bun.sleep(100);
  }
  throw new Error(
    `Timed out waiting for backend library entry ${key}; last entry: ${JSON.stringify(lastEntry)}`,
  );
}

function readTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  expect(Number.isFinite(timestamp)).toBe(true);
  return timestamp;
}

async function waitForLibraryOrder(
  surface: ReaderSurface,
  expectedKeys: string[],
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const actualKeys = await surface
      .locator('[data-testid="library-entry"]')
      .evaluateAll((entries) =>
        entries.map((entry) => {
          if (!(entry instanceof HTMLElement)) {
            throw new Error("Library entry is not an HTMLElement");
          }
          const key = entry.dataset.mathreadKey;
          if (key === undefined) {
            throw new Error("Library entry omitted data-mathread-key");
          }
          return key;
        }),
      );
    const actualPrefix = actualKeys.slice(0, expectedKeys.length);
    if (expectedKeys.every((key, index) => actualPrefix[index] === key)) {
      return;
    }
    await Bun.sleep(100);
  }
  throw new Error(
    `Timed out waiting for library order ${expectedKeys.join(", ")}`,
  );
}

async function canvasPixelEvidence(
  surface: ReaderSurface,
  canvasIndex: number,
): Promise<{ canvasSize: number; nonWhitePixels: number }> {
  let lastEvidence = { canvasSize: 0, nonWhitePixels: 0 };
  for (let attempt = 0; attempt < 100; attempt += 1) {
    lastEvidence = await surface.evaluate((targetIndex) => {
      const channel = (value: number | undefined, fallback: number): number => {
        if (value === undefined) return fallback;
        return value;
      };
      const pixelAlpha = (
        pixels: Uint8ClampedArray,
        offset: number,
      ): number => {
        return channel(pixels[offset + 3], 0);
      };
      const pixelMinimumColor = (
        pixels: Uint8ClampedArray,
        offset: number,
      ): number => {
        return Math.min(
          channel(pixels[offset], 255),
          channel(pixels[offset + 1], 255),
          channel(pixels[offset + 2], 255),
        );
      };
      const isNonWhitePixel = (
        pixels: Uint8ClampedArray,
        offset: number,
      ): boolean => {
        return (
          pixelAlpha(pixels, offset) > 0 &&
          pixelMinimumColor(pixels, offset) < 245
        );
      };
      const canvases =
        document.querySelectorAll<HTMLCanvasElement>("#viewer canvas");
      const canvas = canvases[targetIndex];
      if (canvas === undefined) {
        return { canvasSize: 0, nonWhitePixels: 0 };
      }
      const context = canvas.getContext("2d");
      if (context === null || canvas.width === 0 || canvas.height === 0) {
        return { canvasSize: canvas.width * canvas.height, nonWhitePixels: 0 };
      }
      const pixels = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      ).data;
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

async function waitForLibraryEntryCount(
  surface: ReaderSurface,
  expectedCount: number,
): Promise<void> {
  const entries = surface.locator('[data-testid="library-entry"]');
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((await entries.count()) === expectedCount) {
      return;
    }
    await Bun.sleep(100);
  }
  throw new Error(
    `Timed out waiting for ${expectedCount} library entry(ies); last count: ${await entries.count()}`,
  );
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
  throw new Error(
    `Timed out waiting for element text; last text: ${lastText}; last error: ${String(lastError)}`,
  );
}

async function waitForClipboardText(
  page: Page,
  expected: string,
): Promise<void> {
  await page.waitForFunction(
    (expectedText) => navigator.clipboard.readText().then((text) => text === expectedText),
    expected,
  );
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
  throw new Error(
    `Timed out waiting for input value; last value: ${lastValue}; last error: ${String(lastError)}`,
  );
}

async function currentViewerZoomPercent(surface: ReaderSurface): Promise<number> {
  const text = await surface.locator("#customScaleOption").innerText();
  const percent = Number(text.replace(/[^0-9.]/g, ""));
  assert(Number.isFinite(percent) && percent > 0, `PDF.js did not expose a numeric custom zoom: ${text}`);
  return percent;
}

async function waitForNoteSaved(
  backendPort: number,
  key: string,
  predicate: (text: string) => boolean,
): Promise<string> {
  let lastText = "<missing>";
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetch(
      `http://127.0.0.1:${backendPort}/notes/${encodeURIComponent(key)}`,
    );
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
  throw new Error(
    `Timed out waiting for saved note text; last text: ${lastText}`,
  );
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
  await page.goto(`chrome-extension://${extensionId}/reader/reader.css`, {
    waitUntil: "domcontentloaded",
  });
  await page.evaluate(
    ({ key, highlights }) => {
      localStorage.setItem(
        `mathread-legacy-highlights:${key}`,
        JSON.stringify(highlights),
      );
    },
    { key, highlights },
  );
  const serviceWorker = page
    .context()
    .serviceWorkers()
    .find((worker) => worker.url().startsWith("chrome-extension://"));
  assert(serviceWorker !== undefined);
  await serviceWorker.evaluate(async (autosaveMs) => {
    const chromeApi = (
      globalThis as typeof globalThis & {
        chrome: {
          storage: {
            local: {
              set(items: Record<string, unknown>): Promise<void>;
            };
          };
        };
      }
    ).chrome;
    await chromeApi.storage.local.set({
      "mathread.settings": {
        autosaveMs,
        fitWidthOnOpen: false,
        lineNumbers: true,
      },
    });
  }, autosaveMs);
}

async function legacyHighlightsRaw(
  page: Page,
  key: string,
): Promise<string | null> {
  return page.evaluate(
    (key) => localStorage.getItem(`mathread-legacy-highlights:${key}`),
    key,
  );
}

async function persistFitWidthOnOpen(context: BrowserContext): Promise<void> {
  const serviceWorker = context
    .serviceWorkers()
    .find((worker) => worker.url().startsWith("chrome-extension://"));
  assert(serviceWorker !== undefined);
  await serviceWorker.evaluate(async () => {
    const chromeApi = (
      globalThis as typeof globalThis & {
        chrome: {
          storage: {
            local: {
              set(items: Record<string, unknown>): Promise<void>;
            };
          };
        };
      }
    ).chrome;
    await chromeApi.storage.local.set({
      "mathread.settings": {
        autosaveMs: 800,
        fitWidthOnOpen: true,
        lineNumbers: true,
      },
    });
  });
}

type FitWidthGeometry = {
  clientWidth: number;
  pageWidth: number;
  scrollWidth: number;
};

async function waitForFitWidthConvergence(
  page: Page,
  transition: string,
): Promise<FitWidthGeometry> {
  await page.evaluate(() => {
    delete document.documentElement.dataset.fitWidthProof;
  });

  try {
    const proof = await page.waitForFunction(
      (transitionLabel) => {
        const viewer = document.getElementById("viewerContainer");
        const firstPage = document.querySelector("#viewer .page");
        if (!(viewer instanceof HTMLElement)) {
          throw new TypeError("Expected the PDF viewer container");
        }
        if (!(firstPage instanceof HTMLElement)) {
          throw new TypeError("Expected a rendered PDF page");
        }

        const geometry = {
          clientWidth: viewer.clientWidth,
          pageWidth: firstPage.getBoundingClientRect().width,
          scrollWidth: viewer.scrollWidth,
        };
        const previous = JSON.parse(
          document.documentElement.dataset.fitWidthProof ??
            JSON.stringify({ signature: "", stableFrames: 0 }),
        ) as { signature: string; stableFrames: number };
        const signature = JSON.stringify(geometry);
        const stableFrames =
          geometry.scrollWidth <= geometry.clientWidth + 1 &&
          signature === previous.signature
            ? previous.stableFrames + 1
            : 0;
        const current = {
          geometry,
          signature,
          stableFrames,
          transition: transitionLabel,
        };
        document.documentElement.dataset.fitWidthProof = JSON.stringify(current);
        return stableFrames >= 3 ? current : false;
      },
      transition,
      { polling: "raf", timeout: 10_000 },
    );
    const result = (await proof.jsonValue()) as { geometry: FitWidthGeometry };
    await proof.dispose();
    return result.geometry;
  } catch (error) {
    const lastProof = await page
      .locator("html")
      .getAttribute("data-fit-width-proof");
    throw new Error(
      `Fit-width did not converge during ${transition}: ${String(lastProof)}`,
      { cause: error },
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function attachPageDiagnostics(
  page: Page,
  artifacts: CaptureArtifacts,
  scenario: CaptureScenario,
): void {
  page.on("console", (message) => {
    appendEvent(artifacts.eventsLogPath, {
      type: "browser-console",
      scenario,
      text: message.text(),
    });
  });
  page.on("pageerror", (error) => {
    appendEvent(artifacts.eventsLogPath, {
      type: "browser-pageerror",
      scenario,
      text: String(error),
    });
  });
  page.on("framenavigated", (frame) => {
    appendEvent(artifacts.eventsLogPath, {
      type: "frame-navigated",
      scenario,
      text: `${frame === page.mainFrame() ? "main" : "sub"} ${frame.name()} ${frame.url()}`,
    });
  });
}

function configuredExtensionCopy(
  testRoot: string,
  backendPort: number,
): string {
  const extensionPath = join(testRoot, "extension");
  cpSync(join(process.cwd(), "dist", "extension"), extensionPath, {
    recursive: true,
  });

  const manifestPath = join(extensionPath, "manifest.json");
  const manifest = parseExtensionManifest(readFileSync(manifestPath, "utf8"));
  manifest.host_permissions = [
    `http://127.0.0.1:${backendPort}/*`,
    ...manifest.host_permissions.filter(
      (permission) => !permission.startsWith("http://127.0.0.1:"),
    ),
  ];
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return extensionPath;
}

function parseExtensionManifest(source: string): ExtensionManifest {
  const value: unknown = JSON.parse(source);
  assertExtensionManifest(value);
  return value;
}

function assertExtensionManifest(
  value: unknown,
): asserts value is ExtensionManifest {
  assert(typeof value === "object" && value !== null);
  const hostPermissions = (value as { host_permissions?: unknown })
    .host_permissions;
  assert(Array.isArray(hostPermissions));
  assert(hostPermissions.every((permission) => typeof permission === "string"));
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

function startCourseServer(
  eventsLogPath: string,
  pdfResponseDelayMs = 0,
): RunningCourseServer {
  const requests: CourseRequest[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
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
      if (
        url.pathname === "/notes.pdf" ||
        url.pathname === "/internal-link.pdf" ||
        url.pathname === "/pdf/2301.12345" ||
        url.pathname === "/item/AST_1992__211__1_0.pdf" ||
        url.pathname === "/arxiv/pdf/2301.12345"
      ) {
        if (
          courseRequest.cookie?.includes(`${cookieName}=${cookieValue}`) !==
          true
        ) {
          return new Response("missing browser session cookie", {
            status: 403,
          });
        }
        if (pdfResponseDelayMs > 0) {
          await Bun.sleep(pdfResponseDelayMs);
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
    screenshotLaunchPath: join(screenshotDir, "launch.png"),
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
  assertPng(artifacts.screenshotLaunchPath);
  assertPng(artifacts.screenshotAfterPath);

  const events = readPersistedEvents(artifacts.eventsLogPath);
  expect(
    events.some(
      (event) =>
        event.type === "stored-pdf" &&
        event.scenario === scenario &&
        event.storedPath === storedPath,
    ),
  ).toBe(true);
  expect(
    events.some(
      (event) =>
        event.type === "course-request" &&
        event.path === pdfPathForScenario(scenario) &&
        event.cookie?.includes(`${cookieName}=${cookieValue}`) === true,
    ),
  ).toBe(true);
}

function countBackendCaptureRequests(backendLogPath: string): number {
  return readFileSync(backendLogPath, "utf8")
    .split("\n")
    .filter((line) => line.includes('"POST /capture-bytes HTTP/1.1" 200 OK'))
    .length;
}

function assertPng(path: string): void {
  const bytes = readFileSync(path);
  expect(Array.from(bytes.subarray(0, 8))).toEqual([
    137, 80, 78, 71, 13, 10, 26, 10,
  ]);
  expect(statSync(path).size).toBeGreaterThan(100);
}

function readPersistedEvents(logPath: string): PersistedEvent[] {
  return readFileSync(logPath, "utf8")
    .trim()
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
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
  if (scenario === "arxiv-pdf") {
    return "/arxiv/pdf/2301.12345";
  }
  if (scenario === "direct-pdf-without-extension") {
    return "/pdf/2301.12345";
  }
  return "/notes.pdf";
}

function pdfBytesForPath(path: string): Uint8Array<ArrayBuffer> {
  if (path === "/internal-link.pdf") {
    return extractLinkPdfBytes;
  }
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
    `<< /Type /Pages /Kids [${pageObjectNumbers.map((objectNumber) => `${objectNumber} 0 R`).join(" ")}] /Count ${pageCount} >>`,
  );

  let source = "%PDF-1.4\n";
  const offsets = [0];
  for (const objectNumber of [...objects.keys()].sort(
    (left, right) => left - right,
  )) {
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
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const pdfs = readdirSync(readingRoot)
      .filter((filename) => filename.endsWith(".pdf"))
      .map((filename) => join(readingRoot, filename));
    if (pdfs.length > 0) {
      assert.equal(pdfs.length, 1);
      const storedPath = pdfs[0];
      assert(storedPath !== undefined);
      return storedPath;
    }
    await Bun.sleep(100);
  }
  throw new Error(`MathRead backend did not store a PDF under ${readingRoot}`);
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

function assertRecordOfStrings(
  value: unknown,
): asserts value is Record<string, string> {
  assert(typeof value === "object" && value !== null);
  assert(
    Object.values(value).every((item) => typeof item === "string"),
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
