// Highlights/comments live in the markdown notes file as pandoc fenced divs
// (see annotations.ts) - the note doc is the single durable annotation store.
import { getDocument, GlobalWorkerOptions } from "./vendor/pdfjs/pdf.min.mjs";
import {
  EventBus,
  LinkTarget,
  PDFFindController,
  PDFHistory,
  PDFLinkService,
  PDFViewer,
} from "./vendor/pdfjs/pdf_viewer.mjs";
import { parseAnnotationDocument, previewMarkdown, removeAnnotation, upsertAnnotation } from "./annotations.js";
import {
  DOMPurify,
  backendHealth,
  deleteLibraryEntry,
  getBackendStatus,
  getLibrary,
  getNote,
  marked,
  noteAssetUrl,
  openLibraryRoot,
  overwriteNote,
  pdfUrl as backendPdfUrl,
  postNoteImage,
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

GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("reader/vendor/pdfjs/pdf.worker.min.mjs");

// The reader is keyed by the backend library key (the stored PDF filename). The PDF
// bytes come from GET /pdf/{key}; provenance (original pdf_url, title) comes from the
// library entry. Without a key the reader is a library browser only.
const bootParams = new URLSearchParams(location.search);
const libraryKey = bootParams.get("key");
// View restore: pdf-launch forwards source-link state into the reader query.
const initialView = initialViewFrom(bootParams);
const initialPage = initialView.page;
const initialViewport = initialView.viewport;
const initialZoom = initialView.zoom;
const hasExplicitInitialZoom =
  initialZoom !== null && Number.isFinite(initialZoom) && initialZoom > 0;
// Legacy localStorage highlight store; read once to migrate into the notes file.
const legacyStorageKey = `mathread-legacy-highlights:${libraryKey}`;

const $ = id => document.getElementById(id);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function setStatusMessage(target, className, message) {
  const status = document.createElement("div");
  status.className = className;
  status.textContent = message;
  target.replaceChildren(status);
}

function initialViewportFrom(params, page) {
  const xParam = params.get("mrx");
  const yParam = params.get("mry");
  if (xParam === null && yParam === null) {
    return null;
  }
  assert(xParam !== null && yParam !== null, "MathRead reader viewport requires both coordinates");
  assert(Number.isInteger(page) && page >= 1, "MathRead reader viewport requires a page");
  const x = Number(xParam);
  const y = Number(yParam);
  assert(Number.isFinite(x), "MathRead reader viewport x must be finite");
  assert(Number.isFinite(y), "MathRead reader viewport y must be finite");
  return { x, y };
}

function initialViewFrom(params) {
  const serializedState = params.get("mathread-view");
  if (serializedState !== null) {
    return initialViewFromSerializedState(serializedState);
  }
  const page = Number(params.get("page"));
  const zoomParam = params.get("zoom");
  return {
    page,
    viewport: initialViewportFrom(params, page),
    zoom: zoomParam === null ? null : Number(zoomParam),
  };
}

function initialViewFromSerializedState(serializedState) {
  const parts = serializedState.split(":");
  assert(parts.length === 5 && parts[0] === "v1", "MathRead reader view state is invalid");
  const page = Number(parts[1]);
  const x = Number(parts[2]);
  const y = Number(parts[3]);
  const zoom = Number(parts[4]);
  assert(Number.isInteger(page) && page >= 1, "MathRead reader view state requires a page");
  assert(Number.isFinite(x), "MathRead reader view state x must be finite");
  assert(Number.isFinite(y), "MathRead reader view state y must be finite");
  assert(Number.isFinite(zoom) && zoom > 0, "MathRead reader view state zoom must be positive");
  return { page, viewport: { x, y }, zoom };
}

const viewerEl = $("viewer");
const pdfViewerEl = $("pdf-viewer");
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
const notesPathEl = $("notes-path");
const notesPreviewEl = $("notes-preview");
const notesErrorEl = $("notes-error");
const notesSaveBtn = $("notes-save");
const notesModeEditBtn = $("notes-mode-edit");
const notesModePreviewBtn = $("notes-mode-preview");
const notesClipBtn = $("notes-clip");
const backendLightEl = $("backend-light");
const openArxivBtn = $("open-arxiv");
const clipOverlayEl = $("clip-overlay");
const clipRectEl = $("clip-rect");

let highlights = []; // parsed from the note doc; refreshAnnotations() is the only writer
let scale = hasExplicitInitialZoom ? initialZoom : 1;
let rotation = 0;
let pdfDoc = null;
let pdfData = null;
let libraryEntry = null;
let pdfUrl = null; // original provenance URL (Scholar lookup, document properties)
let pdfHistoryFingerprint = null;
let greatestPdfHistoryUid = -1;
// Editor state machine: loading -> clean <-> dirty -> saving -> clean | error.
let noteState = { kind: "loading" };
// The note text, loaded once at boot before page render so highlights are
// known when the pages first draw (see loadNoteText). The editor, once mounted,
// becomes the live source; until then this holds the loaded text.
let noteText = null;
let noteVersion = "";
let noteSaveTimer = null;
let notesInitialized = false;
let notesPreviewVisible = false;
// User-tunable settings (see mathread/options.html); loaded before the editor mounts.
const settingsDefaults = { autosaveMs: 800, fitWidthOnOpen: false, lineNumbers: true };
let settings = settingsDefaults;
let pageContainers = [];
let currentPageNumber = 1;
let paperTitle = "";
let citeLoaded = false;
let aiView = null;
let thumbsBuilt = false;
let pendingLegacyMigrationStorageKey = null;

const eventBus = new EventBus();
const linkService = new PDFLinkService({
  eventBus,
  externalLinkTarget: LinkTarget.BLANK,
});
const pdfHistory = new PDFHistory({ eventBus, linkService });
linkService.setHistory(pdfHistory);
const findController = new PDFFindController({ eventBus, linkService });
const pdfViewer = new PDFViewer({
  container: viewerEl,
  viewer: pdfViewerEl,
  eventBus,
  linkService,
  findController,
});
linkService.setViewer(pdfViewer);

function refreshFitWidth() {
  if (pdfViewer.currentScaleValue === "page-width") {
    pdfViewer.currentScaleValue = "page-width";
  }
}

window.addEventListener("resize", refreshFitWidth);
viewerEl.addEventListener("transitionend", event => {
  if (event.target === viewerEl) {
    refreshFitWidth();
  }
});

const documentControlIds = [
  "prev-page",
  "next-page",
  "page-input",
  "zoom-out",
  "zoom-in",
  "fit-width",
  "rotate",
  "download",
];

// ---------- Backend status light ----------
backendLightEl.addEventListener("click", () => chrome.runtime.openOptionsPage());

async function refreshBackendLight() {
  const health = await backendHealth();
  backendLightEl.classList.remove("checking", "ok", "down");
  backendLightEl.classList.add(health.ok ? "ok" : "down");
  backendLightEl.title = `${health.detail}\nClick for MathRead settings.`;
}
void refreshBackendLight();
setInterval(() => {
  void refreshBackendLight();
}, 30_000);

async function loadSettings() {
  const stored = await chrome.storage.local.get(["mathread.settings"]);
  const raw = stored["mathread.settings"];
  settings = { ...settingsDefaults, ...(typeof raw === "object" && raw !== null ? raw : {}) };
}

// ---------- Toolbar wiring ----------
$("prev-page").addEventListener("click", () => jumpPage(-1));
$("next-page").addEventListener("click", () => jumpPage(1));
$("zoom-in").addEventListener("click", () => {
  setScale(scale * 1.1);
});
$("zoom-out").addEventListener("click", () => {
  setScale(scale / 1.1);
});
$("fit-width").addEventListener("click", () => {
  fitWidth();
});
$("rotate").addEventListener("click", () => {
  pdfViewer.pagesRotation = (pdfViewer.pagesRotation + 90) % 360;
});
$("toggle-sidebar").addEventListener("click", () => toggleSidebar());
$("close-sidebar").addEventListener("click", () => toggleSidebar(false));
$("download").addEventListener("click", downloadPdf);
$("print").addEventListener("click", () => window.print());

$("cite").addEventListener("click", () => toggleCiteDialog());
openArxivBtn.addEventListener("click", () => openArxivPage());
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
    refreshFitWidth();
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

function readerError(context, error) {
  return new Error(`${context}: ${error instanceof Error ? error.message : String(error)}`);
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
  viewerEl.innerHTML = "";
  const panel = document.createElement("div");
  panel.className = "loading";
  panel.id = "reader-error";
  panel.setAttribute("role", "alert");
  panel.textContent = `MathRead failed to load this document: ${error}`;
  viewerEl.append(panel);
  throw readerError("MATHREAD-READER-ERROR", error);
});

