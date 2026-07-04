import { spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "fs";
import { join, relative } from "path";

type Manifest = {
  manifest_version?: number;
  name?: string;
  version?: string;
  description?: string;
  icons?: Record<string, string>;
  action?: {
    default_icon?: Record<string, string>;
    default_title?: string;
  };
};

const extensionRoot = join("dist", "extension");
const packageRoot = join("dist", "webstore");
const manifestPath = join(extensionRoot, "manifest.json");
const iconSizes = ["16", "32", "48", "128"] as const;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function allFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      return allFiles(path);
    }
    if (entry.isFile()) {
      return [path];
    }
    return [];
  });
}

function parseManifest(): Manifest {
  invariant(existsSync(manifestPath), `missing built manifest at ${manifestPath}`);
  return JSON.parse(readFileSync(manifestPath, "utf-8")) as Manifest;
}

function validateManifest(manifest: Manifest): void {
  invariant(manifest.manifest_version === 3, "Chrome Web Store package must be Manifest V3");
  invariant(typeof manifest.name === "string" && manifest.name.length > 0, "manifest must declare name");
  invariant(typeof manifest.version === "string" && manifest.version.length > 0, "manifest must declare version");
  invariant(
    typeof manifest.description === "string" && manifest.description.length > 0 && manifest.description.length <= 132,
    "manifest description must be present and at most 132 characters",
  );
  invariant(manifest.icons !== undefined, "manifest must declare Web Store icons");
  invariant(manifest.action?.default_icon !== undefined, "manifest action must declare toolbar icons");
  invariant(typeof manifest.action.default_title === "string", "manifest action must declare a default title");

  for (const size of iconSizes) {
    const iconPath = manifest.icons[size];
    const actionIconPath = manifest.action.default_icon[size];
    invariant(iconPath === `icons/icon${size}.png`, `manifest icon ${size} must use packaged PNG asset`);
    invariant(actionIconPath === iconPath, `action icon ${size} must match packaged manifest icon`);
    invariant(existsSync(join(extensionRoot, iconPath)), `missing packaged icon ${iconPath}`);
  }
}

function validatePackageFiles(files: string[]): void {
  invariant(files.some(file => relative(extensionRoot, file) === "manifest.json"), "zip input must contain root manifest.json");
  for (const file of files) {
    const packagedPath = relative(extensionRoot, file);
    invariant(!packagedPath.startsWith("poc/"), `distribution package must not ship POC path: ${packagedPath}`);
    invariant(!packagedPath.endsWith(".ts"), `distribution package must not ship TypeScript source: ${packagedPath}`);
    invariant(!packagedPath.endsWith(".tsx"), `distribution package must not ship TSX source: ${packagedPath}`);
    invariant(!packagedPath.endsWith(".map"), `distribution package must not ship source maps: ${packagedPath}`);
    invariant(!packagedPath.startsWith("node_modules/"), `distribution package must not ship node_modules: ${packagedPath}`);
  }
}

function validateNoRemoteExecutableCode(files: string[]): void {
  for (const file of files) {
    if (!/\.(html|js|mjs)$/u.test(file)) {
      continue;
    }
    const text = readFileSync(file, "utf-8");
    invariant(!/<script\b[^>]+src=["']https?:\/\//iu.test(text), `${file} loads a remote script`);
    invariant(!/\bimport\s*\(\s*["']https?:\/\//u.test(text), `${file} dynamically imports remote code`);
  }
}

function validateNoInternalDistributionResidue(files: string[]): void {
  for (const file of files) {
    const packagedPath = relative(extensionRoot, file);
    if (packagedPath.startsWith("reader/vendor/") || !/\.(css|html|js|json)$/u.test(packagedPath)) {
      continue;
    }
    const text = readFileSync(file, "utf-8");
    invariant(!/\bPOC\b|mathread-poc|~\/|Pictures\/Screenshots/u.test(text), `${packagedPath} contains internal distribution residue`);
  }
}

function createZip(manifest: Manifest, files: string[]): void {
  mkdirSync(packageRoot, { recursive: true });
  const zipName = `mathread-pdf-viewer-${manifest.version}.zip`;
  const zipPath = join(packageRoot, zipName);
  if (existsSync(zipPath)) {
    rmSync(zipPath);
  }

  const zipInput = files.map(file => relative(extensionRoot, file)).sort();
  const zip = spawnSync("zip", ["-X", "-q", join("..", "webstore", zipName), ...zipInput], {
    cwd: extensionRoot,
    encoding: "utf-8",
  });
  invariant(zip.error === undefined, `zip failed to start: ${zip.error?.message}`);
  invariant(zip.status === 0, `zip failed: ${zip.stderr}`);
  invariant(existsSync(zipPath), `zip did not create ${zipPath}`);
  invariant(statSync(zipPath).size > 0, `zip created empty artifact at ${zipPath}`);
  console.log(`Chrome Web Store package ready: ${zipPath}`);
}

const manifest = parseManifest();
const files = allFiles(extensionRoot);
validateManifest(manifest);
validatePackageFiles(files);
validateNoRemoteExecutableCode(files);
validateNoInternalDistributionResidue(files);
createZip(manifest, files);
