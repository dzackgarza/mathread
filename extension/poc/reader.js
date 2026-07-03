// ponytail: all pages render upfront, one full re-render per zoom/rotate step;
// highlights stay in localStorage keyed by library key (separate concern from notes).
import { getDocument, GlobalWorkerOptions, TextLayer } from "./vendor/pdfjs/pdf.min.mjs";
import {
  DOMPurify,
  deleteLibraryEntry,
  getLibrary,
  getNote,
  marked,
  pdfUrl as backendPdfUrl,
  postReadEvent,
  putNote,
} from "./vendor/backend.js";
import {
  EditorState,
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  placeholder,
  defaultKeymap,
  history,
  historyKeymap,
  markdown,
  syntaxHighlighting,
  defaultHighlightStyle,
} from "./vendor/codemirror.mjs";

GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("poc/vendor/pdfjs/pdf.worker.min.mjs");

// The reader is keyed by the backend library key (the stored PDF filename). The PDF
// bytes come from GET /pdf/{key}; provenance (original pdf_url, title) comes from the
// library entry. Without a key the reader is a library browser only.
const libraryKey = new URLSearchParams(location.search).get("key");
const storageKey = `mathread-poc-highlights:${libraryKey}`;

const $ = id => document.getElementById(id);
const viewerEl = $("viewer");
const sidebarEl = $("sidebar");
const sidebarListEl = $("highlight-list");
const navEl = $("nav");
const bodyEl = document.querySelector(".body");
const navRailEl = $("nav-rail");
const navAdjusterEl = $("nav-adjuster");
const outlineListEl = $("outline-list");
const aiEditorEl = $("ai-editor");
const pagesListEl = $("pages-list");
const pageInputEl = $("page-input");
const pageTotalEl = $("page-total");
const docTitleEl = $("doc-title");
const popupEl = $("selection-popup");
const zoomLevelEl = $("zoom-level");
const moreMenuEl = $("more-menu");
const citeDialogEl = $("cite-dialog");
const citeBodyEl = $("cite-body");
const scholarMenuEl = $("scholar-menu");
const scholarMenuBtn = $("scholar-menu-btn");
const searchBarEl = $("search-bar");
const searchInputEl = $("search-input");
const searchCountEl = $("search-count");
const libraryListEl = $("library-list");
const notesStatusEl = $("notes-status");
const notesPreviewEl = $("notes-preview");
const notesErrorEl = $("notes-error");
const notesSaveBtn = $("notes-save");
const notesModeEditBtn = $("notes-mode-edit");
const notesModePreviewBtn = $("notes-mode-preview");

let highlights = loadHighlights();
let scale = 1.25;
let rotation = 0;
let pdfDoc = null;
let pdfData = null;
let libraryEntry = null;
let pdfUrl = null; // original provenance URL (Scholar lookup, document properties)
// Editor state machine: loading → clean ⇄ dirty → saving → clean | error.
let noteState = { kind: "loading" };
let noteSaveTimer = null;
let notesInitialized = false;
let notesPreviewVisible = false;
let readEventTimer = null;
let pageContainers = [];
let currentPageNumber = 1;
let intersectionObserver = null;
let paperTitle = "";
let citeLoaded = false;
let aiView = null;
let thumbsBuilt = false;
let searchMatches = [];
let searchIndex = -1;

// ---------- Toolbar wiring ----------
$("prev-page").addEventListener("click", () => jumpPage(-1));
$("next-page").addEventListener("click", () => jumpPage(1));
$("zoom-in").addEventListener("click", () => rerender(scale + 0.15));
$("zoom-out").addEventListener("click", () => rerender(Math.max(0.4, scale - 0.15)));
$("fit-width").addEventListener("click", fitWidth);
$("rotate").addEventListener("click", () => {
  rotation = (rotation + 90) % 360;
  rerender(scale);
});
$("toggle-sidebar").addEventListener("click", () => toggleSidebar());
$("close-sidebar").addEventListener("click", () => toggleSidebar(false));
$("download").addEventListener("click", downloadPdf);
$("print").addEventListener("click", () => window.print());

$("cite").addEventListener("click", () => toggleCiteDialog());
scholarMenuBtn.addEventListener("click", () => toggleScholarMenu());

// ---------- Search ----------
$("search-toggle").addEventListener("click", () => toggleSearch());
$("search-close").addEventListener("click", () => toggleSearch(false));
$("search-next").addEventListener("click", () => stepSearch(1));
$("search-prev").addEventListener("click", () => stepSearch(-1));
searchInputEl.addEventListener("input", () => runSearch(searchInputEl.value));
searchInputEl.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    stepSearch(event.shiftKey ? -1 : 1);
  } else if (event.key === "Escape") {
    toggleSearch(false);
  }
});

// ---------- More menu ----------
$("toggle-more").addEventListener("click", event => {
  event.stopPropagation();
  moreMenuEl.classList.toggle("open");
});
moreMenuEl.addEventListener("click", event => {
  const item = event.target.closest(".menu-item");
  if (!item) {
    return;
  }
  handleMenuAction(item.dataset.action);
  moreMenuEl.classList.remove("open");
});

