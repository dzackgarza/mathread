import { formatDistanceToNow } from 'date-fns';
import { FileText, StickyNote, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { LibraryEntry } from '../api';

interface LibrarySidebarProps {
  entries: LibraryEntry[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onRequestDelete: (key: string) => void;
  isOpen: boolean;
  onClose: () => void;
}

export function LibrarySidebar({ entries, selectedKey, onSelect, onRequestDelete, isOpen, onClose }: LibrarySidebarProps) {
  // Timeline order: most recently read first ("the PDF I was reading last Thursday").
  const timeline = [...entries].sort((a, b) => b.last_read.localeCompare(a.last_read));

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-30"
            onClick={onClose}
          />
          <motion.div
            initial={{ x: '-100%', opacity: 0.5 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '-100%', opacity: 0.5 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed top-12 left-0 bottom-0 w-72 bg-zinc-950/95 backdrop-blur-md border-r border-zinc-800 overflow-y-auto z-40 shadow-2xl flex flex-col"
          >
            <div className="p-4 border-b border-zinc-800/50 flex items-center justify-between sticky top-0 bg-zinc-950/95 backdrop-blur-sm z-10">
              <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Library</h2>
              <span className="text-xs text-zinc-600">{entries.length}</span>
            </div>
            <div className="py-2 flex-1 overflow-y-auto">
              {timeline.length === 0 && (
                <p className="px-4 py-6 text-sm text-zinc-500">No captured PDFs yet.</p>
              )}
              {timeline.map((entry) => (
                <div
                  key={entry.key}
                  data-testid="library-entry"
                  data-mathread-key={entry.key}
                  className={`group relative flex items-center transition-colors ${
                    selectedKey === entry.key ? 'bg-blue-500/10' : 'hover:bg-zinc-800/50'
                  }`}
                >
                  <button
                    onClick={() => onSelect(entry.key)}
                    data-testid="library-entry-open"
                    className={`flex-1 min-w-0 flex flex-col gap-1 px-4 py-2.5 text-left ${
                      selectedKey === entry.key ? 'text-blue-400' : 'text-zinc-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="w-4 h-4 shrink-0 text-blue-400/80" />
                      <span className="text-sm truncate">{entry.title}</span>
                      {entry.has_note && <StickyNote className="w-3.5 h-3.5 shrink-0 text-amber-400/80" />}
                    </div>
                    <span className="text-xs text-zinc-500 pl-6">
                      read {formatDistanceToNow(new Date(entry.last_read), { addSuffix: true })}
                    </span>
                  </button>
                  <button
                    onClick={() => onRequestDelete(entry.key)}
                    aria-label={`Trash ${entry.title}`}
                    title="Trash this item"
                    data-testid="library-entry-trash"
                    className="shrink-0 mr-2 p-2 rounded text-zinc-600 opacity-0 group-hover:opacity-100 hover:bg-red-500/15 hover:text-red-400 transition-all focus:opacity-100"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
