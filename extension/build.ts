// Assemble dist/extension from repo sources only: the converged MV3 manifest, the bundled
// capture scripts (built by `bun build` before this runs), and the reader's static assets.
// The pdf.js worker must ship as a real file (loaded via chrome.runtime.getURL), so it is
// copied rather than bundled.
import { copyFileSync, cpSync, mkdirSync } from "fs";
import { join } from "path";

const distExt = "dist/extension";

copyFileSync(join("extension", "manifest.json"), join(distExt, "manifest.json"));
mkdirSync(join(distExt, "icons"), { recursive: true });
for (const size of [16, 32, 48, 128]) {
  copyFileSync(
    join("extension", "assets", "icons", `icon${size}.png`),
    join(distExt, "icons", `icon${size}.png`),
  );
}
copyFileSync(
  join("extension", "mathread", "options.html"),
  join(distExt, "mathread", "options.html"),
);
// reader.js and its pre-minified vendor ESM ship verbatim: re-bundling minified ESM
// through bun corrupts identifiers. Only backend.ts (already built to reader/vendor/backend.js
// by the bun build step) goes through the bundler.
mkdirSync(join(distExt, "reader", "vendor", "pdfjs"), { recursive: true });
for (const asset of ["library.html", "reader.html", "reader.css", "reader.js"]) {
  copyFileSync(join("extension", "reader", asset), join(distExt, "reader", asset));
}
copyFileSync(
  join("extension", "reader", "vendor", "codemirror.mjs"),
  join(distExt, "reader", "vendor", "codemirror.mjs"),
);
cpSync(
  join("extension", "reader", "vendor", "pdfjs", "chromium"),
  join(distExt, "reader", "vendor", "pdfjs", "chromium"),
  { recursive: true },
);

console.log("Extension assembled at dist/extension.");
