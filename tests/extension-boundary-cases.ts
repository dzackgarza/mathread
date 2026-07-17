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
  title: string;
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
    async ({ backendPort, courseServer, page, readingRoot }) => {
      const firstKey = await preCapturePdfThroughBackend(
        backendPort,
        courseServer,
        "direct-pdf-tab",
      );
      await preCapturePdfThroughBackend(
        backendPort,
        courseServer,
        "large-numdam-pdf",
      );
      writeFileSync(
        join(readingRoot, firstKey.replace(/\.pdf$/, ".md")),
        "existing note\n",
      );

      await page.goto(`${courseServer.url.origin}/notes.pdf`);
      let reader = await waitForTakeoverReader(page);
      await reader.locator("#viewer canvas").first().waitFor();
      await reader.locator('.nav-expand-btn[data-tab="library"]').click();
      await waitForLibraryEntryCount(reader, 2);

      // A library entry is a glorified history link: opening it navigates the
      // tab to the entry's source URL and the takeover mounts the reader there.
      const numdamSourceUrl = `${courseServer.url.origin}${pdfPathForScenario("large-numdam-pdf")}`;
      await reader
        .locator('[data-testid="library-entry"]', { hasText: "AST_1992" })
        .locator('[data-testid="library-entry-open"]')
        .click();
      await page.waitForURL((url) => url.href.startsWith(numdamSourceUrl));
      reader = await waitForTakeoverReader(page);
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

test("reader Library panel lists provenance-less local PDFs without an open link", async () => {
  await withExtensionReader(async ({ extensionId, page, readingRoot }) => {
    writeFileSync(join(readingRoot, "local.pdf"), pdfBytes);

    await page.goto(`chrome-extension://${extensionId}/reader/library.html`, {
      waitUntil: "domcontentloaded",
    });
    await waitForLibraryEntryCount(page, 1);
    // A manual disk file was never visited, so it has no URL to navigate to.
    // The library shows it as a backup (read it from the library folder), and
    // deliberately offers no in-app open — edge cases are designed out (#40).
    const entry = page.locator('[data-testid="library-entry"]', { hasText: "local" });
    await entry.waitFor();
    expect(await entry.locator('[data-testid="library-entry-open"]').count()).toBe(0);
    expect(await entry.locator('[data-testid="library-entry-trash"]').count()).toBe(1);
  });
}, 60_000);

}