async function main() {
  await loadSettings();
  const [backendStatus, entries] = await Promise.all([getBackendStatus(), getLibrary()]);
  renderLibrary(backendStatus, entries);

  if (!libraryKey) {
    docTitleEl.textContent = "MathRead Library";
    document.title = "MathRead Library";
    setStatusMessage(viewerEl, "loading", "No document open - pick one from the Library.");
    setDocumentControlsEnabled(false);
    activateTab("library");
    return;
  }

  const matchingEntry = entries.find(entry => entry.key === libraryKey);
  if (matchingEntry === undefined) {
    throw new Error(`Library key not found on the MathRead backend: ${libraryKey}`);
  }
  libraryEntry = matchingEntry;
  pdfUrl = libraryEntry.pdf_url;
  configureArxivButton(pdfUrl);

  const response = await fetch(backendPdfUrl(libraryKey));
  if (!response.ok) {
    throw new Error(`MathRead backend rejected /pdf/${libraryKey}: ${response.status} ${response.statusText}`);
  }
  pdfData = await response.arrayBuffer();
  // getDocument transfers the ArrayBuffer, so hand it a copy and keep pdfData for download.
  pdfDoc = await getDocument({
    data: pdfData.slice(0),
    cMapUrl: chrome.runtime.getURL("reader/vendor/pdfjs/cmaps/"),
    standardFontDataUrl: chrome.runtime.getURL("reader/vendor/pdfjs/standard_fonts/"),
    wasmUrl: chrome.runtime.getURL("reader/vendor/pdfjs/wasm/"),
  }).promise;
  pageTotalEl.textContent = String(pdfDoc.numPages);
  setDocumentControlsEnabled(true);
  setDocTitle();
  // Load annotations before rendering so highlights draw with the pages (and thus
  // before the smooth scrollToPage below), not during the scroll settle.
  await loadNoteText();
  renderSidebarList();
  renderOutline().catch(error => {
    throw readerError("MATHREAD-READER-OUTLINE-ERROR", error);
  });
  await mountPdfDocument();
  pageInputEl.value = String(currentPageNumber);
  void initNotes();
  postReadEvent(libraryKey)
    .then(refreshLibrary)
    .catch(error => {
      throw readerError("MATHREAD-READ-EVENT-ERROR", error);
    });
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
    } catch (error) {
      throw readerError("MATHREAD-PDF-METADATA-ERROR", error);
    }
  }
  if (title.length === 0) {
    title = libraryKey;
  }
  paperTitle = title;
  docTitleEl.textContent = title;
  document.title = `${title} - MathRead`;
}

// ---------- Outline ----------
async function renderOutline() {
  const outline = await pdfDoc.getOutline();
  if (!outline || outline.length === 0) {
    setStatusMessage(outlineListEl, "empty", "No outline in this PDF.");
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
      await linkService.goToDestination(item.dest);
    });
    li.append(link);
    if (item.items && item.items.length > 0) {
      li.append(await buildOutlineList(item.items));
    }
    list.append(li);
  }
  return list;
}

