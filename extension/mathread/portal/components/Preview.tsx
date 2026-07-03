import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { motion } from 'motion/react';

interface PreviewProps {
  markdown: string;
}

const CodeBlock: NonNullable<Components['code']> = ({ className, children, ref: _ref, ...props }) => {
  const match = /language-(\w+)/.exec(className !== undefined ? className : '');
  return match ? (
    <div className="rounded-lg overflow-hidden my-6 border border-zinc-200/50 shadow-sm">
      <div className="bg-zinc-900 px-4 py-2 text-xs font-mono text-zinc-400 flex items-center border-b border-zinc-800">
        {match[1]}
      </div>
      <SyntaxHighlighter
        {...props}
        style={oneDark}
        language={match[1]}
        PreTag="div"
        customStyle={{ margin: 0, borderRadius: 0, padding: '1.25rem' }}
      >
        {String(children).replace(/\\n$/, '')}
      </SyntaxHighlighter>
    </div>
  ) : (
    <code className={className} {...props}>
      {children}
    </code>
  );
};

export function Preview({ markdown }: PreviewProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex-1 flex flex-col bg-white w-full h-full"
    >
      <div className="px-6 py-3 border-b border-zinc-200 flex items-center justify-between shrink-0 bg-zinc-50/80 backdrop-blur-sm sticky top-0 z-10">
        <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">Preview</h3>
      </div>
      <div className="flex-1 overflow-y-auto p-8 lg:p-12">
        <div className="max-w-3xl mx-auto prose prose-zinc prose-a:text-blue-600 hover:prose-a:text-blue-500 prose-headings:font-semibold prose-code:text-pink-600 prose-code:bg-pink-50 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:before:content-none prose-code:after:content-none">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{ code: CodeBlock }}
          >
            {markdown !== '' ? markdown : '*Start typing to see the preview...*'}
          </ReactMarkdown>
        </div>
      </div>
    </motion.div>
  );
}