// ---------- Left nav (.gsr-nav reproduction) ----------
const tabButtons = [...navEl.querySelectorAll(".nav-tb-btn")];
const tabContents = [...navEl.querySelectorAll(".tab-content")];

// Tab-bar buttons (nav open): re-clicking the active tab collapses the nav.
for (const button of tabButtons) {
  button.addEventListener("click", () => {
    if (!navEl.classList.contains("hidden") && button.classList.contains("active")) {
      collapseNav(true);
    } else {
      activateTab(button.dataset.tab);
    }
  });
}
// Collapsed-rail chips: expand the nav to that tab.
for (const chip of navRailEl.querySelectorAll(".nav-expand-btn")) {
  chip.addEventListener("click", () => activateTab(chip.dataset.tab));
}
$("nav-collapse").addEventListener("click", () => collapseNav(true));
navAdjusterEl.addEventListener("mousedown", startNavResize);

function collapseNav(collapsed) {
  navEl.classList.toggle("hidden", collapsed);
  bodyEl.style.setProperty("--nav-visible-width", collapsed ? "0px" : "var(--nav-w)");
}

// Drag the width adjuster to resize the nav (.gsr-nav-width-adjuster), clamped 220-520px.
function startNavResize(event) {
  event.preventDefault();
  bodyEl.classList.add("resizing");
  const onMove = moveEvent => {
    const width = Math.max(220, Math.min(520, moveEvent.clientX));
    bodyEl.style.setProperty("--nav-w", `${width}px`);
  };
  const onUp = () => {
    bodyEl.classList.remove("resizing");
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}

// ---------- Page input ----------
pageInputEl.addEventListener("keydown", event => {
  if (event.key !== "Enter") {
    return;
  }
  scrollToPage(Number(pageInputEl.value));
  pageInputEl.blur();
});

// ---------- Selection popup ----------
for (const button of popupEl.querySelectorAll("[data-color]")) {
  button.addEventListener("click", () => commitPendingHighlight(button.dataset.color, button === $("popup-comment")));
}

document.addEventListener("mousedown", event => {
  if (!popupEl.contains(event.target)) {
    popupEl.classList.remove("visible");
  }
  if (!moreMenuEl.contains(event.target) && event.target.closest("#toggle-more") === null) {
    moreMenuEl.classList.remove("open");
  }
  if (!citeDialogEl.contains(event.target) && event.target.closest("#cite") === null) {
    citeDialogEl.classList.remove("open");
  }
  if (!scholarMenuEl.contains(event.target) && event.target.closest("#scholar-menu-btn") === null) {
    scholarMenuEl.classList.remove("open");
    scholarMenuBtn.classList.remove("active");
  }
});

main().catch(error => {
  console.error("MATHREAD-READER-ERROR", error);
  viewerEl.innerHTML = "";
  const panel = document.createElement("div");
  panel.className = "loading";
  panel.id = "reader-error";
  panel.setAttribute("role", "alert");
  panel.textContent = `MathRead failed to load this document: ${error}`;
  viewerEl.append(panel);
});

async function main() {
  const entries = await getLibrary();
  renderLibraryEntries(entries);

  if (!libraryKey) {
    docTitleEl.textContent = "MathRead Library";
    document.title = "MathRead Library";
    viewerEl.innerHTML = `<div class="loading">No document open — pick one from the Library.</div>`;
    activateTab("library");
    return;
  }

  const matchingEntry = entries.find(entry => entry.key === libraryKey);
  if (matchingEntry === undefined) {
    throw new Error(`Library key not found on the MathRead backend: ${libraryKey}`);
  }
  libraryEntry = matchingEntry;
  pdfUrl = libraryEntry.pdf_url;

  const response = await fetch(backendPdfUrl(libraryKey));
  if (!response.ok) {
    throw new Error(`MathRead backend rejected /pdf/${libraryKey}: ${response.status} ${response.statusText}`);
  }
  pdfData = await response.arrayBuffer();
  // getDocument transfers the ArrayBuffer, so hand it a copy and keep pdfData for download.
  pdfDoc = await getDocument({ data: pdfData.slice(0) }).promise;
  pageTotalEl.textContent = String(pdfDoc.numPages);
  setDocTitle();
  renderSidebarList();
  renderOutline().catch(error => console.error("MATHREAD-POC-OUTLINE-ERROR", error));
  await renderAllPages();
  watchCurrentPage();
  pageInputEl.value = String(currentPageNumber);
  void initNotes();
  postReadEvent(libraryKey, null).catch(error => console.error("MATHREAD-READ-EVENT-ERROR", error));
}

async function setDocTitle() {
  // Title preference chain: capture-time title hint, then PDF metadata, then the key.
  let title = "";
  if (libraryEntry !== null && libraryEntry.title.trim().length > 0) {
    title = libraryEntry.title.trim();
  } else {
    try {
      const meta = await pdfDoc.getMetadata();
      const metaTitle = meta?.info?.Title;
      if (typeof metaTitle === "string" && metaTitle.trim().length > 0) {
        title = metaTitle.trim();
      }
    } catch {
      title = "";
    }
  }
  if (title.length === 0) {
    title = libraryKey;
  }
  paperTitle = title;
  docTitleEl.textContent = title;
  document.title = `${title} — MathRead`;
}

// ---------- Outline ----------
async function renderOutline() {
  const outline = await pdfDoc.getOutline();
  if (!outline || outline.length === 0) {
    outlineListEl.innerHTML = `<div class="empty">No outline in this PDF.</div>`;
    return;
  }
  outlineListEl.innerHTML = "";
  outlineListEl.append(await buildOutlineList(outline));
}

async function buildOutlineList(items) {
  const list = document.createElement("ul");
  for (const item of items) {
    const li = document.createElement("li");
    const link = document.createElement("a");
    link.textContent = item.title;
    link.addEventListener("click", async () => {
      for (const a of outlineListEl.querySelectorAll("a.current")) {
        a.classList.remove("current");
      }
      link.classList.add("current");
      const pageNumber = await outlineDestPageNumber(item.dest);
      if (pageNumber !== undefined) {
        scrollToPage(pageNumber);
      }
    });
    li.append(link);
    if (item.items && item.items.length > 0) {
      li.append(await buildOutlineList(item.items));
    }
    list.append(li);
  }
  return list;
}

async function outlineDestPageNumber(dest) {
  if (!dest) {
    return undefined;
  }
  const explicitDest = typeof dest === "string" ? await pdfDoc.getDestination(dest) : dest;
  if (!explicitDest || !explicitDest[0]) {
    return undefined;
  }
  const pageIndex = await pdfDoc.getPageIndex(explicitDest[0]);
  return pageIndex + 1;
}

// ---------- Page rendering ----------
async function renderAllPages() {
  viewerEl.innerHTML = "";
  pageContainers = [];
  for (let pageNumber = 1; pageNumber <= pdfDoc.numPages; pageNumber++) {
    const page = await pdfDoc.getPage(pageNumber);
    const viewport = page.getViewport({ scale, rotation });

    const pageDiv = document.createElement("div");
    pageDiv.className = "page";
    pageDiv.style.width = `${viewport.width}px`;
    pageDiv.style.height = `${viewport.height}px`;
    pageDiv.dataset.pageNumber = String(pageNumber);

    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;

    const textLayerDiv = document.createElement("div");
    textLayerDiv.className = "textLayer";
    const textLayer = new TextLayer({
      textContentSource: await page.streamTextContent(),
      container: textLayerDiv,
      viewport,
    });
    await textLayer.render();

    const highlightLayerDiv = document.createElement("div");
    highlightLayerDiv.className = "highlightLayer";
    const searchLayerDiv = document.createElement("div");
    searchLayerDiv.className = "highlightLayer";

    pageDiv.append(canvas, textLayerDiv, highlightLayerDiv, searchLayerDiv);
    viewerEl.append(pageDiv);

    const entry = { pageDiv, pageNumber, highlightLayerDiv, searchLayerDiv, textLayerDiv, width: viewport.width, height: viewport.height };
    pageContainers.push(entry);
    textLayerDiv.addEventListener("mouseup", () => handleSelection(entry));
  }
  updateZoomLabel();
  drawStoredHighlights();
  if (searchInputEl.value.trim()) {
    runSearch(searchInputEl.value);
  }
}

async function rerender(newScale) {
  scale = newScale;
  await renderAllPages();
  watchCurrentPage();
  scrollToPage(currentPageNumber);
}

async function fitWidth() {
  const page = await pdfDoc.getPage(currentPageNumber);
  const base = page.getViewport({ scale: 1, rotation });
  const available = viewerEl.clientWidth - 40;
  rerender(Math.max(0.4, available / base.width));
}

function updateZoomLabel() {
  zoomLevelEl.textContent = `${Math.round(scale * 80)}%`;
}

// ---------- Selection + highlights ----------
function handleSelection(entry) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    popupEl.classList.remove("visible");
    return;
  }
  const text = selection.toString().trim();
  if (text.length === 0) {
    popupEl.classList.remove("visible");
    return;
  }

  const range = selection.getRangeAt(0);
  const clientRects = Array.from(range.getClientRects());
  if (clientRects.length === 0) {
    return;
  }
  const pageRect = entry.pageDiv.getBoundingClientRect();
  const rects = clientRects.map(r => ({
    xPct: (r.left - pageRect.left) / pageRect.width,
    yPct: (r.top - pageRect.top) / pageRect.height,
    wPct: r.width / pageRect.width,
    hPct: r.height / pageRect.height,
  }));

  const last = clientRects[clientRects.length - 1];
  popupEl.style.left = `${last.right + 8}px`;
  popupEl.style.top = `${last.top}px`;
  popupEl.dataset.pending = JSON.stringify({ pageNumber: entry.pageNumber, text, rects });
  popupEl.classList.add("visible");
}

