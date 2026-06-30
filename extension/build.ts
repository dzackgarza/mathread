import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const distExt = "dist/extension";
const mathreadBackendPermission = "http://127.0.0.1:8765/*";

type Manifest = {
  name: string;
  permissions: string[];
  host_permissions: string[];
  content_scripts: Array<{ js: string[] }>;
};

// 1. Patch manifest.json
const manifestPath = join(distExt, "manifest.json");
const manifest = parseManifest(readFileSync(manifestPath, "utf-8"));
if (!manifest.permissions.includes("cookies")) {
  manifest.permissions.push("cookies");
}
if (!manifest.host_permissions.includes(mathreadBackendPermission)) {
  manifest.host_permissions.unshift(mathreadBackendPermission);
}
delete (manifest as Record<string, unknown>).mathread;
manifest.name = "MathRead PDF Viewer";
for (const contentScript of manifest.content_scripts) {
  if (!contentScript.js.includes("mathread/link-origin.js")) {
    contentScript.js.unshift("mathread/link-origin.js");
  }
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

// 2. Patch background.js
const bgPath = join(distExt, "background.js");
let bg = readFileSync(bgPath, "utf-8");
if (!bg.includes('mathread/background.js')) {
  bg += '\nimportScripts("mathread/background.js");\n';
  writeFileSync(bgPath, bg);
}

// 3. Patch viewer.html
const viewerPath = join(distExt, "content/web/viewer.html");
let viewer = readFileSync(viewerPath, "utf-8");

if (!viewer.includes('mathread/capture-ui.js')) {
  viewer = viewer.replace(
    '</head>',
    '<script src="../../mathread/capture-ui.js" type="module"></script>\n  </head>'
  );
  
  // Add capture button next to download button
  viewer = viewer.replace(
    '<button id="downloadButton"',
    '<button id="mathreadCaptureButton" class="toolbarButton" type="button" tabindex="0" title="Checking MathRead backend" disabled>Checking</button>\n                  <button id="downloadButton"'
  );
  writeFileSync(viewerPath, viewer);
}

console.log("Build patches applied successfully.");

function parseManifest(raw: string): Manifest {
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value)) {
    throw new Error("manifest.json does not contain an object");
  }
  if (!Array.isArray(value.permissions)) {
    throw new Error("manifest.json missing permissions array");
  }
  if (!value.permissions.every(item => typeof item === "string")) {
    throw new Error("manifest.json permissions must be a string array");
  }
  if (typeof value.name !== "string") {
    throw new Error("manifest.json missing name");
  }
  if (!Array.isArray(value.host_permissions)) {
    throw new Error("manifest.json missing host_permissions array");
  }
  if (!value.host_permissions.every(item => typeof item === "string")) {
    throw new Error("manifest.json host_permissions must be a string array");
  }
  if (!Array.isArray(value.content_scripts)) {
    throw new Error("manifest.json missing content_scripts array");
  }
  for (const contentScript of value.content_scripts) {
    if (!isRecord(contentScript) || !Array.isArray(contentScript.js)) {
      throw new Error("manifest.json content_scripts entries must declare js arrays");
    }
    if (!contentScript.js.every(item => typeof item === "string")) {
      throw new Error("manifest.json content_scripts js entries must be strings");
    }
  }
  return value as Manifest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