function registerPdfInterceptionBoundaryTests(): void {

test("built extension intercepts a clicked PDF directly into an extension-owned reader", async () => {
  const evidence = await runExtensionCapture("clicked-link");
  const expectedCourseUrl = new URL("/course/", evidence.courseOrigin).href;
  const expectedPdfUrl = new URL("/notes.pdf", expectedCourseUrl).href;

  // URL identity (#40): the PDF's own URL commits and never leaves the
  // address bar; no chrome-extension:// URL is ever a main-frame navigation.
  expect(
    evidence.mainFrameNavigations.some((url) => url.startsWith(expectedPdfUrl)),
  ).toBe(true);
  expect(
    evidence.mainFrameNavigations.every(
      (url) => !url.startsWith("chrome-extension://"),
    ),
  ).toBe(true);
  expect(evidence.visibleReaderUrl.startsWith(expectedPdfUrl)).toBe(true);
  expect(new URL(evidence.readerFrameUrl).pathname).toBe("/reader/reader.html");

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
  expect(new URL(evidence.readerFrameUrl).pathname).toBe("/reader/reader.html");
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
  expect(new URL(evidence.readerFrameUrl).pathname).toBe("/reader/reader.html");
  assertEvidenceArtifacts(
    evidence.artifacts,
    evidence.storedPath,
    "direct-pdf-without-extension",
  );
  evidence.cleanup();
}, 30_000);

test("worker startup clears legacy PDF redirect rules", async () => {
  await withExtensionReader(async ({ context, extensionId, page }) => {
    const serviceWorker = await waitForExtensionServiceWorker(context);
    await waitForNoPdfRedirectRule(serviceWorker);
    // A legacy install left a persisted redirect rule behind; the current
    // worker owns no rules and removes every persisted one at startup.
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
    });
    // Restart the worker. The seeded legacy rule intercepts PDF navigations
    // while the worker is down (that is the live failure being modeled), so
    // wake it from an extension page instead; startup cleanup then runs.
    await stopExtensionServiceWorkers(context, page);
    await page.goto(`chrome-extension://${extensionId}/reader/library.html`, {
      waitUntil: "domcontentloaded",
    });
    await page.evaluate(async () => {
      const runtime = (
        globalThis as typeof globalThis & {
          chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };
        }
      ).chrome.runtime;
      // Any delivery starts a stopped worker; the unanswered message port
      // closing afterwards is expected for a non-capture message.
      await runtime.sendMessage({ type: "mathread:wake" }).catch(() => undefined);
    });
    const restartedWorker = await waitForExtensionServiceWorker(context);
    await waitForNoPdfRedirectRule(restartedWorker);
    expect(await pdfRedirectRuleIds(restartedWorker)).toEqual([]);
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

      const sourceUrl = `${courseServer.url.origin}${pdfPathForScenario("large-numdam-pdf")}`;
      await page.goto(sourceUrl, { waitUntil: "domcontentloaded" });
      const reader = await waitForTakeoverReader(page);
      await reader.locator("#viewer canvas").first().waitFor();
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

      expect(page.url().startsWith(sourceUrl)).toBe(true);
      expect(page.url()).not.toContain(extensionId);
      expect(page.url()).not.toContain("markdown-editor.localhost");
      const readerScreenshotPath = join(
        artifacts.root,
        "issue10-extension-reader.png",
      );
      await page.screenshot({ path: readerScreenshotPath });
      assertPng(readerScreenshotPath);

      const pageInput = reader.locator("#pageNumber");
      await pageInput.fill("3");
      await pageInput.press("Enter");
      await expectInputValue(pageInput, (value) => value === "3");
      expect(readEvents.length).toBe(1);

      await reader
        .locator('.nav-expand-btn[data-tab="notes"]')
        .click({ force: true });
      await expectElementText(
        reader.locator("#notes-path"),
        (text) => text === key.replace(/\.pdf$/, ".md"),
      );
      const editor = reader.locator("#ai-editor .cm-content");
      await editor.click();
      await page.keyboard.type("# issue10-probe\n");
      await waitForNoteSaved(
        backendPort,
        key,
        (text) => text.includes("issue10-probe"),
      );
      await expectElementText(
        reader.locator("#notes-status"),
        (text) => text === "Saved",
      );
      const markdownScreenshotPath = join(
        artifacts.root,
        "issue10-extension-markdown.png",
      );
      await page.screenshot({ path: markdownScreenshotPath });
      assertPng(markdownScreenshotPath);

      await reader
        .locator('.nav-expand-btn[data-tab="library"]')
        .click({ force: true });
      await waitForLibraryEntryCount(reader, 3);
      const expectedLibraryTitles = [key, olderCapturedKey, manualKey].map(
        (expectedKey) => {
          const entry = backendEntries.find((candidate) => candidate.key === expectedKey);
          assert(entry !== undefined);
          return entry.title;
        },
      );
      await waitForLibraryTitles(reader, expectedLibraryTitles);
      const libraryScreenshotPath = join(
        artifacts.root,
        "issue10-extension-library-recently-read.png",
      );
      await page.screenshot({ path: libraryScreenshotPath });
      assertPng(libraryScreenshotPath);
      expect(readEvents.length).toBe(1);
      appendEvent(artifacts.eventsLogPath, {
        type: "issue10-extension-owned-proof",
        scenario: "large-numdam-pdf",
        readerScreenshotPath,
        markdownScreenshotPath,
        libraryScreenshotPath,
        currentViewUrl: page.url(),
      });
    },
  );
}, 120_000);
}

function registerCapturedRenderingBoundaryTests(): void {
test("built extension opens a captured PDF in the official reader", async () => {
  const evidence = await runExtensionCapture("large-numdam-pdf");
  expect(new URL(evidence.readerFrameUrl).pathname).toBe("/reader/reader.html");
  evidence.cleanup();
}, 60_000);

test("built extension fails loudly when the capture backend is down", async () => {
  await runBackendUnavailable();
}, 60_000);
}

