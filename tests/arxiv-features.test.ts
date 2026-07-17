// Full-feature pass of the reader against real math arXiv PDFs: capture through
// the backend, render, text-selection highlight, annotation persisted as a pandoc
// fenced div in the on-disk markdown file, re-render after reload, re-render of
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
import { chromium, type BrowserContext, type Frame, type Page } from "playwright";
import type pino from "pino";
import { chromiumExecutablePath } from "./browser-helpers";
import { cleanupTestRoot, waitForTakeoverReader } from "./extension-boundary-cases";
import { attachPageTrace, createTraceLogger, dumpBackendState, settleWithin, step } from "./test-logger";
const ARXIV_IDS = ["1612.09116", "2312.13488"];
const FIXTURE_DIR = join(import.meta.dir, "fixtures", "arxiv");

async function fixturePdf(arxivId: string): Promise<Uint8Array> {
  const path = join(FIXTURE_DIR, `${arxivId}.pdf`);
  if (!existsSync(path)) {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    const response = await fetch(`https://arxiv.org/pdf/${arxivId}`, {
      headers: {
        "user-agent": "mathread-tests (+https://github.com/dzackgarza)",
      },
    });
    if (!response.ok) {
      throw new Error(
        `arXiv fixture download failed for ${arxivId}: HTTP ${response.status}`,
      );
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert(
      bytes.length > 10_000 &&
        new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-",
    );
    writeFileSync(path, bytes);
  }
  return new Uint8Array(readFileSync(path));
}

interface Harness {
  reader: Frame;
  page: Page;
  backendPort: number;
  readingRoot: string;
  key: string;
  notePath: string;
  logger: pino.Logger;
}

async function withArxivReader(
  arxivId: string,
  run: (h: Harness) => Promise<void>,
): Promise<void> {
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
        return new Response(pdfBytes.slice().buffer, {
          headers: { "content-type": "application/pdf" },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  let context: BrowserContext | undefined;
  let completed = false;
  let primaryError: unknown = undefined;
  // Trace under the test root's artifacts/, which cleanupTestRoot retains on
  // failure and removes on success.
  const artifactsDir = join(testRoot, "artifacts");
  mkdirSync(artifactsDir, { recursive: true });
  const { logger, file } = createTraceLogger(artifactsDir, `arxiv-${arxivId}`);
  console.error(`[arxiv] trace: ${file}`);

  try {
    await step(logger, "backend-ready", () =>
      waitForHttpService(`http://127.0.0.1:${backendPort}/openapi.json`),
    );

    // Feature: capture a real arXiv PDF through the backend.
    const pdfUrl = `http://127.0.0.1:${pdfServer.port}/${arxivId}.pdf`;
    const captureResponse = await fetch(
      `http://127.0.0.1:${backendPort}/capture-bytes`,
      {
        method: "POST",
        body: (() => {
          const form = new FormData();
          form.append(
            "pdf",
            new Blob([pdfBytes.slice().buffer], { type: "application/pdf" }),
            `${arxivId}.pdf`,
          );
          form.append("pdf_url", pdfUrl);
          form.append("source_url", pdfUrl);
          return form;
        })(),
      },
    );
    expect(captureResponse.ok).toBe(true);
    const captured: unknown = await captureResponse.json();
    assert(
      typeof captured === "object" &&
        captured !== null &&
        typeof (captured as { stored_path?: unknown }).stored_path === "string",
    );
    const storedPath = (captured as { stored_path: string }).stored_path;
    const key = storedPath.split("/").pop()!;
    const notePath = join(readingRoot, key.replace(/\.pdf$/, ".md"));

    // Feature: the capture is listed in the backend library.
    const library: unknown = await (
      await fetch(`http://127.0.0.1:${backendPort}/library`)
    ).json();
    assert(Array.isArray(library));
    expect(
      library.some((entry) => (entry as { key?: unknown }).key === key),
    ).toBe(true);

    context = await step(logger, "launch-context", () =>
      chromium.launchPersistentContext(join(testRoot, "profile"), {
        executablePath: chromiumExecutablePath(),
        headless: true,
        args: [
          `--disable-extensions-except=${extensionPath}`,
          `--load-extension=${extensionPath}`,
        ],
      }),
    );
    await step(logger, "await-service-worker", () =>
      waitForExtensionServiceWorker(context!),
    );
    const page = await step(logger, "new-page", () => context!.newPage());
    attachPageTrace(page, logger);
    await step(logger, "goto-pdf", () => page.goto(pdfUrl));
    const reader = await step(logger, "await-takeover-reader", () =>
      waitForTakeoverReader(page),
    );
    await run({ page, reader, backendPort, readingRoot, key, notePath, logger });
    await step(logger, "page-close", () => page.close());
    completed = true;
  } catch (error) {
    primaryError = error;
  } finally {
    // Teardown must never mask the primary failure (e.g. a reload timeout) nor
    // hang on it: bound the CDP close, collect teardown errors, and only raise
    // them when the body itself succeeded.
    const teardownErrors: unknown[] = [];
    if (context !== undefined) {
      try {
        await step(logger, "context-close", () =>
          settleWithin("context.close", 20_000, () => context!.close()),
        );
      } catch (error) {
        teardownErrors.push(error);
      }
    }
    try {
      await step(logger, "pdfserver-stop", async () => pdfServer.stop(true));
    } catch (error) {
      teardownErrors.push(error);
    }
    try {
      await step(logger, "backend-kill", async () => {
        backend.kill();
        await backend.exited;
      });
    } catch (error) {
      teardownErrors.push(error);
    }
    closeSync(logFd);
    // Capture the backend side (uvicorn log + sidecar state) before the root is
    // reclaimed, so a persist failure shows whether the PUT reached the backend
    // and whether the .md was written.
    dumpBackendState(logger, backendLogPath, readingRoot);
    cleanupTestRoot(testRoot, completed);
    logger.info({ event: "trace-close", completed, teardownErrors: teardownErrors.length });
    if (primaryError !== undefined) {
      throw primaryError;
    }
    if (teardownErrors.length > 0) {
      throw new AggregateError(teardownErrors, `arXiv ${arxivId} harness teardown failed`);
    }
  }
}

for (const arxivId of ARXIV_IDS) {
  test(
    `arXiv ${arxivId}: MathRead persists notes for a captured real paper`,
    async () => {
      await withArxivReader(
        arxivId,
        async ({ page, reader: initialReader, backendPort, key, notePath, logger }) => {
          let reader = initialReader;
          const noteMarker = `arXiv reading ${crypto.randomUUID()}`;
          const noteBody = `checked against Nikulin ${crypto.randomUUID()}`;
          const handAuthoredNote = `hand-authored note ${crypto.randomUUID()}`;

          // The MathRead overlay persists real notes beside the captured document.
          await step(logger, "open-notes-tab", () =>
            reader.locator('.nav-expand-btn[data-tab="notes"]').click(),
          );
          let editor = reader.locator("#ai-editor .cm-content");
          await step(logger, "editor-click", () => editor.click());
          await step(logger, "type-note", () =>
            page.keyboard.type(`# ${noteMarker}\n\n**${noteBody}**`),
          );
          await step(logger, "await-note-persisted", () =>
            waitFor(
              () =>
                existsSync(notePath) &&
                readFileSync(notePath, "utf8").includes(noteBody),
              15_000,
            ),
          );
          const note = readFileSync(notePath, "utf8");
          expect(note).toContain(`# ${noteMarker}`);
          expect(note).toContain(`**${noteBody}**`);

          console.error(`[arxiv] typed note saved for ${key}`);
          // Reload obtains the persisted sidecar rather than browser-local state.
          await step(logger, "reload-1", () => page.reload());
          reader = await step(logger, "reload-1-await-reader", () =>
            waitForTakeoverReader(page),
          );
          editor = reader.locator("#ai-editor .cm-content");
          await step(logger, "reload-1-open-notes", () =>
            reader.locator('.nav-expand-btn[data-tab="notes"]').click(),
          );
          await step(logger, "reload-1-await-editor", () =>
            waitFor(async () =>
              (await editor.innerText()).includes(noteBody),
            30_000,
            ),
          );

          console.error(`[arxiv] reload 1 restored editor for ${key}`);
          // A note edited at the backend boundary is reloaded into the same overlay.
          const putResponse = await step(logger, "put-overwrite", () =>
            fetch(
              `http://127.0.0.1:${backendPort}/notes/${encodeURIComponent(key)}/overwrite`,
              {
                method: "PUT",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  key,
                  text: `${readFileSync(notePath, "utf8")}\n${handAuthoredNote}\n`,
                }),
              },
            ),
          );
          expect(putResponse.ok).toBe(true);
          await step(logger, "reload-2", () => page.reload());
          reader = await step(logger, "reload-2-await-reader", () =>
            waitForTakeoverReader(page),
          );
          editor = reader.locator("#ai-editor .cm-content");
          await step(logger, "reload-2-open-notes", () =>
            reader.locator('.nav-expand-btn[data-tab="notes"]').click(),
          );
          await step(logger, "reload-2-await-editor", () =>
            waitFor(
              async () => (await editor.innerText()).includes(handAuthoredNote),
              30_000,
            ),
          );

          console.error(`[arxiv] reload 2 restored hand-authored note for ${key}`);
          // The always-visible preview pane renders the same persisted Markdown.
          await step(logger, "await-preview-render", () =>
            waitFor(async () =>
              (await reader.locator("#notes-preview").innerText()).includes(
                handAuthoredNote,
              ),
            15_000),
          );
        },
      );
    },
    { timeout: 120_000 },
  );
}

// ---------- harness plumbing ----------

function configuredExtensionCopy(
  testRoot: string,
  backendPort: number,
): string {
  const extensionPath = join(testRoot, "extension");
  cpSync(join(process.cwd(), "dist", "extension"), extensionPath, {
    recursive: true,
  });
  const manifestPath = join(extensionPath, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    host_permissions: string[];
  };
  assert(Array.isArray(manifest.host_permissions));
  manifest.host_permissions = [
    `http://127.0.0.1:${backendPort}/*`,
    ...manifest.host_permissions.filter(
      (permission) => !permission.startsWith("http://127.0.0.1:"),
    ),
  ];
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return extensionPath;
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

async function waitForHttpService(url: string): Promise<void> {
  let lastError: unknown = undefined;
  for (let attempt = 0; attempt < 600; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      lastError = new Error(`HTTP ${response.status} ${response.statusText}`);
    } catch (error) {
      lastError = error;
    }
    await Bun.sleep(100);
  }
  throw new Error(
    `Timed out waiting for HTTP service at ${url}; last error: ${String(lastError)}`,
  );
}

async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
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