function commitPendingHighlight(color, focusComment) {
  const pending = popupEl.dataset.pending ? JSON.parse(popupEl.dataset.pending) : null;
  if (!pending) {
    return;
  }
  const highlight = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    pageNumber: pending.pageNumber,
    text: pending.text,
    color,
    comment: "",
    rects: pending.rects,
    createdAt: Date.now(),
  };
  highlights.push(highlight);
  saveHighlights(highlights);
  drawStoredHighlights();
  renderSidebarList();
  window.getSelection()?.removeAllRanges();
  popupEl.classList.remove("visible");
  delete popupEl.dataset.pending;

  if (focusComment) {
    toggleSidebar(true);
    sidebarListEl.querySelector(`[data-highlight-id="${highlight.id}"] .highlight-item-comment`)?.focus();
  }
}

function drawStoredHighlights() {
  for (const entry of pageContainers) {
    entry.highlightLayerDiv.innerHTML = "";
    for (const highlight of highlights.filter(h => h.pageNumber === entry.pageNumber)) {
      for (const rect of highlight.rects) {
        const mark = document.createElement("div");
        mark.className = "highlight-mark";
        mark.style.left = `${rect.xPct * entry.width}px`;
        mark.style.top = `${rect.yPct * entry.height}px`;
        mark.style.width = `${rect.wPct * entry.width}px`;
        mark.style.height = `${rect.hPct * entry.height}px`;
        mark.style.background = highlight.color;
        entry.highlightLayerDiv.append(mark);
      }
    }
  }
}