// ---------- Page rendering ----------
async function mountPdfDocument() {
  const pagesInitialized = new Promise(resolve => {
    eventBus.on("pagesinit", resolve, { once: true });
  });
  linkService.setDocument(pdfDoc, pdfUrl ?? backendPdfUrl(libraryKey));
  pdfViewer.setDocument(pdfDoc);
  await pagesInitialized;
  pdfHistoryFingerprint = Array.isArray(pdfDoc?.fingerprints)
    && typeof pdfDoc.fingerprints[0] === "string"
    && pdfDoc.fingerprints[0].length > 0
    ? pdfDoc.fingerprints[0]
    : null;
  greatestPdfHistoryUid = -1;
  if (pdfHistoryFingerprint !== null) {
    pdfHistory.initialize({
      fingerprint: pdfHistoryFingerprint,
      updateUrl: false,
    });
    observePdfHistoryEntry(window.history.state);
  }
  syncPageContainers();
  pdfViewer.currentScaleValue = settings.fitWidthOnOpen && !hasExplicitInitialZoom
    ? "page-width"
    : String(scale);
  if (initialViewport !== null) {
    linkService.goToXY(initialPage, initialViewport.x, initialViewport.y);
  } else if (Number.isFinite(initialPage) && initialPage >= 1) {
    scrollToPage(initialPage);
  }
  updateZoomLabel();
  drawStoredHighlights();
}

function syncPageContainers() {
  pageContainers = Array.from({ length: pdfViewer.pagesCount }, (_, index) => {
    const pageView = pdfViewer.getPageView(index);
    const pageDiv = pageView.div;
    let highlightLayerDiv = pageDiv.querySelector(":scope > .highlightLayer");
    if (highlightLayerDiv === null) {
      highlightLayerDiv = document.createElement("div");
      highlightLayerDiv.className = "highlightLayer";
      pageDiv.append(highlightLayerDiv);
      pageDiv.addEventListener("mouseup", () => handleSelection(pageContainers[index]));
    }
    return {
      pageDiv,
      pageNumber: index + 1,
      highlightLayerDiv,
      get width() { return pageDiv.clientWidth; },
      get height() { return pageDiv.clientHeight; },
    };
  });
}

function setScale(newScale) {
  pdfViewer.currentScaleValue = String(Math.min(10, Math.max(0.1, newScale)));
}

function fitWidth() {
  if (pdfDoc !== null) {
    pdfViewer.currentScaleValue = "page-width";
  }
}

function updateZoomLabel() {
  zoomLevelEl.textContent = `${Math.round(scale * 100)}%`;
}

