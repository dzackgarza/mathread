/**
 * MathRead reader overlay (issue #39): the Scholar-style sidebar rebuilt from
 * the portal component library. Composes the owned surfaces — notes editor
 * with live half/half preview, library list — as standalone React components
 * injected beside the vendored PDF.js viewer. Reference for layout and
 * behavior: the pre-e8ceaf5 reader (repo history) and the Scholar reader.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BookOpen, Library, PanelRightClose, StickyNote } from "lucide-react";
import {
  deleteLibraryEntry,
  getLibrary,
  getNote,
  openLibraryRoot,
  overwriteNote,
  saveNote,
} from "./backend";

import type { LibraryEntry } from "../mathread/portal/api";
import { upsertAnnotation } from "./annotations";
import { HighlightController } from "./highlights";
import {
  type NoteStore,
  type OverlayDocument,
  NotesPanel,
  useNote,
} from "./notes-module";

// The extension wiring: the module's persistence boundary is the real backend.
const backendNoteStore: NoteStore = { getNote, saveNote, overwriteNote };

type Tab = "notes" | "library" | null;



export function mountOverlay(
  host: HTMLElement,
  options: { initialTab: Tab },
): {
  setDocument(doc: OverlayDocument): void;
} {
  // React renders asynchronously: the component's register effect may run
  // after the first setDocument call, so the document is buffered until the
  // channel exists.
  let publish: ((doc: OverlayDocument) => void) | null = null;
  let buffered: OverlayDocument | null = null;
  const root = createRoot(host);
  root.render(
    <OverlayApp
      initialTab={options.initialTab}
      register={(setter) => {
        publish = setter;
        if (buffered !== null) {
          setter(buffered);
        }
      }}
    />,
  );
  return {
    setDocument(doc) {
      buffered = doc;
      if (publish !== null) {
        publish(doc);
      }
    },
  };
}

function OverlayApp({
  initialTab,
  register,
}: {
  initialTab: Tab;
  register: (setter: (doc: OverlayDocument) => void) => void;
}) {
  const [doc, setDoc] = useState<OverlayDocument | null>(null);
  const [tab, setTab] = useState<Tab>(initialTab);
  const noteApi = useNote(doc, backendNoteStore);
  const navRef = useRef<HTMLElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  useEffect(() => {
    register(setDoc);
  }, [register]);

  // Dismiss the open panel (notes editor or library) when the pointer goes down
  // outside it and the tab rail. The overlay root is pointer-events-none, so a
  // click on the PDF is not the target — but it still bubbles to document, where
  // this listener sees it. mousedown (not click) closes before focus moves; the
  // effect is added after the tab opens, so the opening click never self-closes.
  useEffect(() => {
    if (tab === null) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      const nav = navRef.current;
      const sidebar = sidebarRef.current;
      if ((nav !== null && nav.contains(target)) || (sidebar !== null && sidebar.contains(target))) {
        return;
      }
      setTab(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [tab]);

  return (
    <div className="mathread-overlay-root pointer-events-none fixed inset-0 z-[2147483000] flex justify-end font-sans">
      <HighlightController
        noteText={noteApi.note.kind === "open" ? noteApi.note.text : null}
        commit={(annotation, focusComment) => {
          noteApi.applyExternal((text) => upsertAnnotation(text, annotation));
          if (focusComment) {
            setTab("notes");
          }
        }}
      />
      <nav ref={navRef} className="pointer-events-auto mr-2 mt-14 flex h-fit flex-col gap-2 self-start">
        <OverlayTabButton
          label="Notes"
          active={tab === "notes"}
          onClick={() => setTab(tab === "notes" ? null : "notes")}
          icon={<StickyNote size={16} />}
          testid="overlay-tab-notes"
        />
        <OverlayTabButton
          label="Library"
          active={tab === "library"}
          onClick={() => setTab(tab === "library" ? null : "library")}
          icon={<Library size={16} />}
          testid="overlay-tab-library"
        />
      </nav>
      {tab !== null && (
        <aside
          ref={sidebarRef}
          data-testid="overlay-sidebar"
          className="pointer-events-auto flex h-full w-[min(52rem,60vw)] flex-col border-l border-zinc-800 bg-zinc-950 text-zinc-100 shadow-2xl"
        >
          <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
              {tab === "notes" ? "Key Points" : "Library"}
            </h2>
            <button
              type="button"
              id="mathread-close-panel"
              data-testid="overlay-close"
              aria-label="Close panel"
              className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              onClick={() => setTab(null)}
            >
              <PanelRightClose size={16} />
            </button>
          </header>
          {tab === "notes" ? <NotesPanel doc={doc} noteApi={noteApi} /> : <LibraryPanel />}
        </aside>
      )}
    </div>
  );
}

function OverlayTabButton({
  label,
  active,
  onClick,
  icon,
  testid,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  testid: string;
}) {
  return (
    <button
      type="button"
      data-testid={testid}
      data-tab={label.toLowerCase()}
      aria-pressed={active}
      onClick={onClick}
      className={`nav-expand-btn flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium shadow-lg backdrop-blur ${
        active
          ? "border-amber-500/60 bg-amber-500/20 text-amber-200"
          : "border-zinc-700 bg-zinc-900/90 text-zinc-300 hover:bg-zinc-800"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

export function LibraryPanel() {
  const [entries, setEntries] = useState<readonly LibraryEntry[] | null>(null);

  const refresh = useCallback(() => {
    void getLibrary().then((loaded) => setEntries(loaded));
  }, []);
  useEffect(refresh, [refresh]);

  if (entries === null) {
    return (
      <p className="p-4 text-sm text-zinc-500">Loading library…</p>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto p-2">
      <button
        type="button"
        data-testid="library-open-root"
        className="mb-2 flex items-center gap-2 rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
        onClick={() => void openLibraryRoot()}
      >
        <BookOpen size={14} /> Open library folder
      </button>
      {entries.map((entry) => (
        <article
          key={entry.key}
          data-testid="library-entry"
          className="flex items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-zinc-900"
        >
          {typeof entry.source_url === "string" && entry.source_url.length > 0 ? (
            <button
              type="button"
              data-testid="library-entry-open"
              className="library-entry-open truncate text-left text-sm text-zinc-200 hover:text-amber-200"
              onClick={() => {
                // A history link navigates the tab (top window from the iframe).
                window.top!.location.href = entry.source_url as string;
              }}
            >
              {entry.title}
            </button>
          ) : (
            <span className="library-entry-open truncate text-sm text-zinc-500">
              {entry.title}
            </span>
          )}
          <span className="shrink-0 text-xs text-zinc-500">
            {entry.has_note ? "📝" : ""}
          </span>
          <button
            type="button"
            data-testid="library-entry-trash"
            className="shrink-0 rounded border border-zinc-800 px-2 py-0.5 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            onClick={() => {
              if (confirm(`Trash ${entry.title}?`)) {
                void deleteLibraryEntry(entry.key).then(refresh);
              }
            }}
          >
            Trash
          </button>
        </article>
      ))}
    </div>
  );
}