export function registerNumdamRenderingBoundaryTest(): void {
test("installed reader copies source-preserving current and plain links for the canonical Numdam PDF", async () => {
  await withExtensionReader(
    async ({ artifacts, backendPort, context, page }) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(String(error)));
      const numdamBytes = await numdamFixtureBytes();
      const numdamSourceUrl = `${numdamRegressionPdfUrl}?title=source%20owned~query`;
      await preCaptureExternalPdfThroughBackend(
        backendPort,
        numdamSourceUrl,
        numdamBytes,
      );
      // Every request for the canonical Numdam URL — the navigation, the
      // takeover's parent byte fetch, and the worker's capture fetch — is
      // served from the hash-verified fixture; the worker's are counted.
      let captureFetches = 0;
      await context.route(
        (url) => url.toString().startsWith(numdamRegressionPdfUrl),
        async (route, request) => {
          if (request.serviceWorker() !== null) {
            captureFetches += 1;
          }
          await route.fulfill({
            contentType: "application/pdf",
            path: numdamFixturePath,
          });
        },
      );
      await page.goto(numdamSourceUrl, { waitUntil: "domcontentloaded" });
      const reader = await waitForTakeoverReader(page);
      await reader.locator("#viewer canvas").first().waitFor();
      const pageInput = reader.locator("#pageNumber");
      await pageInput.fill("6");
      await pageInput.press("Enter");
      await expectInputValue(pageInput, (value) => value === "6");
      await reader.locator("#zoomInButton").click();
      await reader.locator("#toggle-more").click();
      const desktopMenuPath = join(
        artifacts.root,
        "numdam-copy-actions-desktop.png",
      );
      await page.screenshot({ path: desktopMenuPath });
      assertPng(desktopMenuPath);

      // The current-view link is the source URL with its query intact plus a
      // standard PDF open-parameters fragment — readable by any viewer.
      await page.evaluate(() => navigator.clipboard.writeText(""));
      await reader.locator('.menu-item[data-action="copy-view-link"]').click();
      const copiedViewUrl = await readNonEmptyClipboard(page);
      const copiedView = new URL(copiedViewUrl);
      expect(copiedView.origin).toBe("https://www.numdam.org");
      expect(copiedView.pathname).toBe("/item/AST_1992__211__1_0.pdf");
      expect(copiedView.searchParams.get("title")).toBe("source owned~query");
      const viewParams = new URLSearchParams(copiedView.hash.slice(1));
      expect(viewParams.get("page")).toBe("6");
      const zoom = viewParams.get("zoom");
      assert(zoom !== null, "Current-view link omitted its zoom parameter");
      const [zoomLevel, viewportX, viewportY] = zoom.split(",");
      expect(Number(zoomLevel)).toBeGreaterThan(0);
      expect(Number.isFinite(Number(viewportX))).toBe(true);
      expect(Number.isFinite(Number(viewportY))).toBe(true);

      // The plain link is the source URL itself, fragment-free.
      await reader.locator("#toggle-more").click();
      await page.evaluate(() => navigator.clipboard.writeText(""));
      await reader.locator('.menu-item[data-action="copy-plain-link"]').click();
      await waitForClipboardText(page, numdamSourceUrl);
      expect(captureFetches).toBe(1);

      // A recipient opening the current-view link lands on the same view via
      // the standard fragment, restored through a fresh takeover.
      await page.setViewportSize({ width: 390, height: 844 });
      await reader.locator("#toggle-more").click();
      expect(await reader.locator("#more-menu").isVisible()).toBe(true);
      const narrowMenuPath = join(
        artifacts.root,
        "numdam-copy-actions-narrow.png",
      );
      await page.screenshot({ path: narrowMenuPath });
      assertPng(narrowMenuPath);
      await reader.locator("#toggle-more").click();
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto(copiedViewUrl, { waitUntil: "domcontentloaded" });
      const restoredReader = await waitForTakeoverReader(page);
      await expectInputValue(
        restoredReader.locator("#pageNumber"),
        (value) => value === "6",
      );
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
    async ({ backendPort, courseServer, page, readingRoot }) => {
      const key = await preCapturePdfThroughBackend(
        backendPort,
        courseServer,
        "direct-pdf-tab",
      );
      await page.goto(
        `${courseServer.url.origin}${pdfPathForScenario("direct-pdf-tab")}`,
        { waitUntil: "domcontentloaded" },
      );
      const reader = await waitForTakeoverReader(page);
      await waitForCanvasCount(reader, 1);

      await reader.locator('.nav-expand-btn[data-tab="notes"]').click();
      await expectElementText(
        reader.locator("#notes-path"),
        (text) => text === key.replace(/\.pdf$/, ".md"),
      );
      const editor = reader.locator("#ai-editor .cm-content");
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
        reader.locator("#notes-status"),
        (text) => text === "Saved",
      );

      // The live preview pane is always visible beside the editor and
      // renders GFM from the same buffer.
      await expectElementText(
        reader.locator("#notes-preview h1"),
        (text) => text === "Heading",
      );
      await expectElementText(
        reader.locator("#notes-preview strong"),
        (text) => text === "bold",
      );

      // Reload: the editor restores from the sidecar, not any browser-local store.
      await page.reload({ waitUntil: "domcontentloaded" });
      const reloadedReader = await waitForTakeoverReader(page);
      await reloadedReader.locator('.nav-expand-btn[data-tab="notes"]').click();
      await expectElementText(
        reloadedReader.locator("#ai-editor .cm-content"),
        (text) => text.includes("Heading") && text.includes("bold"),
      );
    },
  );
}, 60_000);

