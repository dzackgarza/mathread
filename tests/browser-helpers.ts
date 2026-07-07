import { execSync } from "node:child_process";

/**
 * Resolves the system Chromium executable path for Playwright extension tests.
 *
 * Playwright's default headless shell (`chrome-headless-shell`) disables
 * extensions, which makes it unusable for testing MV3 service workers. The
 * full Chromium build supports extensions in headless mode. This resolves the
 * real Chromium binary on PATH at test runtime — no hard-coded path.
 */
export function chromiumExecutablePath(): string {
  return execSync("which chromium", {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}
