// Bundled by `bun build` into reader/vendor/backend.js. The reader's other vendor files
// (codemirror.mjs, pdfjs) are pre-minified ESM shipped verbatim — re-bundling them
// through bun corrupts their identifiers — so the bun-built surface is only this module:
// the typed backend client plus the markdown renderer/sanitizer pair.
import { marked as markedRenderer } from "marked";
import DOMPurifyImpl from "dompurify";
import {
  backendHealth as backendHealthImpl,
  deleteLibraryEntry as deleteLibraryEntryImpl,
  getBackendStatus as getBackendStatusImpl,
  getLibrary as getLibraryImpl,
  getNote as getNoteImpl,
  noteAssetUrl as noteAssetUrlImpl,
  openLibraryRoot as openLibraryRootImpl,
  overwriteNote as overwriteNoteImpl,
  postNoteImage as postNoteImageImpl,
  postReadEvent as postReadEventImpl,
  putNote as putNoteImpl,
  saveNote as saveNoteImpl,
} from "../mathread/portal/api";

export const marked = markedRenderer;
export const DOMPurify = DOMPurifyImpl;
export const backendHealth = backendHealthImpl;
export const deleteLibraryEntry = deleteLibraryEntryImpl;
export const getBackendStatus = getBackendStatusImpl;
export const getLibrary = getLibraryImpl;
export const getNote = getNoteImpl;
export const noteAssetUrl = noteAssetUrlImpl;
export const openLibraryRoot = openLibraryRootImpl;
export const overwriteNote = overwriteNoteImpl;
export const postNoteImage = postNoteImageImpl;
export const postReadEvent = postReadEventImpl;
export const putNote = putNoteImpl;
export const saveNote = saveNoteImpl;
