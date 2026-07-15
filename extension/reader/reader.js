import {
  DOMPurify,
  deleteLibraryEntry,
  getBackendStatus,
  getLibrary,
  getNote,
  marked,
  openLibraryRoot,
  overwriteNote,
  pdfUrl as backendPdfUrl,
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
  const key = params.get("key");
  if (key === null) {
    return { kind: "library" };
  }
  assert(key.length > 0, "MathRead reader key must not be empty");
  assert(!key.includes("/"), "MathRead reader key must be a library filename");
  return { kind: "document", key, view: parseInitialView(params) };
}

function parseInitialView(params) {
  const serialized = params.get("mathread-view");
  if (serialized !== null) {
    const fields = serialized.split(":");
    assert(fields.length === 5 && fields[0] === "v1", "MathRead reader view state is invalid");
    return parseViewFields(fields[1], fields[2], fields[3], fields[4]);
  }
  const page = params.get("page");
  const zoom = params.get("zoom");
  if (page === null && zoom === null) {
    return null;
  }
  assert(page !== null && zoom !== null, "MathRead reader view state requires page and zoom");
  return parseViewFields(page, null, null, zoom);
}

function parseViewFields(pageText, xText, yText, zoomText) {
  const page = Number(pageText);
  const zoom = Number(zoomText);
  assert(Number.isInteger(page) && page >= 1, "MathRead reader view state requires a positive page");
  assert(Number.isFinite(zoom) && zoom > 0, "MathRead reader view state requires a positive zoom");
  if (xText === null || yText === null) {
    return { page, zoom, x: null, y: null };
  }
  const x = Number(xText);
  const y = Number(yText);
  assert(Number.isFinite(x) && Number.isFinite(y), "MathRead reader viewport must be finite");
  return { page, zoom, x, y };
}

function hashForView(view) {
  const percent = Math.round(view.zoom * 100);
  const zoom = view.x === null ? `${percent}` : `${percent},${view.x},${view.y}`;
  return `page=${view.page}&zoom=${zoom}`;
}

const launch = parseLaunch(new URLSearchParams(location.search));

document.addEventListener("webviewerloaded", () => {
  if (launch.kind === "library") {
    document.body.classList.add("mathread-library-mode");
    return;
  }
  window.PDFViewerApplicationOptions.set("defaultUrl", backendPdfUrl(launch.key));
  if (launch.view !== null) {
    location.hash = hashForView(launch.view);
  }
});

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
const documentEntry = launch.kind === "document"
  ? getLibrary().then((entries) => {
    const entry = entries.find((candidate) => candidate.key === launch.key);
    assert(entry !== undefined, `MathRead library entry is missing for ${launch.key}`);
    assert(typeof entry.source_url === "string", `MathRead source URL is missing for ${launch.key}`);
    return entry;
  })
  : null;

function selectOverlay(name) {
  panel.dataset.panel = name;
  libraryPanel.hidden = name !== "library";
  notesPanel.hidden = name !== "notes";
  if (name === "library") {
    void renderLibrary();
  } else if (launch.kind === "document") {
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
  const sourceHref = source.href;
  source.searchParams.append("mathread-link", `v1.${btoa(`v1:${view.page}:${view.x}:${view.y}:${view.zoom.toFixed(2)}`)}`);
  source.searchParams.append("mathread-source", `v1.${btoa(sourceHref)}`);
  await navigator.clipboard.writeText(source.href);
  moreMenu.hidden = true;
});

async function sourceUrl() {
  assert(launch.kind === "document", "A source link requires an open document");
  assert(documentEntry !== null, "MathRead document entry must be loading");
  const entry = await documentEntry;
  return new URL(entry.source_url);
}

function currentPdfView() {
  const state = new URLSearchParams(location.hash.slice(1));
  const page = Number(state.get("page"));
  const zoomParts = state.get("zoom")?.split(",");
  assert(Number.isInteger(page) && page >= 1, "PDF.js did not publish a valid current page");
  assert(zoomParts !== undefined, "PDF.js did not publish a current zoom");
  const zoom = Number(zoomParts[0]);
  assert(Number.isFinite(zoom) && zoom > 0, "PDF.js current zoom must be numeric to create a view link");
  const x = zoomParts[1] === undefined ? 0 : Number(zoomParts[1]);
  const y = zoomParts[2] === undefined ? 0 : Number(zoomParts[2]);
  assert(Number.isFinite(x) && Number.isFinite(y), "PDF.js current viewport must be finite");
  return { page, zoom: zoom / 100, x: Math.round(x), y: Math.round(y) };
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
      location.assign(`reader.html?key=${encodeURIComponent(entry.key)}`);
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
  if (editor !== null || launch.kind !== "document") {
    return;
  }
  const note = await getNote(launch.key);
  noteVersion = noteVersionFrom(note);
  notesPath.textContent = launch.key.replace(/\.pdf$/, ".md");
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
  assert(launch.kind === "document", "Saving notes requires an open document");
  assert(editor !== null, "MathRead note editor must exist before saving");
  assert(typeof noteVersion === "string", "MathRead note version must be loaded before saving");
  const result = await saveNote(launch.key, editor.state.doc.toString(), noteVersion);
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
  assert(launch.kind === "document", "Loading notes requires an open document");
  const note = await getNote(launch.key);
  noteVersion = noteVersionFrom(note);
  replaceEditorText(note.text);
  notesStatus.textContent = "Saved";
  notesError.hidden = true;
}

async function overwriteNotesOnDisk() {
  assert(launch.kind === "document", "Overwriting notes requires an open document");
  assert(editor !== null, "MathRead note editor must exist before overwriting");
  const note = await overwriteNote(launch.key, editor.state.doc.toString());
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
  assert(launch.kind === "document", "Legacy annotation migration requires an open document");
  assert(editor !== null, "Legacy annotation migration requires the note editor");
  const storageKey = `mathread-legacy-highlights:${launch.key}`;
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