test("reader Key Points panel blocks stale autosave and resolves disk conflicts", async () => {
  await withExtensionReader(
    async ({ backendPort, courseServer, page, readingRoot }) => {
      const key = await preCapturePdfThroughBackend(
        backendPort,
        courseServer,
        "direct-pdf-tab",
      );
      const sidecarPath = join(readingRoot, key.replace(/\.pdf$/, ".md"));

      await page.goto(
        `${courseServer.url.origin}${pdfPathForScenario("direct-pdf-tab")}`,
        { waitUntil: "domcontentloaded" },
      );
      const reader = await waitForTakeoverReader(page);
      await waitForCanvasCount(reader, 1);
      await reader.locator('.nav-expand-btn[data-tab="notes"]').click();

      const editor = reader.locator("#ai-editor .cm-content");
      await editor.click();
      await page.keyboard.type("original buffer");
      await waitForNoteSaved(
        backendPort,
        key,
        (text) => text === "original buffer",
      );
      await expectElementText(
        reader.locator("#notes-status"),
        (text) => text === "Saved",
      );

      writeFileSync(sidecarPath, "disk edit from another tab\n");
      await editor.click();
      await page.keyboard.type("\nstale local edit");
      await expectElementText(
        reader.locator("#notes-status"),
        (text) => text === "Save failed: conflict",
      );
      await expectElementText(reader.locator("#notes-error"), (text) =>
        text.includes("Version mismatch"),
      );
      expect(readFileSync(sidecarPath, "utf8")).toBe(
        "disk edit from another tab\n",
      );

      await reader.getByRole("button", { name: "Load from Disk" }).click();
      await expectElementText(
        reader.locator("#notes-status"),
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
        reader.locator("#notes-status"),
        (text) => text === "Save failed: conflict",
      );
      expect(readFileSync(sidecarPath, "utf8")).toBe(
        "second disk edit from another tab\n",
      );

      await reader.getByRole("button", { name: "Overwrite Disk" }).click();
      await waitForNoteSaved(
        backendPort,
        key,
        (text) =>
          text.includes("overwrite local edit") &&
          !text.includes("second disk edit"),
      );
      await expectElementText(
        reader.locator("#notes-status"),
        (text) => text === "Saved",
      );
    },
  );
}, 60_000);

}

