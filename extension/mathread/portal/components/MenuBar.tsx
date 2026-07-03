import { useState } from 'react';
import { Menu, Command } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface MenuBarProps {
  onToggleSidebar: () => void;
}

export function MenuBar({ onToggleSidebar }: MenuBarProps) {
  const [activeMenu, setActiveMenu] = useState<string | null>(null);

  const menus = [
    {
      name: 'File',
      items: [
        { label: 'New File', shortcut: '⌘N' },
        { label: 'Open File...', shortcut: '⌘O' },
        { divider: true },
        { label: 'Save', shortcut: '⌘S' },
        { label: 'Save As...', shortcut: '⇧⌘S' },
        { divider: true },
        { label: 'Export PDF', shortcut: '⌘E' }
      ]
    },
    {
      name: 'Edit',
      items: [
        { label: 'Undo', shortcut: '⌘Z' },
        { label: 'Redo', shortcut: '⇧⌘Z' },
        { divider: true },
        { label: 'Cut', shortcut: '⌘X' },
        { label: 'Copy', shortcut: '⌘C' },
        { label: 'Paste', shortcut: '⌘V' }
      ]
    },
    {
      name: 'View',
      items: [
        { label: 'Toggle Sidebar', shortcut: '⌘B' },
        { divider: true },
        { label: 'Zoom In', shortcut: '⌘+' },
        { label: 'Zoom Out', shortcut: '⌘-' },
        { label: 'Reset Zoom', shortcut: '⌘0' }
      ]
    },
    {
      name: 'Help',
      items: [
        { label: 'Markdown Guide', shortcut: 'F1' },
        { label: 'Keyboard Shortcuts', shortcut: '⌘/' },
        { divider: true },
        { label: 'About', shortcut: '' }
      ]
    }
  ];

  const handleMenuClick = (itemLabel: string) => {
    if (itemLabel === 'Toggle Sidebar') {
      onToggleSidebar();
    }
    setActiveMenu(null);
  };

  return (
    <div className="h-12 bg-zinc-950 border-b border-zinc-800 flex items-center px-3 text-sm flex-shrink-0 z-20 relative">
      <button
        className="p-1.5 hover:bg-zinc-800 rounded-md transition-colors text-zinc-400 hover:text-zinc-100 mr-4"
        onClick={onToggleSidebar}
        title="Toggle Sidebar"
      >
        <Menu className="w-4 h-4" />
      </button>

      <div className="flex items-center gap-1">
        {menus.map((menu) => (
          <div key={menu.name} className="relative">
            <button
              className={`px-3 py-1.5 rounded-md transition-colors ${
                activeMenu === menu.name
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50'
              }`}
              onClick={() => setActiveMenu(activeMenu === menu.name ? null : menu.name)}
            >
              {menu.name}
            </button>
            <AnimatePresence>
              {activeMenu === menu.name && (
                <>
                  <div
                    className="fixed inset-0 z-30"
                    onClick={() => setActiveMenu(null)}
                  />
                  <motion.div
                    initial={{ opacity: 0, y: 4, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 4, scale: 0.98 }}
                    transition={{ duration: 0.15, ease: 'easeOut' }}
                    className="absolute top-full left-0 mt-1 bg-zinc-900 border border-zinc-800 rounded-lg shadow-2xl min-w-[220px] z-40 py-1.5 backdrop-blur-xl"
                  >
                    {menu.items.map((item, idx) =>
                      item.divider ? (
                        <div key={`div-${idx}`} className="h-px bg-zinc-800 my-1.5 mx-3" />
                      ) : (
                        <button
                          key={item.label}
                          className="w-full px-3 py-1.5 text-left hover:bg-blue-500 hover:text-white text-zinc-300 transition-colors flex items-center justify-between group"
                          onClick={() => handleMenuClick(item.label!)}
                        >
                          <span className="text-sm">{item.label}</span>
                          {item.shortcut && (
                            <span className="text-xs text-zinc-500 group-hover:text-blue-200 tracking-widest font-sans">
                              {item.shortcut}
                            </span>
                          )}
                        </button>
                      )
                    )}
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>
      
      <div className="ml-auto flex items-center gap-3 pr-2">
        <div className="flex items-center gap-1.5 text-zinc-500 text-xs font-medium">
          <Command className="w-3.5 h-3.5" />
          <span>All changes saved</span>
        </div>
      </div>
    </div>
  );
}
