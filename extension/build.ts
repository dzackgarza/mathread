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
for (const asset of ["pdf-launch.html", "pdf-launch.css"]) {
  copyFileSync(join("extension", asset), join(distExt, asset));
}

// reader.js and its pre-minified vendor ESM ship verbatim: re-bundling minified ESM
// through bun corrupts identifiers. Only backend.ts (already built to reader/vendor/backend.js
// by the bun build step) goes through the bundler.
mkdirSync(join(distExt, "reader", "vendor", "pdfjs"), { recursive: true });
for (const asset of ["reader.html", "reader.css", "reader.js"]) {
  copyFileSync(join("extension", "reader", asset), join(distExt, "reader", asset));
}
copyFileSync(
  join("extension", "reader", "vendor", "codemirror.mjs"),
  join(distExt, "reader", "vendor", "codemirror.mjs"),
);
for (const asset of ["pdf.min.mjs", "pdf.worker.min.mjs", "LICENSE"]) {
  copyFileSync(
    join("extension", "reader", "vendor", "pdfjs", asset),
    join(distExt, "reader", "vendor", "pdfjs", asset),
  );
}
for (const asset of ["pdf_viewer.mjs", "pdf_viewer.css"]) {
  copyFileSync(
    join("node_modules", "pdfjs-dist", "web", asset),
    join(distExt, "reader", "vendor", "pdfjs", asset),
  );
}
cpSync(
  join("node_modules", "pdfjs-dist", "web", "images"),
  join(distExt, "reader", "vendor", "pdfjs", "images"),
  { recursive: true },
);
for (const directory of ["cmaps", "standard_fonts", "wasm"]) {
  cpSync(
    join("node_modules", "pdfjs-dist", directory),
    join(distExt, "reader", "vendor", "pdfjs", directory),
    { recursive: true },
  );
}

console.log("Extension assembled at dist/extension.");
