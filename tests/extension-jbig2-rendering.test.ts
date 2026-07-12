import { strict as assert } from "node:assert";
import { closeSync, cpSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { chromium, type BrowserContext, type Page } from "playwright";
import { chromiumExecutablePath } from "./browser-helpers";

const fixturePath = join(
  import.meta.dir,
  "fixtures",
  "pdfjs-jbig2-file-header.pdf",
);
const fixtureSourceUrl =
  "https://github.com/mozilla/pdf.js/blob/master/test/pdfs/jbig2_file_header.pdf";

test("extension reader renders the PDF.js JBig2 fixture as visible pixels", async () => {
  const backendPort = await unusedTcpPort();
  const testRoot = mkdtempSync(join(tmpdir(), "mathread-jbig2-reader-"));
  const readingRoot = join(testRoot, "reading-root");
  mkdirSync(readingRoot);
  const extensionPath = configuredExtensionCopy(testRoot, backendPort);
  const backendLogFd = openSync(join(testRoot, "backend.log"), "a");
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
    { stdout: backendLogFd, stderr: backendLogFd },
  );
  let context: BrowserContext | undefined;

  try {
    waitForHttpService(`http://127.0.0.1:${backendPort}/openapi.json`);
    const libraryKey = await captureFixture(backendPort);
    context = await chromium.launchPersistentContext(join(testRoot, "profile"), {
      executablePath: chromiumExecutablePath(),
      headless: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    const extensionId = await extensionIdFor(context);
    const page = await context.newPage();
    await page.goto(
      `chrome-extension://${extensionId}/reader/reader.html?key=${encodeURIComponent(libraryKey)}`,
      { waitUntil: "domcontentloaded" },
    );

    const rendered = await canvasPixelEvidence(page, 0);
    expect(rendered.canvasSize).toBeGreaterThan(10_000);
    expect(rendered.nonWhitePixels).toBeGreaterThan(250);
  } finally {
    if (context !== undefined) {
      await context.close();
    }
    backend.kill();
    await backend.exited;
    closeSync(backendLogFd);
  }
}, 60_000);

async function captureFixture(backendPort: number): Promise<string> {
  const form = new FormData();
  form.append(
    "pdf",
    new Blob([readFileSync(fixturePath)], { type: "application/pdf" }),
    "pdfjs-jbig2-file-header.pdf",
  );
  form.append("pdf_url", fixtureSourceUrl);
  form.append("source_url", fixtureSourceUrl);
  const response = await fetch(
    `http://127.0.0.1:${backendPort}/capture-bytes`,
    { method: "POST", body: form },
  );
  assert.equal(response.status, 200);
  const payload: unknown = await response.json();
  assertCaptureResponse(payload);
  const key = payload.stored_path.split("/").at(-1);
  assert(key !== undefined && key.length > 0);
  return key;
}

function assertCaptureResponse(
  value: unknown,
): asserts value is { stored_path: string } {
  assert(typeof value === "object" && value !== null);
  assert("stored_path" in value && typeof value.stored_path === "string");
}

function configuredExtensionCopy(testRoot: string, backendPort: number): string {
  const extensionPath = join(testRoot, "extension");
  cpSync(join(import.meta.dir, "..", "dist", "extension"), extensionPath, {
    recursive: true,
  });
  const manifestPath = join(extensionPath, "manifest.json");
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
  assertManifest(manifest);
  manifest.host_permissions = [
    `http://127.0.0.1:${backendPort}/*`,
    ...manifest.host_permissions.filter(
      (permission) => !permission.startsWith("http://127.0.0.1:"),
    ),
  ];
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return extensionPath;
}

function assertManifest(
  value: unknown,
): asserts value is { host_permissions: string[] } {
  assert(typeof value === "object" && value !== null);
  assert("host_permissions" in value);
  assert(Array.isArray(value.host_permissions));
  assert(value.host_permissions.every((permission) => typeof permission === "string"));
}

async function extensionIdFor(context: BrowserContext): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const worker = context
      .serviceWorkers()
      .find((candidate) => candidate.url().startsWith("chrome-extension://"));
    if (worker !== undefined) {
      return new URL(worker.url()).host;
    }
    await Bun.sleep(100);
  }
  throw new Error("MathRead extension service worker did not start");
}

async function canvasPixelEvidence(
  page: Page,
  canvasIndex: number,
): Promise<{ canvasSize: number; nonWhitePixels: number }> {
  let latest = { canvasSize: 0, nonWhitePixels: 0 };
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const readerError = page.locator("#reader-error");
    if ((await readerError.count()) > 0) {
      throw new Error("Reader reported an error before rendering the JBig2 fixture");
    }
    latest = await page.evaluate((index) => {
      function rgbaAt(
        pixels: Uint8ClampedArray,
        offset: number,
      ): [number, number, number, number] {
        const channels = [
          pixels.at(offset),
          pixels.at(offset + 1),
          pixels.at(offset + 2),
          pixels.at(offset + 3),
        ];
        if (channels.some(channel => channel === undefined)) {
          throw new Error(`Incomplete RGBA pixel at offset ${offset}`);
        }
        return channels as [number, number, number, number];
      }

      function isNonWhitePixel(
        [red, green, blue, alpha]: [number, number, number, number],
      ): boolean {
        return alpha > 0 && Math.min(red, green, blue) < 245;
      }

      const canvas = document.querySelectorAll<HTMLCanvasElement>(
        "#viewer canvas",
      )[index];
      if (canvas === undefined) {
        return { canvasSize: 0, nonWhitePixels: 0 };
      }
      const context = canvas.getContext("2d");
      if (context === null) {
        return { canvasSize: canvas.width * canvas.height, nonWhitePixels: 0 };
      }
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let nonWhitePixels = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        if (isNonWhitePixel(rgbaAt(pixels, offset))) {
          nonWhitePixels += 1;
        }
      }
      return { canvasSize: canvas.width * canvas.height, nonWhitePixels };
    }, canvasIndex);
    if (latest.canvasSize > 10_000 && latest.nonWhitePixels > 250) {
      return latest;
    }
    await Bun.sleep(100);
  }
  return latest;
}

function waitForHttpService(url: string): void {
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
