export type CaptureHeaders = {
  referer: string;
  cookie?: string;
};

export type CaptureUrlRequest = {
  pdf_url: string;
  source_url: string;
  title_hint?: string;
  headers?: CaptureHeaders;
};

export type CaptureResult = {
  stored_path: string;
  original_sha256: string;
  stored_sha256: string;
  pdf_url: string;
  source_url: string;
  capture: "capture-url" | "capture-bytes";
  existing: boolean;
};

export type ExtensionLocalStorage = {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};

export type PdfLinkOrigin = {
  source_url: string;
  title_hint?: string;
};

export type RuntimeCaptureResponse =
  | { ok: true; result: CaptureResult }
  | { ok: false; error: string };

export type RuntimeCaptureMessage = {
  type: "mathread:capture-url";
  request: CaptureUrlRequest;
};

export const pdfLinkOriginsStorageKey = "mathread.pdfLinkOrigins";

export function isLikelyPdfUrl(rawUrl: string): boolean {
  return new URL(rawUrl).pathname.toLowerCase().endsWith(".pdf");
}

const absoluteUrlPattern = new RegExp("^[-a-zA-Z0-9+.]+://");

export function isLikelyOriginalPdfUrl(value: string): boolean {
  return absoluteUrlPattern.test(value) || value.startsWith("file://");
}

function safeDecodeUriComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Extracts the original PDF URL from a page's location, handling both the
 * declarativeNetRequest redirect format (`?DNR:<raw-unencoded-url>`, used because DNR
 * cannot URI-encode substitutions) and the content-script fallback format
 * (`?file=<encoded-url>`), plus a bare-pathname fallback.
 */
export function pdfUrlFromLocation(search: string, pathname: string): string | undefined {
  const queryString = search.slice(1);
  return (
    pdfUrlFromFileQuery(queryString)
    ?? pdfUrlFromDnrQuery(queryString)
    ?? pdfUrlFromPathname(pathname)
  );
}

function pdfUrlFromFileQuery(queryString: string): string | undefined {
  const fileMatch = /(?:^|&)file=([^&]*)/.exec(queryString);
  const fileParam = fileMatch?.[1];
  if (fileParam !== undefined && fileParam.length > 0) {
    return originalPdfUrlOrUndefined(safeDecodeUriComponent(fileParam));
  }
  return undefined;
}

function pdfUrlFromDnrQuery(queryString: string): string | undefined {
  if (queryString.startsWith("DNR:")) {
    return originalPdfUrlOrUndefined(safeDecodeUriComponent(queryString.slice(4)));
  }
  return undefined;
}

function pdfUrlFromPathname(pathname: string): string | undefined {
  if (pathname.startsWith("/")) {
    return originalPdfUrlOrUndefined(safeDecodeUriComponent(pathname.slice(1)));
  }
  return undefined;
}

function originalPdfUrlOrUndefined(value: string): string | undefined {
  return isLikelyOriginalPdfUrl(value) ? value : undefined;
}

export function captureRequestForClickedPdfLink(
  linkHref: string,
  sourceUrl: string,
  titleHint: string,
): CaptureUrlRequest {
  return {
    pdf_url: new URL(linkHref, sourceUrl).href,
    source_url: sourceUrl,
    title_hint: titleHint,
  };
}

export function runtimeCaptureMessage(
  request: CaptureUrlRequest,
): RuntimeCaptureMessage {
  return {
    type: "mathread:capture-url",
    request,
  };
}

export async function postCaptureUrl(
  request: CaptureUrlRequest,
  endpoint: string,
): Promise<CaptureResult> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  invariant(
    response.ok,
    `MathRead backend rejected capture request: ${response.status} ${response.statusText}`,
  );
  return parseCaptureResult(await response.json());
}

export async function rememberPdfLinkOrigin(
  storage: ExtensionLocalStorage,
  request: CaptureUrlRequest,
): Promise<void> {
  const values = await storage.get([pdfLinkOriginsStorageKey]);
  const origins = parsePdfLinkOrigins(values[pdfLinkOriginsStorageKey]);
  origins[request.pdf_url] = request.title_hint === undefined
    ? { source_url: request.source_url }
    : { source_url: request.source_url, title_hint: request.title_hint };
  await storage.set({ [pdfLinkOriginsStorageKey]: origins });
}

export async function storedPdfLinkOrigin(
  storage: ExtensionLocalStorage,
  pdfUrl: string,
): Promise<PdfLinkOrigin | undefined> {
  const values = await storage.get([pdfLinkOriginsStorageKey]);
  const origins = parsePdfLinkOrigins(values[pdfLinkOriginsStorageKey]);
  return origins[pdfUrl];
}