function renderSidebarList() {
  sidebarListEl.innerHTML = "";
  if (highlights.length === 0) {
    sidebarListEl.innerHTML = emptyHighlightsMarkup();
    return;
  }
  let lastPageNumber = null;
  for (const highlight of [...highlights].sort((a, b) => a.pageNumber - b.pageNumber || a.createdAt - b.createdAt)) {
    if (highlight.pageNumber !== lastPageNumber) {
      lastPageNumber = highlight.pageNumber;
      const header = document.createElement("div");
      header.className = "highlight-page-header";
      header.textContent = `Page ${highlight.pageNumber}`;
      sidebarListEl.append(header);
    }

    const item = document.createElement("div");
    item.className = "highlight-item";
    item.dataset.highlightId = highlight.id;
    item.style.setProperty("--item-color", highlight.color);

    const body = document.createElement("div");
    body.className = "highlight-item-body";
    const text = document.createElement("div");
    text.className = "highlight-item-text";
    text.textContent = highlight.text.slice(0, 140);
    text.addEventListener("click", () => scrollToPage(highlight.pageNumber));
    body.append(text);

    const comment = document.createElement("textarea");
    comment.className = "highlight-item-comment";
    comment.placeholder = "Add a comment...";
    comment.rows = 1;
    comment.value = highlight.comment;
    comment.addEventListener("change", () => {
      highlight.comment = comment.value;
      saveHighlights(highlights);
    });

    const footer = document.createElement("div");
    footer.className = "highlight-item-footer";
    const dot = document.createElement("span");
    dot.className = "highlight-item-dot";
    const removeButton = document.createElement("button");
    removeButton.className = "remove-btn";
    removeButton.title = "Remove";
    removeButton.textContent = "🗑";
    removeButton.addEventListener("click", () => {
      highlights = highlights.filter(h => h.id !== highlight.id);
      saveHighlights(highlights);
      drawStoredHighlights();
      renderSidebarList();
    });
    footer.append(dot, removeButton);

    item.append(body, comment, footer);
    sidebarListEl.append(item);
  }
}

function emptyHighlightsMarkup() {
  return `
    <div class="empty">
      <svg class="hl-empty-art" width="150" height="120" viewBox="0 0 150 120" fill="none">
        <rect x="20" y="12" width="110" height="34" rx="5" fill="#5a5a5a"/>
        <rect x="30" y="22" width="90" height="6" rx="3" fill="#8a8a8a"/>
        <rect x="30" y="32" width="60" height="6" rx="3" fill="#ffe09d"/>
        <path d="M75 52 l0 16 m-6 -6 l6 6 l6 -6" stroke="#9a9a9a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        <rect x="20" y="74" width="110" height="34" rx="5" fill="#5a5a5a"/>
        <rect x="30" y="84" width="90" height="6" rx="3" fill="#8a8a8a"/>
        <rect x="30" y="94" width="70" height="6" rx="3" fill="#91edd0"/>
      </svg>
      Select text to highlight or comment.
      <br /><br />
      Highlights are saved on this device.
    </div>`;
}

// ---------- Search ----------
function toggleSearch(force) {
  const open = force ?? !searchBarEl.classList.contains("open");
  searchBarEl.classList.toggle("open", open);
  $("search-toggle").classList.toggle("active", open);
  if (open) {
    searchInputEl.focus();
    searchInputEl.select();
  } else {
    clearSearch();
    searchInputEl.value = "";
  }
}

function clearSearch() {
  for (const entry of pageContainers) {
    entry.searchLayerDiv.innerHTML = "";
  }
  searchMatches = [];
  searchIndex = -1;
  searchCountEl.textContent = "";
}

