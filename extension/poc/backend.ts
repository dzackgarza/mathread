// Bundled by `bun build` into poc/vendor/backend.js. The reader's other vendor files
// (codemirror.mjs, pdfjs) are pre-minified ESM shipped verbatim — re-bundling them
// through bun corrupts their identifiers — so the bun-built surface is only this module:
// the typed backend client plus the markdown renderer/sanitizer pair.
export { marked } from "marked";
export { default as DOMPurify } from "dompurify";
export {
  deleteLibraryEntry,
  getLibrary,
  getNote,
  pdfUrl,
  postNoteImage,
  postReadEvent,
  putNote,
} from "../mathread/portal/api";
