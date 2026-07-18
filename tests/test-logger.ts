// Structured phase tracing for the installed-extension suites.
//
// The bun<->Playwright CDP transport can wedge under sequential multi-launch
// load: a CDP round-trip (innerText, reload, close) never resolves, so the test
// hangs to its wall-clock timeout and bun hard-kills the process. A coarse
// console.error breadcrumb cannot say WHICH await hung. This logger wraps each
// await in a start/end pair written through a SYNCHRONOUS pino destination, so a
// hard kill still leaves the last "start" (with no matching "end") flushed to
// disk — that dangling phase is the hung operation.
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright";
import pino from "pino";

export interface TraceLogger {
  logger: pino.Logger;
  file: string;
}

// The caller supplies the output directory explicitly — it owns a test root, so
// the location is required, not discovered from an optional env default. Writing
// under the test root's artifacts/ means the trace is retained exactly when the
// test fails (cleanupTestRoot keeps artifacts/) and cleaned when it passes.
export function createTraceLogger(dir: string, label: string): TraceLogger {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${label}-${process.pid}-${Date.now()}.ndjson`);
  // sync:true is load-bearing: a buffered write would be lost when bun kills the
  // process at the test timeout, discarding the one line that names the hang.
  const destination = pino.destination({ dest: file, sync: true });
  const logger = pino({ base: { label, pid: process.pid } }, destination);
  logger.info({ event: "trace-open", file });
  return { logger, file };
}

// Pipe the page's console, uncaught errors, and network activity into the
// trace. The autosave path is the prime suspect for the note-not-persisted
// failure: this shows whether the PUT/POST to the backend fired at all and what
// it returned, plus any overlay-side console error, interleaved with the phase
// steps by timestamp.
export function attachPageTrace(page: Page, logger: pino.Logger): void {
  page.on("console", (message) => {
    logger.info({ event: "console", level: message.type(), text: message.text() });
  });
  page.on("pageerror", (error) => {
    logger.error({ event: "pageerror", err: String(error) });
  });
  page.on("requestfailed", (request) => {
    const failure = request.failure();
    logger.warn({
      event: "requestfailed",
      method: request.method(),
      url: request.url(),
      failure: failure === null ? null : failure.errorText,
    });
  });
  page.on("response", (response) => {
    const url = response.url();
    // The PDF bytes are noise; the note/library/capture calls are the signal.
    if (url.includes("/notes/") || url.includes("/library") || url.includes("/capture")) {
      logger.info({
        event: "response",
        status: response.status(),
        method: response.request().method(),
        url,
      });
    }
  });
}

// Dump the uvicorn backend log and the reading-root sidecar state into the
// trace so the backend side of a persist failure is captured before the test
// root is reclaimed.
export function dumpBackendState(
  logger: pino.Logger,
  backendLogPath: string,
  readingRoot: string,
): void {
  if (existsSync(backendLogPath)) {
    logger.info({ event: "backend-log", text: readFileSync(backendLogPath, "utf8") });
  }
  if (existsSync(readingRoot)) {
    for (const entry of readdirSync(readingRoot)) {
      const full = join(readingRoot, entry);
      const body = entry.endsWith(".md") ? readFileSync(full, "utf8") : null;
      logger.info({ event: "reading-root-entry", entry, mdBody: body });
    }
  }
}

// Bound a teardown await that can hang on a degraded CDP transport. A wedged
// context.close() would otherwise consume the whole per-test timeout (observed:
// a 30s reload timeout followed by a context.close() that never returns, hanging
// to the 120s wall). On timeout this rejects with a structured error so the
// caller fails fast; the underlying browser process is reaped when bun exits.
export async function settleWithin<T>(
  label: string,
  ms: number,
  op: () => Promise<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} did not settle within ${ms}ms (transport wedge)`)),
      ms,
    );
  });
  try {
    return await Promise.race([op(), timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

// Console-error messages that are test-harness artifacts, not app defects.
// Kept deliberately narrow — the point of the gate is to surface real errors.
const BENIGN_CONSOLE_ERROR = /\/favicon\.ico\b/;

export interface ConsoleErrorGate {
  readonly errors: ReadonlyArray<{ url: string; text: string }>;
}

// Collect browser console errors and uncaught page errors from the page and all
// its frames, logging each through pino. Playwright's page-level console event
// bubbles messages from cross-origin iframes (the reader runs in one), which a
// top-page page.on("pageerror") listener misses entirely. The returned gate lets
// a test FAIL when the reader logs an error, closing the blind spot where the
// app threw on load while the suite stayed green.
export function attachConsoleErrorGate(page: Page, logger: pino.Logger): ConsoleErrorGate {
  const errors: { url: string; text: string }[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") {
      return;
    }
    const url = message.location().url;
    const text = message.text();
    logger.warn({ event: "console-error", url, text });
    if (BENIGN_CONSOLE_ERROR.test(url) || BENIGN_CONSOLE_ERROR.test(text)) {
      return;
    }
    errors.push({ url, text });
  });
  page.on("pageerror", (error) => {
    logger.error({ event: "pageerror", err: String(error) });
    errors.push({ url: "pageerror", text: String(error) });
  });
  return { errors };
}

export function assertNoConsoleErrors(gate: ConsoleErrorGate): void {
  if (gate.errors.length === 0) {
    return;
  }
  const detail = gate.errors.map((entry) => `  [${entry.url}] ${entry.text}`).join("\n");
  throw new Error(
    `Reader logged ${gate.errors.length} unexpected browser error(s):\n${detail}`,
  );
}

// Wrap one awaited operation. A hang leaves "start" with no "end"; a slow step
// leaves an "end" with its own ms so ordinary latency is visible too.
export async function step<T>(
  logger: pino.Logger,
  phase: string,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  logger.info({ phase, event: "start" });
  try {
    const result = await fn();
    logger.info({ phase, event: "end", ms: Date.now() - start });
    return result;
  } catch (error) {
    logger.error({ phase, event: "error", ms: Date.now() - start, err: String(error) });
    throw error;
  }
}
