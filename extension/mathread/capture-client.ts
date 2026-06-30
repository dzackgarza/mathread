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

export type RuntimeCaptureResponse =
  | { ok: true; result: CaptureResult }
  | { ok: false; error: string };

export type RuntimeCaptureMessage = {
  type: "mathread:capture-url";
  request: CaptureUrlRequest;
};

export function isLikelyPdfUrl(rawUrl: string): boolean {
  return new URL(rawUrl).pathname.toLowerCase().endsWith(".pdf");
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

export function captureUrlEndpointFromManifest(manifest: {
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
  return `${backendPermission.slice(0, -2)}/capture-url`;
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
