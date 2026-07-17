'use client';

import ReactMarkdown from 'react-markdown';

/**
 * Renders an AI chat answer as nicely-formatted Markdown (headings, bold,
 * bullet/numbered lists, inline code, links) — the ChatGPT-style readable
 * output. Sized and spaced for a chat bubble; first/last margins trimmed so it
 * sits flush. Use only for assistant (non-error) messages; user text stays raw.
 */
export default function ChatMarkdown({ content }: { content: string }) {
  return (
    <div className="text-sm leading-6 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown
        components={{
          h1: ({ children }) => <h1 className="mb-2 mt-3 text-base font-bold text-white">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-2 mt-3 text-[0.95rem] font-bold text-white">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-1.5 mt-3 text-sm font-semibold text-white">{children}</h3>,
          p: ({ children }) => <p className="mb-2 text-white/90">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
          em: ({ children }) => <em className="italic text-white/90">{children}</em>,
          ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-1 text-white/90 marker:text-white/40">{children}</ul>,
          ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal space-y-1 text-white/90 marker:text-white/40">{children}</ol>,
          li: ({ children }) => <li className="pl-1">{children}</li>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer" className="text-[var(--accent)] underline underline-offset-2 hover:opacity-80">
              {children}
            </a>
          ),
          code: ({ children }) => <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[0.8em] text-white">{children}</code>,
          pre: ({ children }) => (
            <pre className="mb-2 overflow-x-auto rounded-lg border border-white/10 bg-black/40 p-3 text-xs [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-white/90">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => <blockquote className="mb-2 border-l-2 border-white/20 pl-3 text-white/70">{children}</blockquote>,
          hr: () => <hr className="my-3 border-white/10" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
