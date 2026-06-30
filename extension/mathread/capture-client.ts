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

export type CaptureResponse = {
  stored_path: string;
  original_sha256: string;
  stored_sha256: string;
  pdf_url: string;
  source_url: string;
  capture: "capture-url" | "capture-bytes";
  existing: boolean;
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

export async function postCaptureUrl(
  request: CaptureUrlRequest,
  endpoint: string,
): Promise<CaptureResponse> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  invariant(
    response.ok,
    `MathRead backend rejected capture request: ${response.status} ${response.statusText}`,
  );

  const value: unknown = await response.json();
  assertCaptureResponse(value);
  return value;
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

function assertCaptureResponse(value: unknown): asserts value is CaptureResponse {
  invariant(typeof value === "object" && value !== null, "capture response must be an object");
  invariant(
    typeof (value as CaptureResponse).stored_path === "string",
    "capture response stored_path must be a string",
  );
  invariant(
    typeof (value as CaptureResponse).original_sha256 === "string",
    "capture response original_sha256 must be a string",
  );
  invariant(
    typeof (value as CaptureResponse).stored_sha256 === "string",
    "capture response stored_sha256 must be a string",
  );
  invariant(
    typeof (value as CaptureResponse).pdf_url === "string",
    "capture response pdf_url must be a string",
  );
  invariant(
    typeof (value as CaptureResponse).source_url === "string",
    "capture response source_url must be a string",
  );
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
