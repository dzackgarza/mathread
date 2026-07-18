/**
 * Minimal chrome extension-host shim for unit tests that import modules reading
 * the manifest at load time (portal/api.ts derives the backend origin from
 * host_permissions). This provisions the host environment the way register-dom
 * provisions the DOM; it stands in for no behavior under test. Import it before
 * any overlay/backend module (api.ts reads chrome at module evaluation).
 */
Reflect.set(globalThis, "chrome", {
  runtime: {
    getManifest: () => ({ host_permissions: ["http://127.0.0.1:8765/*"] }),
  },
});

export {};
