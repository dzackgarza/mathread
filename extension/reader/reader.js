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
  putNote,
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
  assert(launch.kind === "document", "A plain source link requires an open document");
  await navigator.clipboard.writeText(location.href);
  moreMenu.hidden = true;
});

document.querySelector('[data-action="copy-view-link"]').addEventListener("click", async () => {
  assert(launch.kind === "document", "A current view link requires an open document");
  await navigator.clipboard.writeText(location.href);
  moreMenu.hidden = true;
});

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
          if (update.docChanged) {
            queueSave();
          }
        }),
      ],
    }),
  });
  renderNotesPreview();
  notesStatus.textContent = "Saved";
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
  try {
    const saved = await putNote(launch.key, editor.state.doc.toString(), noteVersion);
    noteVersion = noteVersionFrom(saved);
    notesStatus.textContent = "Saved";
    notesError.hidden = true;
  } catch (error) {
    notesStatus.textContent = "Save failed";
    notesError.hidden = false;
    notesError.textContent = String(error);
  }
}

function renderNotesPreview() {
  if (editor === null) {
    return;
  }
  notesPreview.innerHTML = DOMPurify.sanitize(marked.parse(editor.state.doc.toString()));
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