eventBus.on("pagechanging", ({ pageNumber }) => {
  currentPageNumber = pageNumber;
  pageInputEl.value = String(pageNumber);
});
eventBus.on("scalechanging", ({ scale: nextScale }) => {
  scale = nextScale;
  updateZoomLabel();
  drawStoredHighlights();
});
eventBus.on("rotationchanging", ({ pagesRotation }) => {
  rotation = pagesRotation;
  thumbsBuilt = false;
  pagesListEl.replaceChildren();
  drawStoredHighlights();
});
eventBus.on("pagerendered", () => {
  syncPageContainers();
  drawStoredHighlights();
});

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
    id: `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    pageNumber: pending.pageNumber,
    text: pending.text,
    color,
    comment: "",
    rects: pending.rects,
    created: new Date().toISOString(),
  };
  mutateNote(doc => upsertAnnotation(doc, highlight));
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
    appendEmptyHighlights(sidebarListEl);
    return;
  }
  let lastPageNumber = null;
  for (const highlight of [...highlights].sort((a, b) => a.pageNumber - b.pageNumber || a.created.localeCompare(b.created))) {
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
      mutateNote(doc => upsertAnnotation(doc, { ...highlight, comment: comment.value }));
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
      mutateNote(doc => removeAnnotation(doc, highlight.id));
    });
    footer.append(dot, removeButton);

    item.append(body, comment, footer);
    sidebarListEl.append(item);
  }
}

function appendEmptyHighlights(target) {
  const empty = document.createElement("div");
  empty.className = "empty";

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("hl-empty-art");
  svg.setAttribute("width", "150");
  svg.setAttribute("height", "120");
  svg.setAttribute("viewBox", "0 0 150 120");
  svg.setAttribute("fill", "none");

  const addRect = (x, y, width, height, rx, fill) => {
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", x);
    rect.setAttribute("y", y);
    rect.setAttribute("width", width);
    rect.setAttribute("height", height);
    rect.setAttribute("rx", rx);
    rect.setAttribute("fill", fill);
    svg.append(rect);
  };

  addRect("20", "12", "110", "34", "5", "#5a5a5a");
  addRect("30", "22", "90", "6", "3", "#8a8a8a");
  addRect("30", "32", "60", "6", "3", "#ffe09d");
  const arrow = document.createElementNS("http://www.w3.org/2000/svg", "path");
  arrow.setAttribute("d", "M75 52 l0 16 m-6 -6 l6 6 l6 -6");
  arrow.setAttribute("stroke", "#9a9a9a");
  arrow.setAttribute("stroke-width", "3");
  arrow.setAttribute("stroke-linecap", "round");
  arrow.setAttribute("stroke-linejoin", "round");
  svg.append(arrow);
  addRect("20", "74", "110", "34", "5", "#5a5a5a");
  addRect("30", "84", "90", "6", "3", "#8a8a8a");
  addRect("30", "94", "70", "6", "3", "#91edd0");

  empty.append(
    svg,
    document.createTextNode("Select text to highlight or comment."),
  );
  target.append(empty);
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
  eventBus.dispatch("findbarclose", { source: searchInputEl });
  searchCountEl.textContent = "";
}

function runSearch(query) {
  if (query.trim().length === 0) {
    clearSearch();
    return;
  }
  dispatchFind("", false);
}

function stepSearch(delta) {
  if (searchInputEl.value.trim().length === 0) {
    return;
  }
  dispatchFind("again", delta < 0);
}

function dispatchFind(type, findPrevious) {
  eventBus.dispatch("find", {
    source: searchInputEl,
    type,
    query: searchInputEl.value,
    phraseSearch: true,
    caseSensitive: false,
    entireWord: false,
    highlightAll: true,
    findPrevious,
    matchDiacritics: false,
  });
}

eventBus.on("updatefindmatchescount", ({ matchesCount }) => {
  searchCountEl.textContent = matchesCount.total === 0
    ? "0 results"
    : `${matchesCount.current} / ${matchesCount.total}`;
});

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

// ---------- Notes: markdown file-backed notes ----------
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
    showNotesError("Open a PDF to take notes.");
    return;
  }

  // Boot loads the note text before render; the lazy tab-activation path may arrive
  // first, or after a boot-time load failure, so ensure the text is present.
  if (noteText === null && !(await loadNoteText())) {
    notesInitialized = false; // load failed; error surfaced, allow retry on next activation
    return;
  }

  if (noteState.kind !== "syntax-error") {
    notesErrorEl.hidden = true;
    noteState = { kind: "clean" };
  }
  renderNoteStatus();
  renderNotesTabMarker(noteText.trim().length > 0);
  aiView = new EditorView({
    parent: aiEditorEl,
    state: EditorState.create({
      doc: noteText,
      extensions: [
        ...(settings.lineNumbers ? [lineNumbers()] : []),
        history(),
        highlightActiveLine(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown(),
        syntaxHighlighting(defaultHighlightStyle),
        EditorView.lineWrapping,
        EditorView.updateListener.of(update => {
          if (update.docChanged && refreshAnnotations()) {
            onNoteEdited();
          }
        }),
      ],
    }),
  });
  migrateLegacyHighlights();
}

// Load the note file once and derive highlight state from it, independent of the
// editor. Highlights render on the PDF whether or not the notes tab is ever opened,
// so this runs at boot before page render. Returns false if the backend load failed
// (error surfaced to the notes panel); highlights then stay empty.
async function loadNoteText() {
  try {
    const res = await getNote(libraryKey);
    noteText = res.text;
    if (res.version) {
      noteVersion = res.version;
    } else {
      noteVersion = "";
    }
  } catch (error) {
    noteState = { kind: "error", message: String(error) };
    renderNoteStatus();
    showNotesError(`Could not load notes from the MathRead backend:\n${error}`);
    return false;
  }
  const parsed = parseAnnotationDocument(noteText);
  if (parsed.error !== null) {
    setAnnotationSyntaxError(parsed.error);
    highlights = [];
    return true;
  }
  highlights = parsed.annotations;
  noteState = { kind: "clean" };
  return true;
}

function onNoteEdited() {
  if (noteState.kind === "conflict") {
    return;
  }
  noteState = { kind: "dirty" };
  renderNoteStatus();
  renderNotesTabMarker(aiView.state.doc.toString().trim().length > 0);
  clearTimeout(noteSaveTimer);
  noteSaveTimer = setTimeout(() => {
    void saveNote();
  }, settings.autosaveMs);
  if (notesPreviewVisible) {
    renderNotesPreview();
  }
}

// Color the Notes tab (tab-bar button + collapsed-rail chip) when nontrivial notes exist.
function renderNotesTabMarker(hasNote) {
  for (const el of document.querySelectorAll('[data-tab="keypoints"]')) {
    el.classList.toggle("has-note", hasNote);
  }
}

function showNotesConflict(pendingText) {
  notesErrorEl.innerHTML = "";

  const title = document.createElement("div");
  title.className = "notes-error-title";
  title.style.fontWeight = "bold";
  title.style.marginBottom = "8px";
  title.textContent = "Conflict: Note modified elsewhere";
  notesErrorEl.append(title);

  const desc = document.createElement("p");
  desc.style.margin = "0 0 8px 0";
  desc.textContent = "This note has been modified on disk or in another tab. Choose how to resolve this conflict:";
  notesErrorEl.append(desc);

  const btnContainer = document.createElement("div");
  btnContainer.style.display = "flex";
  btnContainer.style.gap = "8px";

  const overwriteBtn = document.createElement("button");
  overwriteBtn.className = "notes-conflict-btn";
  overwriteBtn.textContent = "Overwrite Disk";
  overwriteBtn.style.padding = "4px 8px";
  overwriteBtn.onclick = async () => {
    notesErrorEl.hidden = true;
    notesErrorEl.innerHTML = "";
    noteState = { kind: "saving" };
    renderNoteStatus();
    try {
      const res = await overwriteNote(libraryKey, pendingText);
      if (res.version) {
        noteVersion = res.version;
      } else {
        noteVersion = "";
      }
      noteState = aiView.state.doc.toString() === pendingText ? { kind: "clean" } : { kind: "dirty" };
      if (noteState.kind === "dirty") {
        noteSaveTimer = setTimeout(() => {
          void saveNote();
        }, settings.autosaveMs);
      }
    } catch (error) {
      if (String(error).includes("409")) {
        showNotesConflict(pendingText);
      } else {
        noteState = { kind: "error", message: String(error) };
      }
    }
    renderNoteStatus();
  };

  const loadBtn = document.createElement("button");
  loadBtn.className = "notes-conflict-btn";
  loadBtn.textContent = "Load from Disk";
  loadBtn.style.padding = "4px 8px";
  loadBtn.onclick = async () => {
    notesErrorEl.hidden = true;
    notesErrorEl.innerHTML = "";
    noteState = { kind: "loading" };
    renderNoteStatus();
    try {
      const res = await getNote(libraryKey);
      noteText = res.text;
      if (res.version) {
        noteVersion = res.version;
      } else {
        noteVersion = "";
      }
      aiView.dispatch({
        changes: { from: 0, to: aiView.state.doc.length, insert: noteText },
      });
      if (refreshAnnotations()) {
        noteState = { kind: "clean" };
      }
    } catch (error) {
      noteState = { kind: "error", message: String(error) };
    }
    renderNoteStatus();
  };

  btnContainer.append(overwriteBtn);
  btnContainer.append(loadBtn);
  notesErrorEl.append(btnContainer);
  notesErrorEl.hidden = false;
}

async function saveNote() {
  if (!aiView || !libraryKey || noteState.kind === "saving" || noteState.kind === "syntax-error") {
    return;
  }
  clearTimeout(noteSaveTimer);
  noteState = { kind: "saving" };
  renderNoteStatus();
  const text = aiView.state.doc.toString();
  try {
    const res = await putNote(libraryKey, text, noteVersion);
    if (res.version) {
      noteVersion = res.version;
    } else {
      noteVersion = "";
    }
    if (pendingLegacyMigrationStorageKey !== null) {
      localStorage.removeItem(pendingLegacyMigrationStorageKey);
      pendingLegacyMigrationStorageKey = null;
    }
    // Edits made while the PUT was in flight stay dirty and re-schedule.
    noteState = aiView.state.doc.toString() === text ? { kind: "clean" } : { kind: "dirty" };
    if (noteState.kind === "dirty") {
      noteSaveTimer = setTimeout(() => {
        void saveNote();
      }, settings.autosaveMs);
    }
  } catch (error) {
    if (String(error).includes("409")) {
      noteState = { kind: "conflict" };
      showNotesConflict(text);
    } else {
      noteState = { kind: "error", message: String(error) };
    }
  }
  renderNoteStatus();
}

function renderNoteStatus() {
  const label = {
    loading: () => "Loading...",
    clean: () => "Saved",
    dirty: () => "Unsaved changes",
    saving: () => "Saving...",
    conflict: () => "Save failed: conflict",
    "syntax-error": () => "Fix annotation syntax",
    error: () => `Save failed: ${noteState.message}`,
  }[noteState.kind]();
  notesStatusEl.textContent = label;
  notesStatusEl.title = label;
  notesStatusEl.classList.toggle("error", noteState.kind === "error" || noteState.kind === "conflict" || noteState.kind === "syntax-error");
  notesSaveBtn.disabled = noteState.kind === "loading" || noteState.kind === "saving" || noteState.kind === "conflict" || noteState.kind === "syntax-error";
  notesPathEl.textContent = noteFilename();
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
  const parsed = parseAnnotationDocument(text);
  if (parsed.error !== null) {
    setAnnotationSyntaxError(parsed.error);
    notesPreviewEl.replaceChildren();
    return;
  }
  // Annotation fenced divs are rewritten to plain markdown so the preview shows
  // the quoted passage + comment instead of raw ::: fences.
  const rendered = marked.parse(previewMarkdown(text), { gfm: true, async: false });
  const fragment = DOMPurify.sanitize(rendered, { RETURN_DOM_FRAGMENT: true });
  notesPreviewEl.replaceChildren(fragment);
  // Clip images are note-relative ("../clips/<paper-key>/clip-01.png"); in the
  // reader they resolve through the backend asset route.
  for (const img of notesPreviewEl.querySelectorAll("img")) {
    const src = img.getAttribute("src");
    if (src !== null && !/^[a-z][a-z0-9+.-]*:/i.test(src)) {
      const segments = src.split("/");
      const filename = segments[segments.length - 1];
      if (filename !== undefined && filename.length > 0 && libraryKey) {
        img.src = noteAssetUrl(libraryKey, filename);
      }
    }
  }
}

function showNotesError(message) {
  notesErrorEl.textContent = message;
  notesErrorEl.hidden = false;
}

function noteFilename() {
  return libraryKey ? libraryKey.replace(/\.pdf$/, ".md") : "";
}

function setAnnotationSyntaxError(error) {
  noteState = { kind: "syntax-error", message: String(error) };
  showNotesError(`Fix annotation syntax in the Markdown note:\n${error.message}`);
  renderNoteStatus();
}
// ---------- Library: backend-backed list / open / trash ----------
function localReaderUrl(key) {
  const url = new URL(chrome.runtime.getURL("reader/reader.html"));
  url.searchParams.set("key", key);
  return url;
}

function libraryEntryOpenHref(entry) {
  if (entry.pdf_url !== undefined) {
    return entry.pdf_url;
  }
  return localReaderUrl(entry.key).href;
}

async function refreshLibrary() {
  try {
    const [backendStatus, entries] = await Promise.all([getBackendStatus(), getLibrary()]);
    renderLibrary(backendStatus, entries);
  } catch (error) {
    libraryListEl.innerHTML = "";
    const panel = document.createElement("div");
    panel.className = "library-error";
    panel.setAttribute("role", "alert");
    panel.textContent = `Could not load the library from the MathRead backend:\n${error}`;
    libraryListEl.append(panel);
  }
}

function renderLibrary(backendStatus, entries) {
  libraryListEl.innerHTML = "";
  appendLibraryLocation(backendStatus);
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
    item.dataset.mathreadKey = entry.key;

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
      window.top.location.href = libraryEntryOpenHref(entry);
    });

    const trash = document.createElement("button");
    trash.className = "library-entry-trash";
    trash.dataset.testid = "library-entry-trash";
    trash.title = "Trash - deletes the PDF and its notes";
    trash.textContent = "🗑";
    trash.addEventListener("click", () => {
      if (!confirm(`Trash "${entry.title}"?\n\nThis deletes the stored PDF, its notes, and its images.`)) {
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

function appendLibraryLocation(backendStatus) {
  const section = document.createElement("section");
  section.className = "library-location";
  section.setAttribute("aria-label", "Library storage location");

  const heading = document.createElement("div");
  heading.className = "library-location-heading";
  heading.textContent = "Library storage";

  const rootButton = document.createElement("button");
  rootButton.className = "library-location-open";
  rootButton.type = "button";
  rootButton.dataset.testid = "library-open-root";
  rootButton.disabled = !backendStatus.capabilities.open_root;
  rootButton.title = backendStatus.capabilities.open_root
    ? "Open library folder"
    : "Library folder is not available";

  const rootLabel = document.createElement("span");
  rootLabel.className = "library-location-label";
  rootLabel.dataset.testid = "library-location-label";
  rootLabel.textContent = "Library folder";
  const rootPath = document.createElement("span");
  rootPath.className = "library-location-path";
  rootPath.dataset.testid = "library-folder-path";
  rootPath.textContent = backendStatus.root;
  rootButton.append(rootLabel, rootPath);

  const openStatus = document.createElement("div");
  openStatus.className = "library-location-status";
  openStatus.setAttribute("role", "status");

  rootButton.addEventListener("click", () => {
    rootButton.disabled = true;
    openStatus.classList.remove("error");
    openStatus.textContent = "Opening...";
    void openLibraryRoot()
      .then(() => {
        openStatus.textContent = "Opened";
      })
      .catch(error => {
        openStatus.classList.add("error");
        openStatus.textContent = `Open failed: ${error}`;
      })
      .finally(() => {
        rootButton.disabled = !backendStatus.capabilities.open_root;
      });
  });

  section.append(heading, rootButton, openStatus);
  libraryListEl.append(section);
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
  if (action === "copy-view-link") {
    void copyViewLink();
    return;
  }
  if (action === "copy-plain-link") {
    void copyPlainLink();
    return;
  }
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
    flashTitle("Report an issue - not wired in this build");
  } else {
    flashTitle(`"${action}" - not wired in this build`);
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
  setStatusMessage(citeBodyEl, "cite-status", "Looking up citation...");
  try {
    const record = await resolveScholarRecord();
    if (!record) {
      setStatusMessage(citeBodyEl, "cite-status", "Article not found in Scholar.");
      return;
    }
    const url = `https://scholar.google.com/scholar?q=info:${encodeURIComponent(record.infoId)}`
      + `:scholar.google.com/&oi=gsr&output=gsb-cite&hl=en`;
    const data = await (await fetch(url, { credentials: "include" })).json();
    renderCitation(data);
    citeLoaded = true;
  } catch (error) {
    setStatusMessage(
      citeBodyEl,
      "cite-status",
      "Citation lookup failed. Google Scholar may require you to be signed in, or may be rate-limiting requests.",
    );
    throw readerError("MATHREAD-READER-CITE-ERROR", error);
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
    setStatusMessage(citeBodyEl, "cite-status", "Google Scholar returned no citation for this document.");
  }
}

