// Full-feature pass of the reader against real math arXiv PDFs: capture through
// the backend, render, text-selection highlight, annotation persisted as a pandoc
// fenced div in the on-disk markdown sidecar, re-render after reload, re-render of
// a hand-authored block, comment editing, deletion, notes preview, and search.
//
// The PDFs are real arXiv papers, downloaded once into tests/fixtures/arxiv/ and
// served to the backend from a local server (no per-run network dependency after
// the first download; a failed download fails the suite loudly).
import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { parseAnnotations, serializeAnnotation } from "../extension/poc/annotations.ts";

const ARXIV_IDS = ["1612.09116", "2312.13488"];
const FIXTURE_DIR = join(import.meta.dir, "fixtures", "arxiv");

async function fixturePdf(arxivId: string): Promise<Uint8Array> {
  const path = join(FIXTURE_DIR, `${arxivId}.pdf`);
  if (!existsSync(path)) {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    const response = await fetch(`https://arxiv.org/pdf/${arxivId}`, {
      headers: { "user-agent": "mathread-tests (+https://github.com/dzackgarza)" },
    });
    if (!response.ok) {
      throw new Error(`arXiv fixture download failed for ${arxivId}: HTTP ${response.status}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert(bytes.length > 10_000 && new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-");
    writeFileSync(path, bytes);
  }
  return new Uint8Array(readFileSync(path));
}

interface Harness {
  page: Page;
  backendPort: number;
  readingRoot: string;
  key: string;
  sidecarPath: string;
}

async function withArxivReader(arxivId: string, run: (h: Harness) => Promise<void>): Promise<void> {
  const pdfBytes = await fixturePdf(arxivId);
  const backendPort = await unusedTcpPort();
  const testRoot = mkdtempSync(join(tmpdir(), "mathread-arxiv-"));
  const readingRoot = join(testRoot, "reading-root");
  mkdirSync(readingRoot);
  const extensionPath = configuredExtensionCopy(testRoot, backendPort);
  const backendLogPath = join(testRoot, "backend.log");
  const logFd = openSync(backendLogPath, "a");
  const backend = Bun.spawn(
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
    { stdout: logFd, stderr: logFd },
  );
  const pdfServer = Bun.serve({
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname === `/${arxivId}.pdf`) {
        return new Response(pdfBytes.slice().buffer, { headers: { "content-type": "application/pdf" } });
      }
      return new Response("not found", { status: 404 });
    },
  });
  let context: BrowserContext | undefined;

  try {
    await waitForHttpService(`http://127.0.0.1:${backendPort}/openapi.json`);

    // Feature: capture a real arXiv PDF through the backend.
    const pdfUrl = `http://127.0.0.1:${pdfServer.port}/${arxivId}.pdf`;
    const captureResponse = await fetch(`http://127.0.0.1:${backendPort}/capture-url`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pdf_url: pdfUrl, source_url: pdfUrl, headers: {} }),
    });
    expect(captureResponse.ok).toBe(true);
    const captured: unknown = await captureResponse.json();
    assert(
      typeof captured === "object" &&
        captured !== null &&
        typeof (captured as { stored_path?: unknown }).stored_path === "string",
    );
    const storedPath = (captured as { stored_path: string }).stored_path;
    const key = storedPath.split("/").pop()!;
    const sidecarPath = join(readingRoot, "inbox", key.replace(/\.pdf$/, ".md"));

    // Feature: the capture is listed in the backend library.
    const library: unknown = await (await fetch(`http://127.0.0.1:${backendPort}/library`)).json();
    assert(Array.isArray(library));
    expect(library.some(entry => (entry as { key?: unknown }).key === key)).toBe(true);

    context = await chromium.launchPersistentContext(join(testRoot, "profile"), {
      executablePath: "/bin/chromium",
      headless: true,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    const serviceWorker = await waitForExtensionServiceWorker(context);
    const extensionId = new URL(serviceWorker.url()).host;
    const page = await context.newPage();
    page.on("pageerror", error => console.error("READER-PAGE-ERROR", error));
    page.on("console", message => {
      if (message.type() === "error") {
        console.error("READER-CONSOLE-ERROR", message.text());
      }
    });
    await page.goto(`chrome-extension://${extensionId}/poc/reader.html?key=${encodeURIComponent(key)}`);

    await run({ page, backendPort, readingRoot, key, sidecarPath });
    await page.close();
  } finally {
    if (context !== undefined) {
      await context.close();
    }
    pdfServer.stop(true);
    backend.kill();
    await backend.exited;
    closeSync(logFd);
  }
}

for (const arxivId of ARXIV_IDS) {
  test(
    `arXiv ${arxivId}: annotations persist as fenced divs in the sidecar and re-render from it`,
    async () => {
      await withArxivReader(arxivId, async ({ page, backendPort, key, sidecarPath }) => {
        // Feature: every page of the real paper renders with a live text layer.
        const pageTotal = await waitForNonEmptyText(page, "#page-total");
        const pageCount = Number(pageTotal);
        expect(pageCount).toBeGreaterThan(5);
        await waitFor(async () => (await page.locator("#viewer canvas").count()) === pageCount, 120_000);
        const textLayerSpanCount = await page.locator('.page[data-page-number="1"] .textLayer span').count();
        expect(textLayerSpanCount).toBeGreaterThan(10);

        // Feature: select real text on page 1 and commit a highlight.
        const selectedText = await page.evaluate(() => {
          const spans = Array.from(
            document.querySelectorAll('.page[data-page-number="1"] .textLayer span'),
          );
          const span = spans.find(s => (s.textContent ?? "").trim().length > 20);
          if (span === undefined) {
            throw new Error("no selectable text-layer span on page 1");
          }
          const range = document.createRange();
          range.selectNodeContents(span);
          const selection = window.getSelection()!;
          selection.removeAllRanges();
          selection.addRange(range);
          span.closest(".textLayer")!.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
          return (span.textContent ?? "").trim();
        });
        await waitFor(async () => (await page.locator("#selection-popup.visible").count()) === 1, 15_000);
        await page.locator('.popup-swatches button[data-color="#91edd0"]').click();

        // The highlight renders immediately from the note doc.
        await waitFor(async () => (await page.locator(".highlight-mark").count()) > 0, 15_000);

        // Feature: autosave persists the annotation as a pandoc fenced div in the
        // on-disk markdown sidecar, carrying page/color/rects/quoted text.
        await waitFor(() => existsSync(sidecarPath) && readFileSync(sidecarPath, "utf8").includes("::: {.annotation"), 15_000);
        const sidecar = readFileSync(sidecarPath, "utf8");
        const stored = parseAnnotations(sidecar);
        expect(stored.length).toBe(1);
        expect(stored[0]!.pageNumber).toBe(1);
        expect(stored[0]!.color).toBe("#91edd0");
        expect(stored[0]!.rects.length).toBeGreaterThan(0);
        expect(stored[0]!.text).toBe(selectedText);

        // Feature: comments edited in the sidebar persist into the same div.
        await page.locator("#toggle-sidebar").click();
        const commentBox = page.locator(".highlight-item-comment").first();
        await commentBox.fill("checked against Nikulin");
        await commentBox.blur();
        await waitFor(() => {
          const parsed = parseAnnotations(readFileSync(sidecarPath, "utf8"));
          return parsed[0]?.comment === "checked against Nikulin";
        }, 15_000);

        // Feature: a reload re-renders the highlight purely from the sidecar markdown.
        await page.reload();
        await waitFor(async () => (await page.locator(".highlight-mark").count()) > 0, 120_000);
        await page.locator("#toggle-sidebar").click();
        await waitFor(async () => (await page.locator(".highlight-item").count()) === 1, 15_000);

        // Feature: a hand-authored annotation block (written straight to the note,
        // never through the UI) re-renders on the fly like any other.
        const current = parseAnnotations(readFileSync(sidecarPath, "utf8"));
        const handBlock = serializeAnnotation({
          id: "hand-authored",
          pageNumber: 2,
          color: "#f8bfbf",
          created: new Date().toISOString(),
          rects: [{ xPct: 0.1, yPct: 0.1, wPct: 0.4, hPct: 0.05 }],
          text: "hand-written annotation",
          comment: "added by editing the markdown directly",
        });
        const putResponse = await fetch(`http://127.0.0.1:${backendPort}/notes/${encodeURIComponent(key)}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key, text: `${readFileSync(sidecarPath, "utf8")}\n${handBlock}\n` }),
        });
        expect(putResponse.ok).toBe(true);
        await page.reload();
        await page.locator("#toggle-sidebar").click();
        await waitFor(async () => (await page.locator(".highlight-item").count()) === 2, 120_000);
        // The mark renders when its page finishes drawing, which can trail the sidebar
        // list; wait for it rather than sampling immediately.
        await waitFor(async () => (await page.locator('.page[data-page-number="2"] .highlight-mark').count()) === 1, 120_000);
        assert(current.length === 1); // sanity: the UI-created one was still there

        // Feature: notes preview renders annotations as content, not raw ::: fences.
        await page.locator('.nav-tb-btn[data-tab="keypoints"]').dispatchEvent("click");
        await page.locator("#notes-mode-preview").click();
        const previewText = await page.locator("#notes-preview").innerText();
        expect(previewText.includes(":::")).toBe(false);
        expect(previewText.includes("hand-written annotation")).toBe(true);

        // Feature: deleting from the sidebar removes the fenced div from the sidecar.
        await page.locator(".highlight-item .remove-btn").first().click();
        await waitFor(() => parseAnnotations(readFileSync(sidecarPath, "utf8")).length === 1, 15_000);

        // Feature: search finds real terms from the paper's text layer.
        await page.locator("#search-toggle").click();
        const searchWord = selectedText.split(/\s+/).find(word => word.length > 4) ?? selectedText.slice(0, 6);
        await page.locator("#search-input").fill(searchWord);
        await waitFor(async () => /\d+ \/ \d+/.test(await page.locator("#search-count").innerText()), 30_000);
      });
    },
    { timeout: 600_000 },
  );
}

// ---------- harness plumbing ----------

function configuredExtensionCopy(testRoot: string, backendPort: number): string {
  const extensionPath = join(testRoot, "extension");
  cpSync(join(process.cwd(), "dist", "extension"), extensionPath, { recursive: true });
  const manifestPath = join(extensionPath, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { host_permissions: string[] };
  assert(Array.isArray(manifest.host_permissions));
  manifest.host_permissions = [
    `http://127.0.0.1:${backendPort}/*`,
    ...manifest.host_permissions.filter(permission => !permission.startsWith("http://127.0.0.1:")),
  ];
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return extensionPath;
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

async function waitForHttpService(url: string): Promise<void> {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // not up yet
    }
    await Bun.sleep(100);
  }
  throw new Error(`Timed out waiting for HTTP service at ${url}`);
}

async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }
    await Bun.sleep(200);
  }
  throw new Error("Timed out waiting for condition");
}

async function waitForNonEmptyText(page: Page, selector: string): Promise<string> {
  let text = "";
  await waitFor(async () => {
    text = (await page.locator(selector).innerText()).trim();
    return /^[1-9]\d*$/.test(text);
  }, 120_000);
  return text;
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