function runSearch(query) {
  clearSearch();
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) {
    return;
  }
  for (const entry of pageContainers) {
    const spans = entry.textLayerDiv.querySelectorAll("span");
    const pageRect = entry.pageDiv.getBoundingClientRect();
    for (const span of spans) {
      const node = span.firstChild;
      if (!node || node.nodeType !== Node.TEXT_NODE) {
        continue;
      }
      const hay = node.textContent.toLowerCase();
      let from = hay.indexOf(needle);
      while (from !== -1) {
        const range = document.createRange();
        range.setStart(node, from);
        range.setEnd(node, from + needle.length);
        const hitEls = [];
        for (const r of range.getClientRects()) {
          const hit = document.createElement("div");
          hit.className = "search-hit";
          hit.style.left = `${r.left - pageRect.left}px`;
          hit.style.top = `${r.top - pageRect.top}px`;
          hit.style.width = `${r.width}px`;
          hit.style.height = `${r.height}px`;
          entry.searchLayerDiv.append(hit);
          hitEls.push(hit);
        }
        searchMatches.push({ entry, hitEls });
        from = hay.indexOf(needle, from + needle.length);
      }
    }
  }
  if (searchMatches.length > 0) {
    setSearchIndex(0);
  } else {
    searchCountEl.textContent = "0 results";
  }
}