function configureArxivButton(url) {
  const arxivPageUrl = arxivAbstractUrl(url);
  openArxivBtn.hidden = arxivPageUrl === null;
  if (arxivPageUrl !== null) {
    openArxivBtn.dataset.arxivUrl = arxivPageUrl;
  } else {
    delete openArxivBtn.dataset.arxivUrl;
  }
}

function openArxivPage() {
  const url = openArxivBtn.dataset.arxivUrl;
  if (url !== undefined) {
    window.open(url, "_blank", "noopener");
  }
}

const arxivSourcePath = new RegExp(
  "^/(?:pdf|abs)/" +
    "(" +
    "(?:" +
    "(?:07(?:0[4-9]|1[0-2])|(?:0[89]|1[0-4])(?:0[1-9]|1[0-2]))\\.(?!0000)\\d{4}" +
    "|(?:1[5-9]|[2-9]\\d)(?:0[1-9]|1[0-2])\\.(?!00000)\\d{5}" +
    "|[a-z][a-z0-9-]*(?:\\.[A-Z]{2})?/(?!0000000)\\d{7}" +
    ")" +
    "(?:v[1-9]\\d*)?" +
    ")" +
    "(?:\\.pdf)?$",
);

function arxivAbstractUrl(url) {
  if (!URL.canParse(url)) {
    return null;
  }
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return null;
  }
  if (parsed.hostname !== "arxiv.org" && parsed.hostname !== "www.arxiv.org") {
    return null;
  }
  const match = parsed.pathname.match(arxivSourcePath);
  if (match === null || match[1] === undefined) {
    return null;
  }
  return `https://arxiv.org/abs/${match[1]}`;
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
  setStatusMessage(scholarMenuEl, "scholar-menu-status", "Looking up...");
  try {
    const record = await resolveScholarRecord();
    if (!record || record.links.length === 0) {
      setStatusMessage(scholarMenuEl, "scholar-menu-status", "Article not found in Scholar.");
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
    setStatusMessage(scholarMenuEl, "scholar-menu-status", "Lookup failed. Sign in to Google Scholar, or try again later.");
    throw readerError("MATHREAD-READER-SCHOLAR-ERROR", error);
  }
}

