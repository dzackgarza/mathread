// Region screenshot ("clip") capture end-to-end against the installed extension
// and a real arXiv PDF: enter clip mode, drag a rectangle over a rendered PDF.js
// page, and prove the PNG is uploaded, referenced in the note sidecar, stored on
// disk, and rendered back in the preview. The panic rewrite dropped this feature.
import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import {
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
import { chromium, type BrowserContext } from "playwright";
import { chromiumExecutablePath } from "./browser-helpers";
import { cleanupTestRoot, waitForTakeoverReader } from "./extension-boundary-cases";

const ARXIV_ID = "1612.09116";
const FIXTURE = join(import.meta.dir, "fixtures", "arxiv", `${ARXIV_ID}.pdf`);

test(
  "clip: drag a region over the PDF, upload it, reference it in the note, render it back",
  async () => {
    const pdfBytes = new Uint8Array(readFileSync(FIXTURE));
    const backendPort = await unusedTcpPort();
    const testRoot = mkdtempSync(join(tmpdir(), "mathread-clip-"));
    const readingRoot = join(testRoot, "reading-root");
    mkdirSync(readingRoot);
    const artifactsDir = join(testRoot, "artifacts");
    mkdirSync(artifactsDir);
    const extensionPath = configuredExtensionCopy(testRoot, backendPort);
    const logFd = openSync(join(testRoot, "backend.log"), "a");
    const backend = Bun.spawn(
      [join(import.meta.dir, "..", ".venv", "bin", "mathread"), "serve",
        "--host", "127.0.0.1", "--port", String(backendPort), "--root", readingRoot],
      { stdout: logFd, stderr: logFd },
    );
    const pdfServer = Bun.serve({
      port: 0,
      fetch: (request) =>
        new URL(request.url).pathname === `/${ARXIV_ID}.pdf`
          ? new Response(pdfBytes.slice().buffer, { headers: { "content-type": "application/pdf" } })
          : new Response("not found", { status: 404 }),
    });
    let context: BrowserContext | undefined;
    let completed = false;
    try {
      await waitForHttpService(`http://127.0.0.1:${backendPort}/openapi.json`);
      const pdfUrl = `http://127.0.0.1:${pdfServer.port}/${ARXIV_ID}.pdf`;
      const form = new FormData();
      form.append("pdf", new Blob([pdfBytes.slice().buffer], { type: "application/pdf" }), `${ARXIV_ID}.pdf`);
      form.append("pdf_url", pdfUrl);
      form.append("source_url", pdfUrl);
      const captured = (await (await fetch(`http://127.0.0.1:${backendPort}/capture-bytes`, { method: "POST", body: form })).json()) as {
        stored_path: string;
      };
      const key = captured.stored_path.split("/").pop()!;
      const notePath = join(readingRoot, key.replace(/\.pdf$/, ".md"));

      context = await chromium.launchPersistentContext(join(testRoot, "profile"), {
        executablePath: chromiumExecutablePath(),
        headless: true,
        args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
      });
      await waitForExtensionServiceWorker(context);
      const page = await context.newPage();
      await page.goto(pdfUrl);
      const reader = await waitForTakeoverReader(page);

      // The clip button gates on an open note; wait until it enables.
      const clipButton = reader.locator('[data-testid="overlay-tab-clip"]');
      await clipButton.waitFor({ state: "visible", timeout: 30_000 });
      await waitFor(async () => !(await clipButton.isDisabled()), 30_000);

      // A rendered, laid-out page canvas is required before a region can be
      // cropped — "visible" alone can precede PDF.js sizing the canvas.
      const canvas = reader.locator("#viewer .canvasWrapper canvas").first();
      await canvas.waitFor({ state: "visible", timeout: 30_000 });
      const box = await waitForBox(canvas, 30_000);

      await clipButton.click();
      // Drag a rectangle well inside the first page.
      const x1 = box.x + box.width * 0.2;
      const y1 = box.y + box.height * 0.12;
      const x2 = box.x + box.width * 0.8;
      const y2 = box.y + box.height * 0.24;
      await page.mouse.move(x1, y1);
      await page.mouse.down();
      await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 8 });
      await page.mouse.move(x2, y2, { steps: 8 });
      await page.mouse.up();

      // The clip lands in the sidecar as a markdown image at clips/<key>/clip-NN.png.
      await waitFor(() => existsSync(notePath) && /!\[[^\]]*\]\(clips\/[^)]+\.png\)/.test(readFileSync(notePath, "utf8")), 30_000);
      const note = readFileSync(notePath, "utf8");
      const match = /\((clips\/[^)]+\.png)\)/.exec(note);
      assert(match !== null, "note references a clip path");
      const clipRelative = match[1];
      assert(clipRelative !== undefined, "clip path captured");
      const clipOnDisk = join(readingRoot, clipRelative);
      expect(existsSync(clipOnDisk)).toBe(true);
      expect(readFileSync(clipOnDisk).subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

      // The preview (clip mode switches to notes) renders it as a loaded <img>.
      const previewImage = reader.locator("#notes-preview img").first();
      await previewImage.waitFor({ state: "visible", timeout: 30_000 });
      await waitFor(async () => (await previewImage.evaluate((el) => (el as HTMLImageElement).naturalWidth)) > 0, 30_000);

      await page.screenshot({ path: join(artifactsDir, "clip-e2e.png"), fullPage: false });
      await page.close();
      completed = true;
    } finally {
      if (context !== undefined) {
        await context.close();
      }
      pdfServer.stop(true);
      backend.kill();
      await backend.exited;
      cleanupTestRoot(testRoot, completed);
    }
  },
  { timeout: 120_000 },
);

// ---------- harness plumbing (mirrors arxiv-features.test.ts) ----------

function configuredExtensionCopy(testRoot: string, backendPort: number): string {
  const extensionPath = join(testRoot, "extension");
  cpSync(join(process.cwd(), "dist", "extension"), extensionPath, { recursive: true });
  const manifestPath = join(extensionPath, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { host_permissions: string[] };
  manifest.host_permissions = [
    `http://127.0.0.1:${backendPort}/*`,
    ...manifest.host_permissions.filter((permission) => !permission.startsWith("http://127.0.0.1:")),
  ];
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return extensionPath;
}

async function waitForExtensionServiceWorker(context: BrowserContext) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const worker = context.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"));
    if (worker !== undefined) {
      return worker;
    }
    await Bun.sleep(100);
  }
  throw new Error("Timed out waiting for MathRead extension service worker");
}

async function waitForHttpService(url: string): Promise<void> {
  let lastError: unknown = undefined;
  for (let attempt = 0; attempt < 600; attempt += 1) {
    try {
      if ((await fetch(url)).ok) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await Bun.sleep(100);
  }
  throw new Error(`Timed out waiting for HTTP service at ${url}; last error: ${String(lastError)}`);
}

async function waitForBox(
  locator: import("playwright").Locator,
  timeoutMs: number,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const box = await locator.boundingBox();
    if (box !== null && box.width > 4 && box.height > 4) {
      return box;
    }
    await Bun.sleep(200);
  }
  throw new Error("Timed out waiting for a laid-out canvas box");
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