function registerNoteMigrationBoundaryTests(): void {

test("reader Key Points panel surfaces a loud error when the backend dies (no localStorage fallback)", async () => {
  await withExtensionReader(
    async ({ backend, backendPort, courseServer, page }) => {
      await preCapturePdfThroughBackend(
        backendPort,
        courseServer,
        "direct-pdf-tab",
      );
      await page.goto(
        `${courseServer.url.origin}${pdfPathForScenario("direct-pdf-tab")}`,
        { waitUntil: "domcontentloaded" },
      );
      const reader = await waitForTakeoverReader(page);
      await waitForCanvasCount(reader, 1);
      await reader.locator('.nav-expand-btn[data-tab="notes"]').click();
      const editor = reader.locator("#ai-editor .cm-content");
      await editor.waitFor();

      backend.process.kill();
      await backend.process.exited;

      // With a loaded note editor and no backend, autosave must surface a visible
      // failure instead of falling back to a browser-local store.
      await editor.click();
      await page.keyboard.type("orphaned edit");
      await expectElementText(reader.locator("#notes-status"), (text) =>
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

      await page.goto(
        `${courseServer.url.origin}${pdfPathForScenario("direct-pdf-tab")}`,
        { waitUntil: "domcontentloaded" },
      );
      const reader = await waitForTakeoverReader(page);
      await waitForCanvasCount(reader, 1);
      await reader.locator('.nav-expand-btn[data-tab="notes"]').click();

      await expectElementText(reader.locator("#ai-editor .cm-content"), (text) =>
        text.includes("legacy lattice quote"),
      );
      await expectElementText(
        reader.locator("#notes-status"),
        (text) => text === "Unsaved changes",
      );
      expect(await legacyHighlightsRaw(reader, key)).not.toBeNull();
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

      await page.goto(
        `${courseServer.url.origin}${pdfPathForScenario("direct-pdf-tab")}`,
        { waitUntil: "domcontentloaded" },
      );
      const reader = await waitForTakeoverReader(page);
      await waitForCanvasCount(reader, 1);
      await reader.locator('.nav-expand-btn[data-tab="notes"]').click();
      await expectElementText(
        reader.locator("#notes-status"),
        (text) => text === "Saved" || text === "Unsaved changes",
      );

      const editorText = await reader
        .locator("#ai-editor .cm-content")
        .innerText();
      expect(editorText).not.toContain("1970-01-01T00:00:00.000Z");
      expect(editorText).not.toContain(
        "legacy highlight missing required fields",
      );
      expect(await legacyHighlightsRaw(reader, key)).not.toBeNull();
    },
  );
}, 120_000);
}

export function registerReaderRenderingBoundaryTests(): void {
  registerReaderNavigationBoundaryTests();
  registerReaderRenderingSemanticsBoundaryTests();
}

function registerReaderNavigationBoundaryTests(): void {
test("reading a PDF keeps the source URL in the address bar", async () => {
  await withExtensionReader(
    async ({ artifacts, courseServer, page, readingRoot }) => {
      const sourceUrl = `${courseServer.url.origin}/notes.pdf`;
      await page.goto(sourceUrl);
      await waitForStoredPdf(readingRoot);

      // Issue #40 acceptance: the source URL is the document's identity. The
      // reader mounts as an iframe inside the wrapper document at that URL;
      // no chrome-extension:// URL is ever user-visible in the omnibox.
      const readerFrame = await waitForTakeoverReader(page);
      await readerFrame.locator("#viewer .page canvas").first().waitFor();
      expect(page.url()).toBe(sourceUrl);

      const screenshotPath = join(artifacts.root, "source-url-reader.png");
      await page.screenshot({ path: screenshotPath });
      assertPng(screenshotPath);
    },
  );
}, 120_000);


test("reader presents the MathRead library without constructing a custom PDF viewer", async () => {
  await withExtensionReader(async ({ artifacts, extensionId, page }) => {
    await page.goto(`chrome-extension://${extensionId}/reader/library.html`, {
      waitUntil: "domcontentloaded",
    });
    // The library page mounts with its panel already open.
    await page.locator('[data-testid="library-open-root"]').waitFor();
    expect(await page.locator("#viewer").count()).toBe(0);
    expect(await page.locator("#pageNumber").count()).toBe(0);
    const screenshotPath = join(artifacts.root, "reader-library.png");
    await page.screenshot({ path: screenshotPath });
    assertPng(screenshotPath);
  });
}, 120_000);

}

function registerReaderRenderingSemanticsBoundaryTests(): void {
  registerReaderHistoryBoundaryTest();
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
      const reader = await waitForTakeoverReader(page);
      await reader.locator("#viewer canvas").first().waitFor();
      await waitForReadEventCount(readEventRequests, 1);
      expect(page.url()).toBe(sourceUrl);
      expect(await reader.locator("#pageNumber").inputValue()).toBe("1");
      await page.screenshot({ path: join(artifacts.root, "browser-history-reader.png") });
      assertPng(join(artifacts.root, "browser-history-reader.png"));

      await page.bringToFront();
      await reader.locator("#viewer").click({ position: { x: 20, y: 20 } });
      const atCoursePage = page.waitForURL(`${courseServer.url.origin}/course/`);
      sendNativeHistoryShortcut(x11Display, "Left");
      await atCoursePage;
      await page.screenshot({ path: join(artifacts.root, "browser-history-parent.png") });
      assertPng(join(artifacts.root, "browser-history-parent.png"));
      const atReader = page.waitForURL(sourceUrl);
      sendNativeHistoryShortcut(x11Display, "Right");
      await atReader;
      const returnedReader = await waitForTakeoverReader(page);
      await returnedReader.locator("#viewer canvas").first().waitFor();
      await waitForReadEventCount(readEventRequests, 2);
      assertReadEventBodies(readEventRequests, [key, key]);
    },
    { nativeBrowserShortcuts: true },
  );
}, 120_000);

test("internal links defer history to the browser and traversal restores the view", async () => {
  await withExtensionReader(
    async ({ artifacts, courseServer, page, readingRoot, x11Display }) => {
      assert(x11Display !== undefined, "Native browser shortcut proof requires an X11 display");
      const sourceUrl = `${courseServer.url.origin}/internal-link.pdf`;
      await page.goto(`${courseServer.url.origin}/course/`, {
        waitUntil: "domcontentloaded",
      });
      await page.goto(sourceUrl, { waitUntil: "domcontentloaded" });
      await waitForStoredPdf(readingRoot);
      const reader = await waitForTakeoverReader(page);
      await reader.locator("#viewer canvas").first().waitFor();

      const internalLink = reader.locator("#viewer .annotationLayer a").first();
      await internalLink.click();
      await reader.waitForFunction(() => {
        const input = document.getElementById("pageNumber");
        return input instanceof HTMLInputElement && input.value === "2";
      });
      // The reader mirrors its view onto the source URL's hash as standard
      // open parameters — the one canonical view state, with no new history
      // entries (native-viewer parity: internal links do not grow history).
      await page.waitForFunction(
        () => new URLSearchParams(location.hash.slice(1)).get("page") === "2",
      );
      await page.screenshot({ path: join(artifacts.root, "takeover-history-page2.png") });
      assertPng(join(artifacts.root, "takeover-history-page2.png"));

      // Alt-Left leaves the document, exactly like Chrome's native viewer.
      // Focus with a raw viewport-coordinate click: a locator click on
      // #viewer would scroll its target point into view and drag the reader
      // back to page 1, which the hash mirror would faithfully record.
      await page.bringToFront();
      await page.mouse.click(40, 300);
      const atCoursePage = page.waitForURL(`${courseServer.url.origin}/course/`);
      sendNativeHistoryShortcut(x11Display, "Left");
      await atCoursePage;

      // Alt-Right re-enters through the mirrored fragment and restores the view.
      const atReader = page.waitForURL((url) => url.href.startsWith(sourceUrl));
      sendNativeHistoryShortcut(x11Display, "Right");
      await atReader;
      const returnedReader = await waitForTakeoverReader(page);
      await returnedReader.waitForFunction(() => {
        const input = document.getElementById("pageNumber");
        return input instanceof HTMLInputElement && input.value === "2";
      });
    },
    { nativeBrowserShortcuts: true },
  );
}, 120_000);