// ---------- View links ----------
function sourceLinkUrl() {
  if (libraryEntry === null) {
    return null;
  }
  if (libraryEntry.pdf_url === undefined) {
    return localReaderUrl(libraryEntry.key);
  }
  return new URL(libraryEntry.pdf_url);
}

function currentViewCoordinates() {
  const pageView = pdfViewer.getPageView(currentPageNumber - 1);
  assert(pageView !== undefined, "MathRead reader current page is unavailable");
  const [x, y] = pageView.getPagePoint(
    viewerEl.scrollLeft - pageView.div.offsetLeft,
    viewerEl.scrollTop - pageView.div.offsetTop,
  );
  return { x: Math.round(x), y: Math.round(y) };
}

function serializedCurrentView(viewport) {
  return `v1:${currentPageNumber}:${viewport.x}:${viewport.y}:${scale.toFixed(2)}`;
}

function currentViewUrl() {
  const url = sourceLinkUrl();
  if (url === null) {
    return null;
  }
  const viewport = currentViewCoordinates();
  if (libraryEntry.pdf_url === undefined) {
    url.searchParams.set("page", String(currentPageNumber));
    url.searchParams.set("mrx", String(viewport.x));
    url.searchParams.set("mry", String(viewport.y));
    url.searchParams.set("zoom", scale.toFixed(2));
    return url.href;
  }
  const sourceUrl = url.href;
  url.searchParams.append("mathread-link", `v1.${btoa(serializedCurrentView(viewport))}`);
  url.searchParams.append("mathread-source", `v1.${btoa(sourceUrl)}`);
  return url.href;
}

function plainLinkUrl() {
  const url = sourceLinkUrl();
  return url === null ? null : url.href;
}

async function copyViewLink() {
  const viewUrl = currentViewUrl();
  if (viewUrl === null) {
    flashTitle("No document open to link");
    return;
  }
  await navigator.clipboard.writeText(viewUrl);
  flashTitle("Copied current view link");
}

