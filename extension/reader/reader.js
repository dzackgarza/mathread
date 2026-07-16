import {
  DOMPurify,
  deleteLibraryEntry,
  getBackendStatus,
  getLibrary,
  getNote,
  marked,
  openLibraryRoot,
  overwriteNote,
  postReadEvent,
  saveNote,
} from "./vendor/backend.js";
import {
  defaultHighlightStyle,
  defaultKeymap,
  EditorState,
  EditorView,
  highlightActiveLine,
  history,
  historyKeymap,
  keymap,
  lineNumbers,
  markdown,
  syntaxHighlighting,
} from "./vendor/codemirror.mjs";
import { upsertAnnotation } from "./annotations.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parseLaunch(params) {
  const file = params.get("file");
  if (file === null) {
    // Inside a frame with no file parameter, the reader is the takeover
    // surface (#40): the parent page at the source URL streams the PDF in.
    return window.parent === window ? { kind: "library" } : { kind: "takeover" };
  }
  throw new Error(
    "MathRead no longer reads backend copies at reader URLs; navigate to the PDF's source URL instead.",
  );
}

const launch = parseLaunch(new URLSearchParams(location.search));

if (launch.kind === "library") {
  document.body.classList.add("mathread-library-mode");
}

const overlay = document.getElementById("mathread-overlay");
const panel = document.getElementById("mathread-panel");
const libraryPanel = document.getElementById("library-list");
const notesPanel = document.getElementById("notes-panel");
const notesStatus = document.getElementById("notes-status");
const notesPath = document.getElementById("notes-path");
const notesPreview = document.getElementById("notes-preview");
const notesError = document.getElementById("notes-error");
const editorHost = document.getElementById("ai-editor");
const moreMenu = document.getElementById("more-menu");

assert(overlay instanceof HTMLElement, "MathRead overlay is missing");
assert(panel instanceof HTMLElement, "MathRead overlay panel is missing");
assert(libraryPanel instanceof HTMLElement, "MathRead library panel is missing");
assert(notesPanel instanceof HTMLElement, "MathRead notes panel is missing");
assert(notesStatus instanceof HTMLElement, "MathRead notes status is missing");
assert(notesPath instanceof HTMLElement, "MathRead notes path is missing");
assert(notesPreview instanceof HTMLElement, "MathRead notes preview is missing");
assert(notesError instanceof HTMLElement, "MathRead notes error is missing");
assert(editorHost instanceof HTMLElement, "MathRead notes editor is missing");
assert(moreMenu instanceof HTMLElement, "MathRead actions menu is missing");

let editor = null;
let noteVersion;
let saveTimer = null;
let replacingEditorText = false;
let pendingLegacyMigrationStorageKey = null;
let pdfViewerState = { kind: "awaiting" };
let currentPdfViewState = { kind: "awaiting" };
let takeoverDocument = null;
let resolvePdfApplication;
const pdfApplicationReady = new Promise((resolve) => {
  resolvePdfApplication = resolve;
});

function documentKey() {
  assert(
    launch.kind === "takeover" && takeoverDocument !== null,
    "MathRead document key requires an open document",
  );
  return takeoverDocument.key;
}

if (launch.kind !== "library") {
  document.addEventListener("DOMContentLoaded", waitForPdfViewer, { once: true });
}

if (launch.kind === "takeover") {
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) {
      return;
    }
    const data = event.data;
    if (data === null || typeof data !== "object" || data.type !== "mathread:pdf") {
      return;
    }
    assert(takeoverDocument === null, "MathRead takeover received a second document");
    assert(data.body instanceof ArrayBuffer, "MathRead takeover message has no PDF bytes");
    assert(typeof data.key === "string" && data.key.length > 0, "MathRead takeover message has no library key");
    assert(typeof data.sourceUrl === "string" && data.sourceUrl.length > 0, "MathRead takeover message has no source URL");
    takeoverDocument = { key: data.key, sourceUrl: data.sourceUrl };
    void openTakeoverDocument(data.body);
  });
  window.parent.postMessage({ type: "mathread:ready" }, "*");
}

async function openTakeoverDocument(body) {
  const application = await pdfApplicationReady;
  await application.open({ data: new Uint8Array(body) });
  void postReadEvent(documentKey());
}

// PDF.js's Chromium viewer rewrites the visible URL to a synthetic extension-path
// form that only resolves while the extension service worker can be woken to
// route it. The reader document URL is a real file, so restoring it keeps reload
// and history traversal working in every worker state. reader.js evaluates before
// viewer.mjs, so this listener fires after the viewer's rewrite has happened.
document.addEventListener("DOMContentLoaded", restoreCanonicalReaderUrl, { once: true });