test("stale loaded extension reports an actionable reload instruction instead of hanging capture", async () => {
  await runStaleLoadedManifestCapture();
}, 120_000);

test("reader survives a browser reload at the source URL without the service worker", async () => {
  await withExtensionReader(
    async ({ artifacts, context, courseServer, page, readingRoot }) => {
      const sourceUrl = `${courseServer.url.origin}/notes.pdf`;
      await page.goto(sourceUrl);
      await waitForStoredPdf(readingRoot);
      const reader = await waitForTakeoverReader(page);
      await reader.locator("#viewer .page canvas").first().waitFor();

      // Real Chrome stops extension service workers after ~30s idle; a reload
      // must survive it. The takeover script re-runs on the fresh wrapper
      // document and its capture message wakes the worker.
      await stopExtensionServiceWorkers(context, page);

      await page.reload({ waitUntil: "domcontentloaded" });
      expect(page.url()).toBe(sourceUrl);
      const reloadedReader = await waitForTakeoverReader(page);
      await reloadedReader.locator("#viewer .page canvas").first().waitFor();
      const screenshotPath = join(artifacts.root, "reader-after-reload.png");
      await page.screenshot({ path: screenshotPath });
      assertPng(screenshotPath);
    },
  );
}, 120_000);

}

function registerInterceptedReaderShortcutsBoundaryTest(): void {

test("PDF.js owns reader controls while the MathRead Notes editor remains isolated", async () => {
  await withExtensionReader(
    async ({ courseServer, page, readingRoot }) => {
      await page.goto(`${courseServer.url.origin}/notes.pdf`);
      await waitForStoredPdf(readingRoot);
      const reader = await waitForTakeoverReader(page);
      await reader.locator("#viewer .page canvas").first().waitFor();

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
    await waitForNoPdfRedirectRule(serviceWorker);
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

    // No backend means the takeover surface fails loudly on the wrapper
    // document at the source URL, naming the native-viewer escape hatch.
    await expectElementText(page.locator("body"), (text) =>
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
    cleanupTestRoot(testRoot, completed);
  }
}

/**
 * Reconstructs the live defect behind issue #34's absorbed reload report: the
 * extension was loaded (and its persistent DNR redirect registered) before a
 * rebuild changed the manifest's permissions on disk. Chrome keeps running the
 * stale loaded manifest until the extension is reloaded, while background.js is
 * read fresh from disk and requires the new permissions at import time — so the
 * service worker dies on every start, capture has no receiver, and synthetic
 * viewer URLs stop resolving. The launch page must turn that state into an
 * actionable instruction instead of a hang or a cryptic messaging error.
 */
async function runStaleLoadedManifestCapture(): Promise<void> {
  const backendPort = await unusedTcpPort();
  const testRoot = mkdtemp("mathread-extension-stale-manifest-");
  const artifacts = createCaptureArtifacts(testRoot, "clicked-link");
  const extensionPath = configuredExtensionCopy(testRoot, backendPort);
  const manifestPath = join(extensionPath, "manifest.json");
  const currentManifestSource = readFileSync(manifestPath, "utf8");
  const courseServer = startCourseServer(artifacts.eventsLogPath);
  const launchOptions = {
    executablePath: chromiumExecutablePath(),
    headless: true,
    artifactsDir: artifacts.root,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  };
  let context: BrowserContext | undefined;
  let completed = false;

  try {
    // Phase 1: a healthy load registers the persistent DNR redirect rule,
    // exactly like the install that preceded the on-disk rebuild.
    context = await chromium.launchPersistentContext(
      join(testRoot, "profile"),
      launchOptions,
    );
    const serviceWorker = await waitForExtensionServiceWorker(context);
    await waitForNoPdfRedirectRule(serviceWorker);
    await context.close();
    context = undefined;

    // Phase 2: Chrome loads the pre-rebuild manifest, whose permissions no
    // longer satisfy the current background worker's import-time API use.
    const staleManifest = JSON.parse(currentManifestSource) as {
      permissions: string[];
    };
    staleManifest.permissions = ["storage"];
    writeFileSync(manifestPath, `${JSON.stringify(staleManifest, null, 2)}\n`);
    context = await chromium.launchPersistentContext(
      join(testRoot, "profile"),
      launchOptions,
    );
    // The disk manifest is current again the moment Chrome has loaded the stale
    // one, mirroring a rebuild that landed after the last extension reload.
    writeFileSync(manifestPath, currentManifestSource);

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

    await expectElementText(page.locator("body"), (text) =>
      text.includes("chrome://extensions"),
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
    cleanupTestRoot(testRoot, completed);
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
    await waitForNoPdfRedirectRule(serviceWorker);
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
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) {
        mainFrameNavigations.push(frame.url());
      }
    });

    if (scenario === "clicked-link") {
      // The realistic flow: a click on a PDF link records the click origin as
      // capture provenance (link-origin.ts), then the takeover content script
      // mounts the reader inside the wrapper document at the PDF's own URL.
      await page.goto(`${courseServer.url.origin}/course/`);
      await page.screenshot({ path: artifacts.screenshotBeforePath });
      await page.getByRole("link", { name: "Notes" }).click();
    } else {
      await page.goto(
        `${courseServer.url.origin}${pdfPathForScenario(scenario)}`,
      );
    }

    // Capture is automatic and always-on: opening the PDF stores it while the
    // reader mounts as a child iframe under the unchanged source URL.
    const storedPath = await waitForStoredPdf(readingRoot);
    const key = storedKeyFromPath(storedPath);
    const readerFrame = await waitForTakeoverReader(page);
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
    await waitForNoPdfRedirectRule(serviceWorker);
    const extensionId = new URL(serviceWorker.url()).host;
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
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
    cleanupTestRoot(testRoot, completed);
  }
}

/**
 * Stops every running service worker in the browser, including the extension's
 * MV3 background worker. Chrome does the same thing on its own after ~30 seconds
 * of idle; tests use this to prove navigation survives a stopped worker.
 */
async function stopExtensionServiceWorkers(context: BrowserContext, page: Page): Promise<void> {
  const browser = context.browser();
  assert(browser !== null, "Persistent context must expose its browser for CDP");
  const browserSession = await browser.newBrowserCDPSession();
  try {
    assert(
      await hasRunningServiceWorkerTarget(browserSession),
      "Extension service worker must be running before it can be stopped",
    );
    const session = await context.newCDPSession(page);
    try {
      await session.send("ServiceWorker.enable");
      await session.send("ServiceWorker.stopAllWorkers");
    } finally {
      await session.detach();
    }
    const stopDeadline = Date.now() + 5_000;
    while (await hasRunningServiceWorkerTarget(browserSession)) {
      assert(Date.now() < stopDeadline, "Extension service worker did not stop");
      await Bun.sleep(50);
    }
  } finally {
    await browserSession.detach();
  }
}

async function hasRunningServiceWorkerTarget(
  session: Awaited<ReturnType<BrowserContext["newCDPSession"]>>,
): Promise<boolean> {
  const { targetInfos } = (await session.send("Target.getTargets")) as {
    targetInfos: Array<{ type: string }>;
  };
  return targetInfos.some((target) => target.type === "service_worker");
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
    return rules.length > 0;
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

/**
 * The reader is a child iframe injected by the takeover content script under
 * the unchanged source URL — never the top-level document (the retired
 * extension-owned-reader shape).
 */
export async function waitForTakeoverReader(page: Page): Promise<Frame> {
  // The mount waits on the whole takeover pipeline — capture round-trip
  // included, which for a large paper under sequential-suite contention can
  // exceed 30s. Match the generosity of the suite's other readiness waits.
  const mountDeadline = Date.now() + 120_000;
  for (;;) {
    const candidate = page.frame({
      url: (url) => url.pathname.endsWith("/reader/reader.html"),
    }) ?? null;
    if (candidate !== null && candidate !== page.mainFrame()) {
      return candidate;
    }
    assert(
      Date.now() < mountDeadline,
      "MathRead reader iframe did not mount on the PDF page",
    );
    await Bun.sleep(100);
  }
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
  assert(typeof value.title === "string");
  assert(typeof value.first_read === "string");
  assert(typeof value.last_read === "string");
  return {
    key: value.key,
    title: value.title,
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

async function waitForLibraryTitles(
  surface: ReaderSurface,
  expectedTitles: string[],
): Promise<void> {
  const sortedExpectedTitles = [...expectedTitles].sort();
  let lastActualTitles: string[] = [];
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const actualTitles = await surface
      .locator('[data-testid="library-entry"]')
      .evaluateAll((entries) =>
        entries.map((entry) => {
          if (!(entry instanceof HTMLElement)) {
            throw new Error("Library entry is not an HTMLElement");
          }
          // Visited entries render a button that navigates to the source
          // URL; provenance-less disk backups render a plain title span.
          const open = entry.querySelector(".library-entry-open");
          if (!(open instanceof HTMLElement)) {
            throw new Error("Library entry omitted its title element");
          }
          const { textContent } = open;
          if (textContent === null) {
            throw new Error("Library entry title element is empty");
          }
          return textContent;
        }),
      );
    lastActualTitles = actualTitles;
    const sortedActualTitles = [...actualTitles].sort();
    if (
      sortedActualTitles.length === sortedExpectedTitles.length &&
      sortedActualTitles.every(
        (title, index) => sortedExpectedTitles[index] === title,
      )
    ) {
      return;
    }
    await Bun.sleep(100);
  }
  throw new Error(
    `Timed out waiting for library titles ${expectedTitles.join(", ")}; last titles: ${lastActualTitles.join(", ")}`,
  );
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
  surface: ReaderSurface,
  expected: string,
): Promise<void> {
  await surface.waitForFunction(
    (expectedText) => navigator.clipboard.readText().then((text) => text === expectedText),
    expected,
  );
}

async function readNonEmptyClipboard(surface: ReaderSurface): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = await surface.evaluate(() => navigator.clipboard.readText());
    if (value.length > 0) {
      return value;
    }
    await Bun.sleep(100);
  }
  throw new Error("Timed out waiting for MathRead to copy a source link");
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
  surface: ReaderSurface,
  key: string,
): Promise<string | null> {
  // Legacy highlights live in the extension origin's localStorage, which the
  // takeover reader iframe shares; the top page is the PDF's own origin.
  return surface.evaluate(
    (key) => localStorage.getItem(`mathread-legacy-highlights:${key}`),
    key,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function attachPageDiagnostics(
  page: Page,
  artifacts: CaptureArtifacts,
  scenario: CaptureScenario,
): void {
  void page.addInitScript(() => {
    setInterval(() => {
      console.log(`mathread-heartbeat ${Date.now()}`);
    }, 2000);
  });
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
    screenshotAfterPath: join(screenshotDir, "after.png"),
    tracePath: join(root, "trace.zip"),
  };
  writeFileSync(artifacts.backendLogPath, "");
  writeFileSync(artifacts.eventsLogPath, "");
  return artifacts;
}

function appendEvent(logPath: string, event: PersistedEvent): void {
  // ts is the bun-side arrival time. The page-side heartbeat (see
  // attachPageDiagnostics) carries its own emit time, so a stalled run's log
  // distinguishes a browser that stopped emitting from a test process that
  // stopped receiving.
  appendFileSync(logPath, `${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`);
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

// Evidence from anything but the latest run is worthless: if it passed there is
// nothing to inspect, and a new failure supersedes an old one. Each test process
// therefore deletes every prior root at startup. The two-hour guard only protects
// a concurrently running suite's roots from deletion mid-flight.
const testRootMaxAgeMs = 2 * 60 * 60 * 1000;
let prunedStaleTestRoots = false;

function mkdtemp(prefix: string): string {
  if (!prunedStaleTestRoots) {
    prunedStaleTestRoots = true;
    pruneStaleTestRoots();
  }
  return mkdtempSync(join(tmpdir(), prefix));
}

/**
 * Failed runs retain evidence (see cleanupTestRoot). Without pruning, roots
 * accumulate across sessions: 1,800 of them filled the disk and starved later
 * browser launches into arbitrary timeouts (#34, absorbed #37).
 */
function pruneStaleTestRoots(): void {
  for (const entry of readdirSync(tmpdir())) {
    if (!entry.startsWith("mathread-")) {
      continue;
    }
    const path = join(tmpdir(), entry);
    let modifiedMs: number;
    try {
      modifiedMs = statSync(path).mtimeMs;
    } catch {
      // Another test process may prune the same root between listing and stat.
      continue;
    }
    if (Date.now() - modifiedMs > testRootMaxAgeMs) {
      rmSync(path, { recursive: true, force: true });
    }
  }
}

/**
 * A failed run keeps only its artifacts/ directory as evidence. The Chromium
 * profile and built-extension copy are reproducible bulk — retaining them
 * whole is how /tmp reached 1,807 leaked roots and a full disk.
 */
export function cleanupTestRoot(testRoot: string, completed: boolean): void {
  if (completed) {
    rmSync(testRoot, { recursive: true, force: true });
    return;
  }
  for (const entry of readdirSync(testRoot)) {
    if (entry !== "artifacts") {
      rmSync(join(testRoot, entry), { recursive: true, force: true });
    }
  }
}