async function copyPlainLink() {
  const plainUrl = plainLinkUrl();
  if (plainUrl === null) {
    flashTitle("No document open to link");
    return;
  }
  await navigator.clipboard.writeText(plainUrl);
  flashTitle("Copied plain link");
}

// ---------- Screen clipping: drag a region into the notes as an image ----------
notesClipBtn.addEventListener("click", () => startClip());

let clipDragStart = null;

function startClip() {
  if (!libraryKey || !pdfDoc) {
    flashTitle("Open a document to clip");
    return;
  }
  notesClipBtn.classList.add("clipping");
  clipOverlayEl.hidden = false;
  clipRectEl.style.width = "0px";
  clipRectEl.style.height = "0px";
}

function endClip() {
  notesClipBtn.classList.remove("clipping");
  clipOverlayEl.hidden = true;
  clipDragStart = null;
}

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !clipOverlayEl.hidden) {
    endClip();
  }
});

clipOverlayEl.addEventListener("mousedown", event => {
  event.preventDefault();
  clipDragStart = { x: event.clientX, y: event.clientY };
  positionClipRect(event.clientX, event.clientY);
});

clipOverlayEl.addEventListener("mousemove", event => {
  if (clipDragStart !== null) {
    positionClipRect(event.clientX, event.clientY);
  }
});

clipOverlayEl.addEventListener("mouseup", event => {
  if (clipDragStart === null) {
    return;
  }
  const region = {
    left: Math.min(clipDragStart.x, event.clientX),
    top: Math.min(clipDragStart.y, event.clientY),
    width: Math.abs(event.clientX - clipDragStart.x),
    height: Math.abs(event.clientY - clipDragStart.y),
  };
  endClip();
  if (region.width < 8 || region.height < 8) {
    return;
  }
  void captureClip(region).catch(error => {
    flashTitle(`Clip failed: ${error}`);
    throw readerError("MATHREAD-CLIP-ERROR", error);
  });
});

function positionClipRect(x, y) {
  const left = Math.min(clipDragStart.x, x);
  const top = Math.min(clipDragStart.y, y);
  clipRectEl.style.left = `${left}px`;
  clipRectEl.style.top = `${top}px`;
  clipRectEl.style.width = `${Math.abs(x - clipDragStart.x)}px`;
  clipRectEl.style.height = `${Math.abs(y - clipDragStart.y)}px`;
}

/** Compose the selected viewport region from the rendered page canvases into a PNG,
 * upload it as a note asset, and append a markdown image whose alt text is the view URL. */
async function captureClip(region) {
  const out = document.createElement("canvas");
  const context = out.getContext("2d");
  let pixelRatio = null;

  for (const entry of pageContainers) {
    const canvas = entry.pageDiv.querySelector("canvas");
    if (!(canvas instanceof HTMLCanvasElement)) {
      continue;
    }
    const rect = canvas.getBoundingClientRect();
    const overlapLeft = Math.max(region.left, rect.left);
    const overlapTop = Math.max(region.top, rect.top);
    const overlapRight = Math.min(region.left + region.width, rect.right);
    const overlapBottom = Math.min(region.top + region.height, rect.bottom);
    if (overlapRight <= overlapLeft || overlapBottom <= overlapTop) {
      continue;
    }
    if (pixelRatio === null) {
      pixelRatio = canvas.width / rect.width;
      out.width = Math.round(region.width * pixelRatio);
      out.height = Math.round(region.height * pixelRatio);
      context.fillStyle = "#fff";
      context.fillRect(0, 0, out.width, out.height);
    }
    context.drawImage(
      canvas,
      (overlapLeft - rect.left) * pixelRatio,
      (overlapTop - rect.top) * pixelRatio,
      (overlapRight - overlapLeft) * pixelRatio,
      (overlapBottom - overlapTop) * pixelRatio,
      (overlapLeft - region.left) * pixelRatio,
      (overlapTop - region.top) * pixelRatio,
      (overlapRight - overlapLeft) * pixelRatio,
      (overlapBottom - overlapTop) * pixelRatio,
    );
  }
  if (pixelRatio === null) {
    flashTitle("Clip missed the document");
    return;
  }

  const blob = await new Promise(resolve => out.toBlob(resolve, "image/png"));
  if (blob === null) {
    throw new Error("Could not encode the clipped region as PNG");
  }
  const relativePath = await postNoteImage(libraryKey, blob);

  await initNotes();
  if (!aiView) {
    throw new Error("Notes editor unavailable; clip was uploaded but not inserted");
  }
  const viewUrl = currentViewUrl();
  const altText = viewUrl === null ? "clip" : viewUrl;
  const docLength = aiView.state.doc.length;
  const prefix = docLength === 0 ? "" : "\n";
  aiView.dispatch({
    changes: { from: docLength, insert: `${prefix}![${altText}](${relativePath})\n` },
  });
  activateTab("keypoints");
  flashTitle("Clip added to notes");
}

// ---------- Small helpers ----------
function toggleSidebar(force) {
  const open = force ?? !sidebarEl.classList.contains("open");
  sidebarEl.classList.toggle("open", open);
  $("toggle-sidebar").classList.toggle("active", open);
}

function scrollToPage(target) {
  if (!Number.isInteger(target) || pdfViewer.pagesCount === 0) {
    return;
  }
  const pageNumber = Math.min(pdfViewer.pagesCount, Math.max(1, target));
  pdfViewer.currentPageNumber = pageNumber;
  pdfViewer.scrollPageIntoView({ pageNumber });
}

function jumpPage(delta) {
  scrollToPage(currentPageNumber + delta);
}

function isEditableTarget(target) {
  return target instanceof HTMLElement
    && (target.isContentEditable || target.closest("input, textarea, [contenteditable='true'], .cm-editor") !== null);
}

function observePdfHistoryEntry(state) {
  if (
    pdfHistoryFingerprint === null
    || state === null
    || typeof state !== "object"
    || state.fingerprint !== pdfHistoryFingerprint
    || !Number.isInteger(state.uid)
    || state.uid < 0
  ) {
    return null;
  }
  greatestPdfHistoryUid = Math.max(greatestPdfHistoryUid, state.uid);
  return state.uid;
}

