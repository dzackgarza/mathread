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
): Promise<void> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  invariant(
    response.ok,
    `MathRead backend rejected capture request: ${response.status} ${response.statusText}`,
  );
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