function stepSearch(delta) {
  if (searchMatches.length === 0) {
    return;
  }
  setSearchIndex((searchIndex + delta + searchMatches.length) % searchMatches.length);
  const match = searchMatches[searchIndex];
  match.hitEls[0]?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function setSearchIndex(index) {
  for (const match of searchMatches) {
    for (const el of match.hitEls) {
      el.classList.remove("current");
    }
  }
  searchIndex = index;
  for (const el of searchMatches[index].hitEls) {
    el.classList.add("current");
  }
  searchCountEl.textContent = `${index + 1} / ${searchMatches.length}`;
}

// ---------- Tabs / AI (key points) editor / thumbnails ----------
function activateTab(name) {
  collapseNav(false);
  for (const button of tabButtons) {
    button.classList.toggle("active", button.dataset.tab === name);
  }
  for (const content of tabContents) {
    content.classList.toggle("active", content.dataset.panel === name);
  }
  if (name === "keypoints") {
    void initNotes();
    requestAnimationFrame(() => aiView?.requestMeasure());
  } else if (name === "thumbnails") {
    renderThumbnails();
  } else if (name === "library") {
    void refreshLibrary();
  }
}

// ---------- Key Points: sidecar-backed markdown notes ----------
notesSaveBtn.addEventListener("click", () => {
  void saveNote();
});
notesModeEditBtn.addEventListener("click", () => setNotesPreview(false));
notesModePreviewBtn.addEventListener("click", () => setNotesPreview(true));

async function initNotes() {
  if (notesInitialized) {
    return;
  }
  notesInitialized = true;

  if (!libraryKey) {
    showNotesError("Open a PDF to take notes — notes live in the PDF's markdown sidecar.");
    return;
  }

  let text;
  try {
    text = await getNote(libraryKey);
  } catch (error) {
    notesInitialized = false; // allow retry on next tab activation
    noteState = { kind: "error", message: String(error) };
    renderNoteStatus();
    showNotesError(`Could not load notes from the MathRead backend:\n${error}`);
    return;
  }

  notesErrorEl.hidden = true;
  noteState = { kind: "clean" };
  renderNoteStatus();
  aiView = new EditorView({
    parent: aiEditorEl,
    state: EditorState.create({
      doc: text,
      extensions: [
        lineNumbers(),
        history(),
        highlightActiveLine(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown(),
        syntaxHighlighting(defaultHighlightStyle),
        placeholder("Write notes… (saved to the PDF's markdown sidecar)"),
        EditorView.lineWrapping,
        EditorView.updateListener.of(update => {
          if (update.docChanged) {
            onNoteEdited();
          }
        }),
      ],
    }),
  });
}

function onNoteEdited() {
  noteState = { kind: "dirty" };
  renderNoteStatus();
  clearTimeout(noteSaveTimer);
  noteSaveTimer = setTimeout(() => {
    void saveNote();
  }, 800);
  if (notesPreviewVisible) {
    renderNotesPreview();
  }
}

async function saveNote() {
  if (!aiView || !libraryKey || noteState.kind === "saving") {
    return;
  }
  clearTimeout(noteSaveTimer);
  noteState = { kind: "saving" };
  renderNoteStatus();
  const text = aiView.state.doc.toString();
  try {
    await putNote(libraryKey, text);
    // Edits made while the PUT was in flight stay dirty and re-schedule.
    noteState = aiView.state.doc.toString() === text ? { kind: "clean" } : { kind: "dirty" };
    if (noteState.kind === "dirty") {
      noteSaveTimer = setTimeout(() => {
        void saveNote();
      }, 800);
    }
  } catch (error) {
    noteState = { kind: "error", message: String(error) };
  }
  renderNoteStatus();
}

function renderNoteStatus() {
  const label = {
    loading: () => "Loading…",
    clean: () => "Saved",
    dirty: () => "Unsaved changes",
    saving: () => "Saving…",
    error: () => `Save failed: ${noteState.message}`,
  }[noteState.kind]();
  notesStatusEl.textContent = label;
  notesStatusEl.title = label;
  notesStatusEl.classList.toggle("error", noteState.kind === "error");
  notesSaveBtn.disabled = noteState.kind === "loading" || noteState.kind === "saving";
}

function setNotesPreview(visible) {
  notesPreviewVisible = visible;
  notesModeEditBtn.classList.toggle("active", !visible);
  notesModePreviewBtn.classList.toggle("active", visible);
  aiEditorEl.hidden = visible;
  notesPreviewEl.hidden = !visible;
  if (visible) {
    renderNotesPreview();
  }
}

// Notes are user-authored markdown rendered to HTML, so sanitize the rendered
// output (same policy as the citation renderer: never inject live markup).
function renderNotesPreview() {
  const text = aiView ? aiView.state.doc.toString() : "";
  notesPreviewEl.innerHTML = DOMPurify.sanitize(marked.parse(text, { gfm: true, async: false }));
}

function showNotesError(message) {
  notesErrorEl.textContent = message;
  notesErrorEl.hidden = false;
}

// ---------- Library: backend-backed list / open / trash ----------
async function refreshLibrary() {
  try {
    renderLibraryEntries(await getLibrary());
  } catch (error) {
    libraryListEl.innerHTML = "";
    const panel = document.createElement("div");
    panel.className = "library-error";
    panel.setAttribute("role", "alert");
    panel.textContent = `Could not load the library from the MathRead backend:\n${error}`;
    libraryListEl.append(panel);
  }
}

function renderLibraryEntries(entries) {
  libraryListEl.innerHTML = "";
  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "library-empty";
    empty.textContent = "Nothing captured yet. Open a PDF in any tab to add it.";
    libraryListEl.append(empty);
    return;
  }

  const sorted = [...entries].sort((a, b) => new Date(b.last_read) - new Date(a.last_read));
  for (const entry of sorted) {
    const item = document.createElement("div");
    item.className = "library-entry";
    item.classList.toggle("current", entry.key === libraryKey);
    item.dataset.testid = "library-entry";

    const open = document.createElement("button");
    open.className = "library-entry-open";
    open.dataset.testid = "library-entry-open";
    open.title = entry.title;
    const title = document.createElement("span");
    title.className = "library-entry-title";
    title.textContent = entry.title;
    const meta = document.createElement("span");
    meta.className = "library-entry-meta";
    meta.textContent = `${entry.has_note ? "📝 " : ""}${relativeTime(entry.last_read)}`;
    open.append(title, meta);
    open.addEventListener("click", () => {
      if (entry.key === libraryKey) {
        return;
      }
      // Navigating the top window to the backend copy re-enters the reader through the
      // same interception path as a fresh capture (reader-swap.ts recognizes the key).
      window.top.location.href = backendPdfUrl(entry.key);
    });

    const trash = document.createElement("button");
    trash.className = "library-entry-trash";
    trash.dataset.testid = "library-entry-trash";
    trash.title = "Trash — deletes the PDF and its notes";
    trash.textContent = "🗑";
    trash.addEventListener("click", () => {
      if (!confirm(`Trash "${entry.title}"?\n\nThis deletes the stored PDF, its notes, and its assets.`)) {
        return;
      }
      deleteLibraryEntry(entry.key)
        .then(() => refreshLibrary())
        .catch(error => flashTitle(`Trash failed: ${error}`));
    });

    item.append(open, trash);
    libraryListEl.append(item);
  }
}

function relativeTime(iso) {
  const thenMs = new Date(iso).getTime();
  if (!Number.isFinite(thenMs)) {
    return iso;
  }
  const seconds = Math.max(0, (Date.now() - thenMs) / 1000);
  if (seconds < 60) {
    return "just now";
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)} min ago`;
  }
  if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  const days = Math.floor(seconds / 86400);
  if (days < 30) {
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }
  return new Date(thenMs).toLocaleDateString();
}

async function renderThumbnails() {
  if (thumbsBuilt) {
    return;
  }
  thumbsBuilt = true;
  pagesListEl.innerHTML = "";
  const observer = new IntersectionObserver(
    entries => {
      for (const e of entries) {
        if (e.isIntersecting && !e.target.dataset.rendered) {
          e.target.dataset.rendered = "1";
          renderOneThumb(Number(e.target.dataset.page), e.target);
        }
      }
    },
    { root: pagesListEl, rootMargin: "300px" },
  );
  for (let n = 1; n <= pdfDoc.numPages; n++) {
    const wrap = document.createElement("div");
    wrap.className = "thumb";
    wrap.dataset.page = String(n);
    const canvas = document.createElement("canvas");
    canvas.width = 130;
    canvas.height = 168;
    const label = document.createElement("div");
    label.className = "thumb-label";
    label.textContent = String(n);
    wrap.append(canvas, label);
    wrap.addEventListener("click", () => scrollToPage(n));
    pagesListEl.append(wrap);
    observer.observe(wrap);
  }
}

async function renderOneThumb(pageNumber, wrap) {
  const page = await pdfDoc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1, rotation });
  const viewport = page.getViewport({ scale: 130 / base.width, rotation });
  const canvas = wrap.querySelector("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
}

// ---------- More menu actions ----------
function handleMenuAction(action) {
  if (action?.startsWith("mode-")) {
    for (const item of moreMenuEl.querySelectorAll(".menu-check")) {
      item.dataset.checked = String(item.dataset.action === action);
    }
    viewerEl.classList.remove("mode-dark", "mode-night");
    if (action === "mode-dark") {
      viewerEl.classList.add("mode-dark");
    } else if (action === "mode-night") {
      viewerEl.classList.add("mode-night");
    }
    return;
  }
  if (action === "properties") {
    pdfDoc.getMetadata().then(meta => {
      const metaTitle = meta?.info?.Title;
      flashTitle(typeof metaTitle === "string" && metaTitle.length > 0 ? metaTitle : paperTitle);
    });
  } else if (action === "report") {
    flashTitle("Report an issue — not wired in the POC");
  } else {
    flashTitle(`"${action}" — not wired in the POC`);
  }
}

// ---------- Google Scholar record + Cite ----------
// Grounded in the reference extension (reader-compiled.js). The paper is
// resolved on Google Scholar BY ITS URL via the private JSON endpoint
// `output=gsb&lookup_url=<pdf url>` -- not a title text search. Scholar indexes
// papers by URL, so an arXiv PDF url (e.g. arxiv.org/pdf/2312.03638) resolves
// directly; a title guess does not. The resolved record yields an info id (for
// citations) plus the Cited by / Related / All versions links. "Cite" then
// calls `output=gsb-cite` with that info id for Scholar's own formatted
// citations + import links. Both endpoints return JSON and are fetched live
// with the user's session (credentials: include), exactly as the reference does.

// undefined = not yet resolved, null = resolved-but-not-found, object = record.
let scholarRecord;

async function resolveScholarRecord() {
  if (scholarRecord !== undefined) {
    return scholarRecord;
  }
  if (pdfUrl === null) {
    scholarRecord = null;
    return null;
  }
  const url = `https://scholar.google.com/scholar?oi=gsr&q=${encodeURIComponent(paperTitle)}`
    + `&output=gsb&lookup_url=${encodeURIComponent(pdfUrl)}&hl=en`;
  const data = await (await fetch(url, { credentials: "include" })).json();
  const record = data?.l === "1" && Array.isArray(data.r) ? data.r[0] : null;
  const links = record?.l;
  if (!links?.f?.u) {
    scholarRecord = null;
    return null;
  }
  scholarRecord = {
    infoId: links.f.u.substring(2), // reference: d.f.u.substring(2)
    // Keys c / r / v = Cited by / Related / All versions, in Scholar's order.
    links: ["c", "r", "v"]
      .map(key => links[key])
      .filter(link => link && typeof link.l === "string" && typeof link.u === "string")
      .map(link => ({ label: link.l, href: new URL(link.u, "https://scholar.google.com").href })),
  };
  return scholarRecord;
}