function canTraversePdfHistory(direction) {
  const uid = observePdfHistoryEntry(window.history.state);
  if (uid === null) {
    return false;
  }
  return direction === "back" ? uid > 0 : uid < greatestPdfHistoryUid;
}

window.addEventListener("popstate", event => {
  observePdfHistoryEntry(event.state);
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !clipOverlayEl.hidden) {
    endClip();
    return;
  }
  if (event.defaultPrevented || isEditableTarget(event.target) || pdfDoc === null) {
    return;
  }
  if (
    event.altKey
    && !event.ctrlKey
    && !event.metaKey
    && event.key === "ArrowLeft"
    && canTraversePdfHistory("back")
  ) {
    pdfHistory.back();
    event.preventDefault();
    return;
  }
  if (
    event.altKey
    && !event.ctrlKey
    && !event.metaKey
    && event.key === "ArrowRight"
    && canTraversePdfHistory("forward")
  ) {
    pdfHistory.forward();
    event.preventDefault();
    return;
  }
  if (event.ctrlKey || event.metaKey) {
    if (event.key === "=" || event.key === "+") {
      setScale(scale * 1.1);
    } else if (event.key === "-") {
      setScale(scale / 1.1);
    } else if (event.key === "0") {
      setScale(1);
    } else if (event.key.toLowerCase() === "f") {
      toggleSearch(true);
    } else {
      return;
    }
    event.preventDefault();
    return;
  }
  if (event.altKey) {
    return;
  }
  const pageDelta = event.key === "PageDown" || event.key === "ArrowDown" || event.key === "ArrowRight"
    ? 1
    : event.key === "PageUp" || event.key === "ArrowUp" || event.key === "ArrowLeft"
      ? -1
      : 0;
  if (pageDelta !== 0) {
    jumpPage(pageDelta);
  } else if (event.key === "Home") {
    scrollToPage(1);
  } else if (event.key === "End") {
    scrollToPage(pdfViewer.pagesCount);
  } else {
    return;
  }
  event.preventDefault();
});

viewerEl.addEventListener("wheel", event => {
  if (!(event.ctrlKey || event.metaKey) || pdfDoc === null) {
    return;
  }
  event.preventDefault();
  setScale(scale * (event.deltaY < 0 ? 1.1 : 1 / 1.1));
}, { passive: false });

async function downloadPdf() {
  if (pdfData === null || libraryKey === null) {
    flashTitle("No document open to download");
    return;
  }
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

// Every annotation mutation routes through the notes editor doc, so the existing
// autosave state machine owns persistence and the note file stays the single store.
// Full-doc replace resets the editor cursor; acceptable - mutations originate from
// the PDF pane, not mid-typing.
function mutateNote(transform) {
  if (!aiView) {
    flashTitle("Notes unavailable - annotation not saved");
    return;
  }
  const doc = aiView.state.doc.toString();
  const parsed = parseAnnotationDocument(doc);
  if (parsed.error !== null) {
    setAnnotationSyntaxError(parsed.error);
    flashTitle("Fix annotation syntax before changing annotations");
    return;
  }
  const next = transform(doc);
  if (next !== doc) {
    aiView.dispatch({ changes: { from: 0, to: doc.length, insert: next } });
  }
}

// Re-derive highlights from the note doc (the only writer of `highlights`), so
// hand-edited annotation blocks re-render on the fly like UI-created ones.
function refreshAnnotations() {
  const parsed = parseAnnotationDocument(aiView ? aiView.state.doc.toString() : "");
  if (parsed.error !== null) {
    highlights = [];
    setAnnotationSyntaxError(parsed.error);
    drawStoredHighlights();
    renderSidebarList();
    return false;
  }
  if (noteState.kind === "syntax-error") {
    notesErrorEl.hidden = true;
    notesErrorEl.textContent = "";
  }
  highlights = parsed.annotations;
  drawStoredHighlights();
  renderSidebarList();
  return true;
}

// One-time import of the older localStorage highlight store.
function migrateLegacyHighlights() {
  const raw = localStorage.getItem(legacyStorageKey);
  if (raw === null) {
    return;
  }
  const legacy = JSON.parse(raw);
  if (!Array.isArray(legacy)) {
    flashTitle("Legacy highlights were not migrated");
    return;
  }
  const annotations = legacy.map(parseLegacyHighlight);
  if (annotations.some(annotation => annotation === null)) {
    flashTitle("Legacy highlights were not migrated");
    return;
  }
  mutateNote(doc =>
    annotations.reduce((text, annotation) => upsertAnnotation(text, annotation), doc),
  );
  pendingLegacyMigrationStorageKey = legacyStorageKey;
}

function parseLegacyHighlight(value) {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  if (
    typeof value.id !== "string"
    || !Number.isInteger(value.pageNumber)
    || value.pageNumber < 1
    || typeof value.color !== "string"
    || typeof value.createdAt !== "string"
    || !Array.isArray(value.rects)
    || typeof value.text !== "string"
    || typeof value.comment !== "string"
  ) {
    return null;
  }
  const created = new Date(value.createdAt);
  if (!Number.isFinite(created.getTime())) {
    return null;
  }
  const rects = value.rects.map(parseLegacyRect);
  if (rects.some(rect => rect === null)) {
    return null;
  }
  return {
    id: value.id,
    pageNumber: value.pageNumber,
    color: value.color,
    created: created.toISOString(),
    rects,
    text: value.text,
    comment: value.comment,
  };
}

function parseLegacyRect(value) {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const { xPct, yPct, wPct, hPct } = value;
  if (
    !Number.isFinite(xPct)
    || !Number.isFinite(yPct)
    || !Number.isFinite(wPct)
    || !Number.isFinite(hPct)
  ) {
    return null;
  }
  return { xPct, yPct, wPct, hPct };
}

function setDocumentControlsEnabled(enabled) {
  for (const id of documentControlIds) {
    const control = document.getElementById(id);
    if (control instanceof HTMLButtonElement || control instanceof HTMLInputElement) {
      control.disabled = !enabled;
    }
  }
}
