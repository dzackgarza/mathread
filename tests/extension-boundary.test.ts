import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium, type BrowserContext } from "playwright";

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

test("built extension captures a clicked PDF link through the real local backend", async () => {
  const backendPort = await unusedTcpPort();
  const testRoot = mkdtemp("mathread-extension-boundary-");
  const readingRoot = join(testRoot, "reading-root");
  mkdirSync(readingRoot);
  const extensionPath = configuredExtensionCopy(testRoot, backendPort);
  const backend = startMathReadBackend(backendPort, readingRoot);
  const courseServer = startCourseServer();
  let context: BrowserContext | undefined;

  try {
    await waitForHttpService(`http://127.0.0.1:${backendPort}/openapi.json`);

    context = await chromium.launchPersistentContext(join(testRoot, "profile"), {
      executablePath: "/bin/chromium",
      headless: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    let [serviceWorker] = context.serviceWorkers();
    if (serviceWorker === undefined) {
      serviceWorker = await context.waitForEvent("serviceworker");
    }
    assert(serviceWorker.url().startsWith("chrome-extension://"));

    await context.addCookies([
      {
        name: cookieName,
        value: cookieValue,
        url: courseServer.url.origin,
      },
    ]);
    const page = await context.newPage();
    await page.goto(`${courseServer.url.origin}/course/`);
    await page.getByRole("link", { name: "Notes" }).click();

    const storedPath = await waitForStoredPdf(readingRoot);
    const metadata = pdfDocinfo(storedPath);

    expect(metadata["/MathReadSourceURL"]).toBe(`${courseServer.url.origin}/course/`);
    expect(metadata["/MathReadPDFURL"]).toBe(`${courseServer.url.origin}/notes.pdf`);
    expect(metadata["/MathReadCapture"]).toBe("capture-url");
  } finally {
    if (context !== undefined) {
      await context.close();
    }
    courseServer.stop(true);
    backend.kill();
    await backend.exited;
  }
});

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
): Bun.Subprocess<"ignore", "inherit", "inherit"> {
  return Bun.spawn(
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
      stdout: "inherit",
      stderr: "inherit",
    },
  );
}

function startCourseServer(): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/course/") {
        return new Response('<a href="/notes.pdf">Notes</a>', {
          headers: { "content-type": "text/html" },
        });
      }
      if (url.pathname === "/notes.pdf") {
        assert(
          request.headers.get("cookie")?.includes(`${cookieName}=${cookieValue}`),
          "PDF download must include the browser session cookie",
        );
        return new Response(pdfBytes, {
          headers: { "content-type": "application/pdf" },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
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
