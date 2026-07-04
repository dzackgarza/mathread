import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  type CaptureResult,
  captureRequestForClickedPdfLink,
  captureUrlEndpointFromManifest,
  isLikelyPdfUrl,
  postCaptureUrl,
} from "../extension/mathread/capture-client";

test("clicked PDF link capture request preserves source page and absolute PDF URL", () => {
  expect(
    captureRequestForClickedPdfLink(
      "../notes/week-01.pdf",
      "https://example.edu/course/pages/index.html",
      "Course page",
    ),
  ).toEqual({
    pdf_url: "https://example.edu/course/notes/week-01.pdf",
    source_url: "https://example.edu/course/pages/index.html",
    title_hint: "Course page",
  });
});

test("PDF URL detection admits PDF paths and ignores ordinary HTML links", () => {
  expect(isLikelyPdfUrl("https://example.edu/course/notes.pdf")).toBe(true);
  expect(isLikelyPdfUrl("https://example.edu/course/index.html")).toBe(false);
});

test("capture endpoint is derived from the extension manifest host permission", () => {
  expect(
    captureUrlEndpointFromManifest({
      host_permissions: ["http://127.0.0.1:8765/*", "https://*/*"],
    }),
  ).toBe("http://127.0.0.1:8765/capture-url");
});

test("capture URL POST returns the backend stored-path result", async () => {
  const originalFetch = globalThis.fetch;
  const captureResult = {
    stored_path: "/home/dzack/math-reading/inbox/notes.pdf",
    original_sha256: "0".repeat(64),
    stored_sha256: "1".repeat(64),
    pdf_url: "https://example.edu/notes.pdf",
    source_url: "https://example.edu/course/",
    capture: "capture-url",
    existing: false,
  } satisfies CaptureResult;
  globalThis.fetch = Object.assign(
    () => Promise.resolve(Response.json(captureResult)),
    { preconnect: originalFetch.preconnect },
  );
  try {
    const result = await postCaptureUrl(
      {
        pdf_url: "https://example.edu/notes.pdf",
        source_url: "https://example.edu/course/",
      },
      "http://127.0.0.1:8765/capture-url",
    );
    expect(result).toEqual(captureResult);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("built extension manifest uses only Chrome-recognized top-level keys", () => {
  expect(parseBuiltManifest()).not.toHaveProperty("mathread");
});

test("built extension manifest declares the MathRead backend permission explicitly", () => {
  expect(parseBuiltManifest().host_permissions).toContain("http://127.0.0.1:8765/*");
});

test("built extension manifest declares packaged Web Store icons", () => {
  const manifest = parseBuiltManifest();
  const icons = manifest.icons;
  const action = manifest.action as { default_icon?: Record<string, string>; default_title?: string } | undefined;
  expect(icons).toEqual({
    "16": "icons/icon16.png",
    "32": "icons/icon32.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png",
  });
  expect(action?.default_title).toBe("Open MathRead library");
  expect(action?.default_icon).toEqual(icons);
  for (const iconPath of Object.values(icons ?? {})) {
    expect(existsSync(join("dist", "extension", iconPath))).toBe(true);
  }
});

test("built extension distribution exposes reader assets without POC paths", () => {
  const manifestText = readFileSync(join("dist", "extension", "manifest.json"), "utf-8");
  const readerText = readFileSync(join("dist", "extension", "reader", "reader.js"), "utf-8");
  expect(manifestText.includes("poc")).toBe(false);
  expect(readerText.includes("POC")).toBe(false);
  expect(readerText.includes("mathread-poc")).toBe(false);
  expect(manifestText.includes("reader/*")).toBe(true);
  expect(existsSync(join("dist", "extension", "reader", "reader.html"))).toBe(true);
  expect(existsSync(join("dist", "extension", "poc"))).toBe(false);
});

function parseBuiltManifest(): {
  host_permissions?: string[];
  icons?: Record<string, string>;
  action?: unknown;
  [key: string]: unknown;
} {
  return JSON.parse(readFileSync(join("dist", "extension", "manifest.json"), "utf-8"));
}
