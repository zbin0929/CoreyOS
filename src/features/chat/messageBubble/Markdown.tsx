import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { cn } from '@/lib/cn';

import { highlightCode } from '../highlight';

/**
 * Minimal Markdown renderer scoped for chat bubbles. Styles everything
 * via design tokens so it inherits light/dark themes. No raw HTML.
 *
 * Also used by the `/compare` route to render each lane's response in
 * the same visual chrome — see `src/features/compare/index.tsx`.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-chat">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // No `rehypePlugins` — we run highlight.js directly inside the
        // `code` renderer below. See `./highlight.ts` for why we
        // dropped rehype-highlight (it pulls in all ~35 common
        // grammars regardless of the `languages` option).
        components={{
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          h1: ({ children }) => (
            <h1 className="mb-2 mt-3 text-base font-semibold first:mt-0">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-2 mt-3 text-[15px] font-semibold first:mt-0">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-2 mt-3 text-sm font-semibold first:mt-0">{children}</h3>
          ),
          ul: ({ children }) => (
            <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>
          ),
          li: ({ children }) => <li>{children}</li>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="text-gold-600 underline decoration-gold-500/40 underline-offset-2 hover:decoration-gold-500"
            >
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-border pl-3 text-fg-muted">
              {children}
            </blockquote>
          ),
          code: ({ className, children, ...rest }) => {
            // Detect a fenced block by the `language-*` class remark
            // emits on block code. Inline code has no class prefix.
            const match = /language-([\w+-]+)/.exec(className ?? '');
            if (match || /\n/.test(String(children))) {
              // `children` is a single string for a fenced block (remark
              // collapses the leaf text node). Normalise and run the
              // highlighter; fall back to escaped raw text for unknown
              // languages (see `highlight.ts`).
              const raw = Array.isArray(children)
                ? children.join('')
                : String(children ?? '');
              const { html, language } = highlightCode(
                raw.replace(/\n$/, ''),
                match?.[1],
              );
              return (
                <code
                  // Keep the `hljs` class so the github-dark stylesheet
                  // targets it; append the resolved language so any
                  // future per-language theming has a hook.
                  className={cn(
                    'hljs block overflow-x-auto rounded-md bg-[#0d1117] px-3 py-2 font-mono text-xs text-[#e6edf3]',
                    language && `language-${language}`,
                  )}
                  dangerouslySetInnerHTML={{ __html: html }}
                  {...rest}
                />
              );
            }
            return (
              <code
                className="rounded bg-bg-elev-2 px-1 py-[1px] font-mono text-[0.85em]"
                {...rest}
              >
                {children}
              </code>
            );
          },
          pre: ({ children }) => <pre className="my-2">{children}</pre>,
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto">
              <table className="min-w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-border bg-bg-elev-2 px-2 py-1 text-left font-semibold">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-border px-2 py-1 align-top">{children}</td>
          ),
          hr: () => <hr className="my-3 border-border" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