function restoreCanonicalReaderUrl() {
  const canonical = new URL(chrome.runtime.getURL("reader/reader.html"));
  // window-qualified: the CodeMirror `history` import shadows the global.
  window.history.replaceState(
    window.history.state,
    "",
    `${canonical.href}${location.hash}`,
  );
}

function waitForPdfViewer() {
  const application = window.PDFViewerApplication;
  assert(application !== null && typeof application === "object", "PDF.js application is unavailable");
  const initialized = application.initializedPromise;
  assert(initialized !== null && typeof initialized === "object" && typeof initialized.then === "function", "PDF.js initialization is unavailable");
  void initialized.then(() => observePdfView(application));
}

function observePdfView(application) {
  const eventBus = application.eventBus;
  const pdfViewer = application.pdfViewer;
  assert(eventBus !== null && typeof eventBus === "object" && typeof eventBus.on === "function", "PDF.js view event bus is unavailable");
  assert(pdfViewer !== null && typeof pdfViewer === "object" && typeof pdfViewer.update === "function", "PDF.js viewer is unavailable");
  pdfViewerState = { kind: "ready", pdfViewer };
  eventBus.on("updateviewarea", ({ location }) => {
    currentPdfViewState = parsePdfView(location);
    if (launch.kind === "takeover" && currentPdfViewState.kind === "available") {
      // Publish the view as a standard open-parameters fragment; the parent
      // mirrors it onto the source URL's hash, which stays the one canonical
      // view state a copied link or a reload picks up.
      const view = currentPdfViewState;
      window.parent.postMessage({
        type: "mathread:view",
        hash: `#page=${view.page}&zoom=${Math.round(view.zoom * 100)},${view.x},${view.y}`,
      }, "*");
    }
  });
  resolvePdfApplication(application);
}

function parsePdfView(location) {
  assert(location !== null && typeof location === "object", "PDF.js view update has no location");
  const { pageNumber, scale, left, top } = location;
  assert(Number.isInteger(pageNumber) && pageNumber >= 0, "PDF.js view page must be nonnegative");
  if (
    pageNumber === 0
    || typeof scale !== "number"
    || !Number.isFinite(scale)
    || scale === 0
  ) {
    return { kind: "awaiting" };
  }
  assert(pageNumber >= 1, "PDF.js view page must be positive");
  assert(scale > 0, "PDF.js view zoom must be positive");
  assert(Number.isFinite(left) && Number.isFinite(top), "PDF.js view coordinates must be finite");
  return {
    kind: "available",
    page: pageNumber,
    zoom: scale / 100,
    x: Math.round(left),
    y: Math.round(top),
  };
}

function selectOverlay(name) {
  panel.dataset.panel = name;
  libraryPanel.hidden = name !== "library";
  notesPanel.hidden = name !== "notes";
  if (name === "library") {
    void renderLibrary();
  } else if (launch.kind !== "library") {
    void ensureNotes();
  }
}

function noteVersionFrom(note) {
  assert(typeof note.version === "string", "MathRead note response must declare a version");
  return note.version;
}

for (const button of document.querySelectorAll(".nav-expand-btn")) {
  button.addEventListener("click", () => selectOverlay(button.dataset.tab));
}

if (launch.kind === "library") {
  selectOverlay("library");
}

document.getElementById("mathread-close-panel").addEventListener("click", () => {
  panel.dataset.panel = "closed";
});

document.getElementById("toggle-more").addEventListener("click", () => {
  moreMenu.hidden = !moreMenu.hidden;
});

document.querySelector('[data-action="copy-plain-link"]').addEventListener("click", async () => {
  const source = await sourceUrl();
  await navigator.clipboard.writeText(source.href);
  moreMenu.hidden = true;
});

document.querySelector('[data-action="copy-view-link"]').addEventListener("click", async () => {
  const source = await sourceUrl();
  const view = currentPdfView();
  // Standard PDF open-parameters fragment: any viewer, including Chrome's
  // native one and PDF.js, lands on the right page without MathRead.
  source.hash = `page=${view.page}&zoom=${Math.round(view.zoom * 100)},${view.x},${view.y}`;
  await navigator.clipboard.writeText(source.href);
  moreMenu.hidden = true;
});