async function toggleCiteDialog() {
  const open = !citeDialogEl.classList.contains("open");
  citeDialogEl.classList.toggle("open", open);
  $("cite").classList.toggle("active", open);
  if (open && !citeLoaded) {
    await loadCitation();
  }
}

async function loadCitation() {
  citeBodyEl.innerHTML = `<div class="cite-status">Looking up citation…</div>`;
  try {
    const record = await resolveScholarRecord();
    if (!record) {
      citeBodyEl.innerHTML = `<div class="cite-status">Article not found in Scholar.</div>`;
      return;
    }
    const url = `https://scholar.google.com/scholar?q=info:${encodeURIComponent(record.infoId)}`
      + `:scholar.google.com/&oi=gsr&output=gsb-cite&hl=en`;
    const data = await (await fetch(url, { credentials: "include" })).json();
    renderCitation(data);
    citeLoaded = true;
  } catch (error) {
    console.error("MATHREAD-POC-CITE-ERROR", error);
    citeBodyEl.innerHTML = `<div class="cite-status">Citation lookup failed. Google Scholar may require you to be signed in, or may be rate-limiting requests.</div>`;
  }
}

// Scholar's `h` citation field is HTML: entity-encoded (&quot; &amp;) with <i>
// italics for titles/journals. Parse it so entities decode and italics render,
// but copy only whitelisted inline tags as text -- never inject third-party
// markup (scripts, event handlers, images) from the Scholar response.
const CITE_INLINE_TAGS = new Set(["I", "EM", "B", "STRONG", "SUB", "SUP"]);

function appendSafeCitationHtml(target, html) {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const copy = (source, dest) => {
    for (const node of source.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        dest.appendChild(document.createTextNode(node.nodeValue));
      } else if (node.nodeType === Node.ELEMENT_NODE && CITE_INLINE_TAGS.has(node.tagName)) {
        const el = document.createElement(node.tagName.toLowerCase());
        copy(node, el);
        dest.appendChild(el);
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        copy(node, dest); // unknown tag: keep its text, drop the tag
      }
    }
  };
  copy(parsed.body, target);
}