export function backendOriginFromManifest(manifest: {
  host_permissions?: string[];
}): string {
  const hostPermissions = manifest.host_permissions;
  invariant(
    hostPermissions !== undefined,
    "extension manifest must declare localhost backend host_permissions",
  );
  const backendPermission = hostPermissions.find(permission =>
    permission.startsWith("http://127.0.0.1:"),
  );
  invariant(
    backendPermission !== undefined,
    "extension manifest must declare http://127.0.0.1 backend permission",
  );
  invariant(
    backendPermission.endsWith("/*"),
    `extension backend permission must end with /*: ${backendPermission}`,
  );
  return backendPermission.slice(0, -2);
}

export function captureUrlEndpointFromManifest(manifest: {
  host_permissions?: string[];
}): string {
  return `${backendOriginFromManifest(manifest)}/capture-url`;
}

/**
 * A PDF served from the MathRead backend's own /pdf/{key} endpoint (the shell's library
 * reopen path) is by definition already captured — capturing it again would have the
 * backend fetch its own capture route as if it were a fresh external source.
 */
export function isBackendServedPdfUrl(
  pdfUrl: string,
  manifest: { host_permissions?: string[] },
): boolean {
  return pdfUrl.startsWith(`${backendOriginFromManifest(manifest)}/pdf/`);
}

/** The library key is the stored PDF's filename (see src/mathread/library.py). */
export function libraryKeyFromStoredPath(storedPath: string): string {
  const key = storedPath.split("/").pop();
  invariant(key !== undefined && key.length > 0, `MathRead stored_path has no filename: ${storedPath}`);
  return key;
}

export function libraryKeyFromBackendPdfUrl(pdfUrl: string): string {
  const segments = new URL(pdfUrl).pathname.split("/");
  const lastSegment = segments[segments.length - 1];
  invariant(
    lastSegment !== undefined && lastSegment.length > 0,
    `MathRead backend PDF URL has no key: ${pdfUrl}`,
  );
  return decodeURIComponent(lastSegment);
}

export function parseRuntimeCaptureResponse(value: unknown): RuntimeCaptureResponse {
  invariant(isRecord(value), "MathRead capture response must be an object");
  if (value.ok === true) {
    return { ok: true, result: parseCaptureResult(value.result) };
  }
  invariant(value.ok === false, "MathRead capture response must declare ok");
  invariant(typeof value.error === "string", "MathRead capture failure response must declare error");
  return { ok: false, error: value.error };
}

function parsePdfLinkOrigins(value: unknown): Record<string, PdfLinkOrigin> {
  if (value === undefined) {
    return {};
  }
  invariant(isRecord(value), "MathRead PDF link origins must be an object");
  const origins: Record<string, PdfLinkOrigin> = {};
  for (const [pdfUrl, origin] of Object.entries(value)) {
    invariant(typeof pdfUrl === "string", "MathRead PDF link origin key must be a string");
    invariant(isRecord(origin), `MathRead PDF link origin must be an object: ${pdfUrl}`);
    invariant(typeof origin.source_url === "string", `MathRead PDF link origin must declare source_url: ${pdfUrl}`);
    invariant(
      typeof origin.title_hint === "undefined" || typeof origin.title_hint === "string",
      `MathRead PDF link origin title_hint must be a string when present: ${pdfUrl}`,
    );
    origins[pdfUrl] = origin.title_hint === undefined
      ? { source_url: origin.source_url }
      : { source_url: origin.source_url, title_hint: origin.title_hint };
  }
  return origins;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function parseCaptureResult(value: unknown): CaptureResult {
  invariant(isRecord(value), "MathRead backend capture response must be an object");
  const capture = value.capture;
  invariant(
    capture === "capture-url" || capture === "capture-bytes",
    "MathRead backend capture response must declare a valid capture mode",
  );
  invariant(
    typeof value.stored_path === "string",
    "MathRead backend capture response must declare stored_path",
  );
  invariant(
    typeof value.original_sha256 === "string",
    "MathRead backend capture response must declare original_sha256",
  );
  invariant(
    typeof value.stored_sha256 === "string",
    "MathRead backend capture response must declare stored_sha256",
  );
  invariant(
    typeof value.pdf_url === "string",
    "MathRead backend capture response must declare pdf_url",
  );
  invariant(
    typeof value.source_url === "string",
    "MathRead backend capture response must declare source_url",
  );
  invariant(
    typeof value.existing === "boolean",
    "MathRead backend capture response must declare existing",
  );
  return {
    stored_path: value.stored_path,
    original_sha256: value.original_sha256,
    stored_sha256: value.stored_sha256,
    pdf_url: value.pdf_url,
    source_url: value.source_url,
    capture,
    existing: value.existing,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