async function sourceUrl() {
  assert(
    launch.kind === "takeover" && takeoverDocument !== null,
    "A source link requires an open document",
  );
  return new URL(takeoverDocument.sourceUrl);
}

function currentPdfView() {
  switch (pdfViewerState.kind) {
    case "awaiting":
      throw new Error("PDF.js viewer has not initialized");
    case "ready":
      pdfViewerState.pdfViewer.update();
      break;
  }
  switch (currentPdfViewState.kind) {
    case "available":
      return currentPdfViewState;
    case "awaiting":
      throw new Error("PDF.js has not published a current view");
  }
}

async function renderLibrary() {
  const [status, entries] = await Promise.all([getBackendStatus(), getLibrary()]);
  libraryPanel.replaceChildren();
  const openRoot = document.createElement("button");
  openRoot.dataset.testid = "library-open-root";
  openRoot.textContent = "Open library folder";
  openRoot.disabled = !status.capabilities.open_root;
  openRoot.addEventListener("click", () => void openLibraryRoot());
  libraryPanel.append(openRoot);
  for (const entry of entries) {
    const item = document.createElement("article");
    item.className = "library-entry";
    item.dataset.testid = "library-entry";
    const open = document.createElement("button");
    open.className = "library-entry-open";
    open.dataset.testid = "library-entry-open";
    open.textContent = entry.title;
    open.addEventListener("click", () => {
      location.assign(entry.source_url);
    });
    const meta = document.createElement("span");
    meta.className = "library-entry-meta";
    meta.textContent = entry.has_note ? "📝" : "No notes";
    const trash = document.createElement("button");
    trash.className = "library-entry-trash";
    trash.dataset.testid = "library-entry-trash";
    trash.textContent = "Trash";
    trash.addEventListener("click", async () => {
      if (!confirm(`Trash ${entry.title}?`)) {
        return;
      }
      await deleteLibraryEntry(entry.key);
      await renderLibrary();
    });
    item.append(open, meta, trash);
    libraryPanel.append(item);
  }
}

async function ensureNotes() {
  if (
    editor !== null
    || launch.kind === "library"
    || (launch.kind === "takeover" && takeoverDocument === null)
  ) {
    return;
  }
  const note = await getNote(documentKey());
  noteVersion = noteVersionFrom(note);
  notesPath.textContent = documentKey().replace(/\.pdf$/, ".md");
  editor = new EditorView({
    parent: editorHost,
    state: EditorState.create({
      doc: note.text,
      extensions: [
        lineNumbers(),
        history(),
        highlightActiveLine(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown(),
        syntaxHighlighting(defaultHighlightStyle),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !replacingEditorText) {
            queueSave();
          }
        }),
      ],
    }),
  });
  renderNotesPreview();
  notesStatus.textContent = "Saved";
  migrateLegacyHighlights();
}

function queueSave() {
  assert(editor !== null, "MathRead note editor must exist before saving");
  notesStatus.textContent = "Saving…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void saveNotes(), 800);
  renderNotesPreview();
}

async function saveNotes() {
  assert(launch.kind !== "library", "Saving notes requires an open document");
  assert(editor !== null, "MathRead note editor must exist before saving");
  assert(typeof noteVersion === "string", "MathRead note version must be loaded before saving");
  const result = await saveNote(documentKey(), editor.state.doc.toString(), noteVersion);
  switch (result.kind) {
    case "saved":
      noteVersion = noteVersionFrom(result.note);
      if (pendingLegacyMigrationStorageKey !== null) {
        localStorage.removeItem(pendingLegacyMigrationStorageKey);
        pendingLegacyMigrationStorageKey = null;
      }
      notesStatus.textContent = "Saved";
      notesError.hidden = true;
      return;
    case "conflict":
      notesStatus.textContent = "Save failed: conflict";
      showNotesConflict(result.message);
      return;
    case "unavailable":
      notesStatus.textContent = "Save failed: backend unavailable";
      notesError.hidden = false;
      notesError.textContent = result.message;
      return;
  }
}

function replaceEditorText(text) {
  assert(editor !== null, "MathRead note editor must exist before replacing its text");
  replacingEditorText = true;
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text } });
  replacingEditorText = false;
  renderNotesPreview();
}

function showNotesConflict(message) {
  notesError.hidden = false;
  notesError.replaceChildren(message);
  const load = document.createElement("button");
  load.type = "button";
  load.textContent = "Load from Disk";
  load.addEventListener("click", () => void loadNotesFromDisk());
  const overwrite = document.createElement("button");
  overwrite.type = "button";
  overwrite.textContent = "Overwrite Disk";
  overwrite.addEventListener("click", () => void overwriteNotesOnDisk());
  notesError.append(" ", load, " ", overwrite);
}

