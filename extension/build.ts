// Assemble dist/extension from repo sources only: the converged MV3 manifest, the bundled
// capture scripts (built by `bun build` before this runs), and the reader's static assets.
// The pdf.js worker must ship as a real file (loaded via chrome.runtime.getURL), so it is
// copied rather than bundled.
import { copyFileSync, mkdirSync } from "fs";
import { join } from "path";

const distExt = "dist/extension";

copyFileSync(join("extension", "manifest.json"), join(distExt, "manifest.json"));

// reader.js and its pre-minified vendor ESM ship verbatim: re-bundling minified ESM
// through bun corrupts identifiers. Only backend.ts (already built to poc/vendor/backend.js
// by the bun build step) goes through the bundler.
mkdirSync(join(distExt, "poc", "vendor", "pdfjs"), { recursive: true });
for (const asset of ["reader.html", "reader.css", "reader.js"]) {
  copyFileSync(join("extension", "poc", asset), join(distExt, "poc", asset));
}
copyFileSync(
  join("extension", "poc", "vendor", "codemirror.mjs"),
  join(distExt, "poc", "vendor", "codemirror.mjs"),
);
for (const asset of ["pdf.min.mjs", "pdf.worker.min.mjs", "LICENSE"]) {
  copyFileSync(
    join("extension", "poc", "vendor", "pdfjs", asset),
    join(distExt, "poc", "vendor", "pdfjs", asset),
  );
}

console.log("Extension assembled at dist/extension.");
