import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeMathjax from 'rehype-mathjax';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { motion } from 'motion/react';
import { macros } from '../mathjax-macros';

interface PreviewProps {
  markdown: string;
  // Rewrites a note-relative image path (a captured clip) to a servable URL.
  // Genuinely absent outside the reader overlay, which owns backend assets.
  resolveImageSrc?: ((src: string) => string) | undefined;
}

// remark-math extracts $…$/$$…$$ before markdown emphasis can mangle
// underscores; rehype-mathjax (SVG) typesets with the same macro set the
// papers use (generated from ~/.pandoc/styles/macros). SVG output is inline —
// no font files or remote scripts — which the reader page's strict CSP
// (script-src 'self'; font-src 'self' data:) requires. fontCache 'local' keeps
// each expression's glyph ids self-contained across live-preview re-renders.
const mathjaxOptions = {
  tex: { macros },
  svg: { fontCache: 'local' as const },
};

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

export function Preview({ markdown, resolveImageSrc }: PreviewProps) {
  const image: NonNullable<Components['img']> = ({ src, alt, node: _node, ...props }) => {
    const resolved =
      typeof src === 'string' && resolveImageSrc !== undefined ? resolveImageSrc(src) : src;
    return (
      <img
        {...props}
        src={resolved}
        alt={typeof alt === 'string' ? alt : ''}
        className="mx-auto my-4 max-w-full rounded border border-zinc-200 shadow-sm"
      />
    );
  };
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
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[[rehypeMathjax, mathjaxOptions]]}
            components={{ code: CodeBlock, img: image }}
          >
            {markdown !== '' ? markdown : '*Start typing to see the preview...*'}
          </ReactMarkdown>
        </div>
      </div>
    </motion.div>
  );
}