function renderCitation(data) {
  citeBodyEl.innerHTML = "";
  // gsb-cite JSON: l = [{l: label, h: citation}], i = [{u, l} import links].
  for (const row of Array.isArray(data?.l) ? data.l : []) {
    if (!row?.l || !row?.h) {
      continue;
    }
    const rowEl = document.createElement("div");
    rowEl.className = "cite-row";
    const lbl = document.createElement("div");
    lbl.className = "cite-lbl";
    lbl.textContent = row.l;
    const txt = document.createElement("div");
    txt.className = "cite-txt";
    appendSafeCitationHtml(txt, row.h);
    rowEl.append(lbl, txt);
    citeBodyEl.append(rowEl);
  }
  const imports = Array.isArray(data?.i) ? data.i.filter(link => link?.u && link?.l) : [];
  if (imports.length > 0) {
    const linksEl = document.createElement("div");
    linksEl.className = "cite-links";
    for (const link of imports) {
      const anchor = document.createElement("a");
      anchor.className = "cite-link";
      anchor.textContent = link.l;
      anchor.href = new URL(link.u, "https://scholar.google.com").href;
      anchor.target = "_blank";
      anchor.rel = "noopener";
      linksEl.append(anchor);
    }
    citeBodyEl.append(linksEl);
  }
  if (citeBodyEl.children.length === 0) {
    citeBodyEl.innerHTML = `<div class="cite-status">Google Scholar returned no citation for this document.</div>`;
  }
}

// Scholar links dropdown (grad-cap button): Cited by / Related / All versions.
async function toggleScholarMenu() {
  const open = !scholarMenuEl.classList.contains("open");
  scholarMenuEl.classList.toggle("open", open);
  scholarMenuBtn.classList.toggle("active", open);
  if (open) {
    await populateScholarMenu();
  }
}

async function populateScholarMenu() {
  scholarMenuEl.innerHTML = `<div class="scholar-menu-status">Looking up…</div>`;
  try {
    const record = await resolveScholarRecord();
    if (!record || record.links.length === 0) {
      scholarMenuEl.innerHTML = `<div class="scholar-menu-status">Article not found in Scholar.</div>`;
      return;
    }
    scholarMenuEl.innerHTML = "";
    for (const link of record.links) {
      const anchor = document.createElement("a");
      anchor.className = "scholar-menu-link";
      anchor.textContent = link.label;
      anchor.href = link.href;
      anchor.target = "_blank";
      anchor.rel = "noopener";
      scholarMenuEl.append(anchor);
    }
  } catch (error) {
    console.error("MATHREAD-POC-SCHOLAR-ERROR", error);
    scholarMenuEl.innerHTML = `<div class="scholar-menu-status">Lookup failed. Sign in to Google Scholar, or try again later.</div>`;
  }
}

// ---------- Small helpers ----------
function toggleSidebar(force) {
  const open = force ?? !sidebarEl.classList.contains("open");
  sidebarEl.classList.toggle("open", open);
  $("toggle-sidebar").classList.toggle("active", open);
}

function scrollToPage(target) {
  pageContainers.find(p => p.pageNumber === target)?.pageDiv.scrollIntoView({ behavior: "smooth", block: "start" });
}

function jumpPage(delta) {
  const index = pageContainers.findIndex(p => p.pageNumber === currentPageNumber);
  const next = pageContainers[Math.min(pageContainers.length - 1, Math.max(0, index + delta))];
  next?.pageDiv.scrollIntoView({ behavior: "smooth", block: "start" });
}

function watchCurrentPage() {
  intersectionObserver?.disconnect();
  intersectionObserver = new IntersectionObserver(
    entries => {
      const mostVisible = entries
        .filter(e => e.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (mostVisible) {
        currentPageNumber = Number(mostVisible.target.dataset.pageNumber);
        pageInputEl.value = String(currentPageNumber);
        scheduleReadEvent();
      }
    },
    { root: viewerEl, threshold: [0.5] },
  );
  for (const entry of pageContainers) {
    intersectionObserver.observe(entry.pageDiv);
  }
}

function scheduleReadEvent() {
  if (!libraryKey || !pdfDoc) {
    return;
  }
  clearTimeout(readEventTimer);
  readEventTimer = setTimeout(() => {
    const position = pdfDoc.numPages > 0 ? (currentPageNumber - 1) / pdfDoc.numPages : 0;
    postReadEvent(libraryKey, position).catch(error => console.error("MATHREAD-READ-EVENT-ERROR", error));
  }, 2000);
}

async function downloadPdf() {
  const blob = new Blob([pdfData], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = libraryKey; // downloads only exist for a loaded (key-backed) document
  anchor.click();
  URL.revokeObjectURL(url);
}

let flashTimer = null;
function flashTitle(message) {
  const original = docTitleEl.textContent;
  docTitleEl.textContent = message;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    docTitleEl.textContent = original;
  }, 1800);
}

function loadHighlights() {
  const raw = localStorage.getItem(storageKey);
  if (raw === null) {
    return []; // nothing stored yet for this key — a real empty state, not a fallback
  }
  return JSON.parse(raw);
}

function saveHighlights(value) {
  localStorage.setItem(storageKey, JSON.stringify(value));
}
