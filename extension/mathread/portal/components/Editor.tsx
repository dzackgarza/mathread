import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { vim } from '@replit/codemirror-vim';

interface EditorProps {
  value: string;
  onChange: (value: string) => void;
  // The shipped reader contract is a plain CodeMirror editor; vim stays one
  // toggle away rather than ambushing first keystrokes as normal-mode commands.
  defaultVimMode?: boolean;
}

export function Editor({ value, onChange, defaultVimMode = false }: EditorProps) {
  const [vimMode, setVimMode] = useState(defaultVimMode);
  const [lineCount, setLineCount] = useState(value.split('\n').length);

  useEffect(() => {
    setLineCount(value.split('\n').length);
  }, [value]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex-1 flex flex-col bg-zinc-950 w-full h-full"
    >
      <div className="px-6 py-3 border-b border-zinc-800/80 flex items-center justify-between shrink-0 bg-zinc-950/50 backdrop-blur-sm">
        <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-widest">
          Markdown {vimMode && '(Vim Mode)'}
        </h3>
        <div className="flex items-center gap-4">
          <button
            onClick={() => setVimMode(!vimMode)}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            {vimMode ? 'Disable Vim' : 'Enable Vim'}
          </button>
          <span className="text-xs text-zinc-600 font-mono">{lineCount} lines</span>
        </div>
      </div>
      <div className="flex-1 relative overflow-auto">
        <CodeMirror
          value={value}
          height="100%"
          extensions={[
            markdown(),
            ...(vimMode ? [vim()] : []),
          ]}
          onChange={onChange}
          theme="dark"
          basicSetup={{
            lineNumbers: true,
            highlightActiveLine: true,
            highlightActiveLineGutter: true,
            foldGutter: true,
            drawSelection: true,
            dropCursor: true,
            allowMultipleSelections: true,
            indentOnInput: true,
            bracketMatching: true,
            closeBrackets: true,
            autocompletion: true,
            rectangularSelection: true,
            crosshairCursor: true,
            highlightSelectionMatches: true,
            closeBracketsKeymap: true,
            searchKeymap: true,
            foldKeymap: true,
            completionKeymap: true,
            lintKeymap: true,
          }}
          style={{
            height: '100%',
            fontSize: '14px',
            fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
          }}
        />
      </div>
    </motion.div>
  );
}
