import { AlertCircle, Loader2, Sparkles, User } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { cn } from '@/lib/cn';
import type { UiMessage } from '@/stores/chat';

export function MessageBubble({ msg }: { msg: UiMessage }) {
  const isUser = msg.role === 'user';
  return (
    <div className={cn('flex gap-3', isUser ? 'flex-row-reverse' : 'flex-row')}>
      <div
        className={cn(
          'flex h-8 w-8 flex-none items-center justify-center rounded-full',
          isUser ? 'bg-gold-500/15 text-gold-500' : 'bg-bg-elev-1 text-fg',
        )}
        aria-hidden
      >
        {isUser ? <User className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
      </div>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed',
          // Fixed dark ink for the gold bubble — independent of theme.
          isUser
            ? 'bg-gold-500 text-[hsl(225_30%_10%)]'
            : 'border border-border bg-bg-elev-1 text-fg',
          msg.error && 'border-danger/40 bg-danger/5 text-danger',
        )}
      >
        {msg.pending && !msg.content ? (
          <span className="inline-flex items-center gap-2 text-fg-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            thinking…
          </span>
        ) : msg.error ? (
          <span className="inline-flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
            <span>{msg.error}</span>
          </span>
        ) : isUser ? (
          // Users type plain text — preserve newlines, don't render MD.
          <span className="whitespace-pre-wrap">{msg.content}</span>
        ) : (
          <Markdown>{msg.content}</Markdown>
        )}
      </div>
    </div>
  );
}

/**
 * Minimal Markdown renderer scoped for chat bubbles. Styles everything
 * via design tokens so it inherits light/dark themes. No raw HTML.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-chat">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
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
            // Block code: rehype-highlight emits `hljs language-*` on the <code>.
            const isBlock = /(?:^|\s)(?:hljs|language-)/.test(className ?? '');
            if (isBlock) {
              return (
                <code
                  className={cn(
                    // Fixed dark backdrop — keeps github-dark tokens readable
                    // in both light and dark app themes.
                    'block overflow-x-auto rounded-md bg-[#0d1117] px-3 py-2 font-mono text-xs text-[#e6edf3]',
                    className,
                  )}
                  {...rest}
                >
                  {children}
                </code>
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
