import { useCallback, useEffect, useRef, useState } from 'react';
import { PanelLeftClose, PanelLeftOpen, Save } from 'lucide-react';
import { MenuBar } from './components/MenuBar';
import { LibrarySidebar } from './components/LibrarySidebar';
import { Editor } from './components/Editor';
import { Preview } from './components/Preview';
// PdfPane replaced with iframe to vendor viewer for full PDF.js features
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './components/ui/alert-dialog';
import {
  deleteLibraryEntry,
  getLibrary,
  getNote,
  overwriteNote,
  putNote,
  postReadEvent,
  pdfUrl,
  type LibraryEntry,
} from './api';

// Persisted UI state: collapse the notes pane to read the PDF full-width.
const EDITOR_COLLAPSED_KEY = 'mathread.portal.editorCollapsed';

function failPortal(context: string, error: unknown): never {
  throw new Error(`${context}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
}

export default function App() {
  const [library, setLibrary] = useState<LibraryEntry[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [savedNote, setSavedNote] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [noteVersion, setNoteVersion] = useState('');
  const [editorCollapsed, setEditorCollapsed] = useState(
    () => localStorage.getItem(EDITOR_COLLAPSED_KEY) === 'true',
  );
  const [pendingDeleteKey, setPendingDeleteKey] = useState<string | null>(null);
  const [capturingPdfUrl, setCapturingPdfUrl] = useState<string | null>(null);

  const dirty = note !== savedNote;
  const selectedEntry = library.find((e) => e.key === selectedKey);
  const pendingDeleteEntry = library.find((e) => e.key === pendingDeleteKey);

  const refreshLibrary = useCallback(() => {
    getLibrary().then(setLibrary).catch((err) => failPortal('library load failed', err));
  }, []);

  useEffect(refreshLibrary, [refreshLibrary]);

  useEffect(() => {
    localStorage.setItem(EDITOR_COLLAPSED_KEY, String(editorCollapsed));
  }, [editorCollapsed]);

  // Warn before losing unsaved edits.
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // Flush the current note to the backend immediately (manual Save + autosave both use this).
  const saveNote = useCallback(() => {
    if (selectedKey === null) return;
    const text = note;
    setSaving(true);
    putNote(selectedKey, text, noteVersion)
      .then((res) => {
        setSavedNote(text);
        if (res.version) {
          setNoteVersion(res.version);
        } else {
          setNoteVersion('');
        }
      })
      .catch((err) => {
        if (String(err).includes('409')) {
          const overwrite = window.confirm(
            "Conflict: Note modified elsewhere. Click OK to overwrite disk, or Cancel to reload note from disk."
          );
          if (overwrite) {
            overwriteNote(selectedKey, text)
              .then((res) => {
                setSavedNote(text);
                if (res.version) {
                  setNoteVersion(res.version);
                } else {
                  setNoteVersion('');
                }
              })
              .catch((err2) => failPortal('note save failed', err2));
          } else {
            getNote(selectedKey)
              .then((res) => {
                setNote(res.text);
                setSavedNote(res.text);
                if (res.version) {
                  setNoteVersion(res.version);
                } else {
                  setNoteVersion('');
                }
              })
              .catch((err2) => failPortal('note reload failed', err2));
          }
        } else {
          failPortal('note save failed', err);
        }
      })
      .finally(() => setSaving(false));
  }, [note, selectedKey, noteVersion]);

  // Debounced autosave of the markdown note.
  useEffect(() => {
    if (!dirty || selectedKey === null) return;
    const timer = setTimeout(saveNote, 800);
    return () => clearTimeout(timer);
  }, [dirty, selectedKey, saveNote]);

  async function confirmDelete() {
    const key = pendingDeleteKey;
    if (key === null) return;
    setPendingDeleteKey(null);
    try {
      await deleteLibraryEntry(key);
    } catch (err) {
      failPortal('delete failed', err);
    }
    if (key === selectedKey) {
      setSelectedKey(null);
      setNote('');
      setSavedNote('');
    }
    refreshLibrary();
  }

  // Auto-open a ?key= deep-link (from the capture extension) once its entry is in the library.
  const deepLinkOpened = useRef(false);

  const openEntry = useCallback(async (key: string) => {
    if (dirty && selectedKey !== null) {
      const res = await putNote(selectedKey, note, noteVersion); // flush before switching
      setSavedNote(note);
      if (res.version) {
        setNoteVersion(res.version);
      } else {
        setNoteVersion('');
      }
    }
    const res = await getNote(key);
    setSelectedKey(key);
    setNote(res.text);
    setSavedNote(res.text);
    if (res.version) {
      setNoteVersion(res.version);
    } else {
      setNoteVersion('');
    }
    setIsSidebarOpen(false);
    const entry = library.find((e) => e.key === key);
    postReadEvent(key, entry ? entry.last_position : 0)
      .then(refreshLibrary)
      .catch((err) => failPortal('read event failed', err));
  }, [dirty, selectedKey, note, noteVersion, library, refreshLibrary]);

  // Poll for capture completion when a PDF URL is being captured.
  useEffect(() => {
    if (capturingPdfUrl === null || library.length === 0) return;

    const match = library.find((e) => e.pdf_url === capturingPdfUrl);
    if (match) {
      setCapturingPdfUrl(null);
      void openEntry(match.key);
      return;
    }

    const timer = setTimeout(refreshLibrary, 500);
    return () => clearTimeout(timer);
  }, [capturingPdfUrl, library, openEntry, refreshLibrary]);

  useEffect(() => {
    if (deepLinkOpened.current || library.length === 0) return;
    
    const params = new URLSearchParams(window.location.search);
    const key = params.get('key');
    const file = params.get('file');
    
    // Handle direct key deep-link (already captured PDF)
    if (key !== null) {
      if (!library.some((e) => e.key === key)) return;
      deepLinkOpened.current = true;
      void openEntry(key);
      return;
    }
    
    // Handle PDF URL (capture flow from DNR redirect)
    if (file !== null) {
      deepLinkOpened.current = true;
      // Check if already captured
      const existing = library.find((e) => e.pdf_url === file);
      if (existing) {
        void openEntry(existing.key);
      } else {
        // Show the PDF immediately using the original URL
        // Capture happens in background (via capture-ui.ts in the vendor viewer)
        setCapturingPdfUrl(file);
        // We'll switch to the captured version once it's ready
      }
      return;
    }
    
    // No deep link
    deepLinkOpened.current = true;
  }, [library, openEntry]);

  const expandNotesButton = (
    <button
      onClick={() => setEditorCollapsed(false)}
      title="Show notes"
      className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-zinc-200 text-zinc-700 hover:bg-zinc-300 transition-colors shrink-0"
    >
      <PanelLeftOpen className="w-3.5 h-3.5" /> Notes
    </button>
  );

  return (
    <div className="h-screen w-screen flex flex-col bg-zinc-950 text-zinc-50 overflow-hidden font-sans selection:bg-blue-500/30">
      <MenuBar onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)} />

      <div className="flex-1 flex relative overflow-hidden">
        <LibrarySidebar
          entries={library}
          selectedKey={selectedKey}
          onSelect={openEntry}
          onRequestDelete={setPendingDeleteKey}
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
        />

        <div className="flex-1 flex w-full h-full relative">
          {!editorCollapsed && (
            <div className="w-1/2 h-full border-r border-zinc-800 flex flex-col relative z-0">
              <div className="px-4 py-2 border-b border-zinc-800 flex items-center justify-between text-xs shrink-0 gap-2">
                <span className="truncate text-zinc-300">{selectedEntry ? selectedEntry.title : 'No PDF selected'}</span>
                <div className="flex items-center gap-3 shrink-0">
                  {selectedKey !== null && (
                    <>
                      <span className={dirty || saving ? 'text-amber-400' : 'text-emerald-500'}>
                        {saving ? 'Saving…' : dirty ? 'Unsaved' : 'Saved'}
                      </span>
                      <button
                        onClick={saveNote}
                        disabled={!dirty || saving}
                        title="Save note now"
                        className="flex items-center gap-1 px-2 py-1 rounded bg-zinc-800 text-zinc-200 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-default transition-colors"
                      >
                        <Save className="w-3.5 h-3.5" /> Save
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => setEditorCollapsed(true)}
                    title="Collapse notes — read the PDF full-width"
                    className="p-1 rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
                  >
                    <PanelLeftClose className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <Editor value={note} onChange={setNote} />
            </div>
          )}

          <div className={`${editorCollapsed ? 'w-full' : 'w-1/2'} h-full flex flex-col relative z-0 bg-white`}>
            {selectedKey !== null || capturingPdfUrl !== null ? (
              <>
                <div className="px-4 py-2 border-b border-zinc-200 flex items-center justify-between bg-zinc-50 shrink-0 gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {editorCollapsed && expandNotesButton}
                    <span className="text-xs text-zinc-500 truncate">
                      {selectedEntry ? selectedEntry.title : capturingPdfUrl ? 'Capturing PDF...' : ''}
                    </span>
                  </div>
                  {/* Clip mode temporarily disabled - requires integration with iframed viewer */}
                </div>
                <iframe
                  src={
                    selectedKey !== null
                      ? `../../content/web/viewer.html?file=${encodeURIComponent(pdfUrl(selectedKey))}`
                      : `../../content/web/viewer.html?file=${encodeURIComponent(capturingPdfUrl!)}`
                  }
                  className="w-full h-full border-0"
                  title="PDF Viewer"
                />
              </>
            ) : (
              <>
                {editorCollapsed && (
                  <div className="px-4 py-2 border-b border-zinc-200 bg-zinc-50 shrink-0">{expandNotesButton}</div>
                )}
                <div className="flex-1 overflow-auto">
                  <Preview markdown={note !== '' ? note : '_Open a PDF from the library (top-left menu) to start a note._'} />
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <AlertDialog open={pendingDeleteKey !== null} onOpenChange={(open) => !open && setPendingDeleteKey(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Trash this item?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDeleteEntry
                ? `“${pendingDeleteEntry.title}” — its PDF, notes, and clipped images will be permanently removed.`
                : 'This item, its notes, and clipped images will be permanently removed.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-red-600 text-white hover:bg-red-500"
            >
              Trash it
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