async function loadNotesFromDisk() {
  assert(launch.kind !== "library", "Loading notes requires an open document");
  const note = await getNote(documentKey());
  noteVersion = noteVersionFrom(note);
  replaceEditorText(note.text);
  notesStatus.textContent = "Saved";
  notesError.hidden = true;
}

async function overwriteNotesOnDisk() {
  assert(launch.kind !== "library", "Overwriting notes requires an open document");
  assert(editor !== null, "MathRead note editor must exist before overwriting");
  const note = await overwriteNote(documentKey(), editor.state.doc.toString());
  noteVersion = noteVersionFrom(note);
  notesStatus.textContent = "Saved";
  notesError.hidden = true;
}

function renderNotesPreview() {
  if (editor === null) {
    return;
  }
  notesPreview.innerHTML = DOMPurify.sanitize(marked.parse(editor.state.doc.toString()));
}

function migrateLegacyHighlights() {
  assert(launch.kind !== "library", "Legacy annotation migration requires an open document");
  assert(editor !== null, "Legacy annotation migration requires the note editor");
  const storageKey = `mathread-legacy-highlights:${documentKey()}`;
  const raw = localStorage.getItem(storageKey);
  if (raw === null) {
    return;
  }
  const result = parseLegacyHighlights(raw);
  if (result.kind === "invalid") {
    notesError.hidden = false;
    notesError.textContent = "Legacy highlights were not migrated because their saved shape is invalid.";
    return;
  }
  const current = editor.state.doc.toString();
  const migrated = result.annotations.reduce(
    (text, annotation) => upsertAnnotation(text, annotation),
    current,
  );
  if (migrated === current) {
    return;
  }
  replaceEditorText(migrated);
  pendingLegacyMigrationStorageKey = storageKey;
  notesStatus.textContent = "Unsaved changes";
}

function parseLegacyHighlights(raw) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return { kind: "invalid" };
  }
  if (!Array.isArray(value)) {
    return { kind: "invalid" };
  }
  const annotations = [];
  for (const candidate of value) {
    const annotation = parseLegacyHighlight(candidate);
    if (annotation.kind === "invalid") {
      return annotation;
    }
    annotations.push(annotation.annotation);
  }
  return { kind: "valid", annotations };
}

function parseLegacyHighlight(value) {
  if (typeof value !== "object" || value === null) {
    return { kind: "invalid" };
  }
  const candidate = value;
  if (
    typeof candidate.id !== "string"
    || !Number.isInteger(candidate.pageNumber)
    || candidate.pageNumber < 1
    || typeof candidate.color !== "string"
    || typeof candidate.createdAt !== "string"
    || !Array.isArray(candidate.rects)
    || typeof candidate.text !== "string"
    || typeof candidate.comment !== "string"
  ) {
    return { kind: "invalid" };
  }
  const created = new Date(candidate.createdAt);
  if (!Number.isFinite(created.getTime())) {
    return { kind: "invalid" };
  }
  const rects = [];
  for (const legacyRect of candidate.rects) {
    const rect = parseLegacyRect(legacyRect);
    if (rect.kind === "invalid") {
      return rect;
    }
    rects.push(rect.rect);
  }
  return {
    kind: "valid",
    annotation: {
      id: candidate.id,
      pageNumber: candidate.pageNumber,
      color: candidate.color,
      created: created.toISOString(),
      rects,
      text: candidate.text,
      comment: candidate.comment,
    },
  };
}

function parseLegacyRect(value) {
  if (typeof value !== "object" || value === null) {
    return { kind: "invalid" };
  }
  const { xPct, yPct, wPct, hPct } = value;
  if (
    !Number.isFinite(xPct)
    || !Number.isFinite(yPct)
    || !Number.isFinite(wPct)
    || !Number.isFinite(hPct)
  ) {
    return { kind: "invalid" };
  }
  return { kind: "valid", rect: { xPct, yPct, wPct, hPct } };
}

document.getElementById("notes-save").addEventListener("click", () => void saveNotes());
document.getElementById("notes-mode-preview").addEventListener("click", () => {
  notesPreview.hidden = !notesPreview.hidden;
});

if (launch.kind === "document") {
  void postReadEvent(launch.key);
  document.title = `MathRead — ${launch.key}`;
} else {
  selectOverlay("library");
}
