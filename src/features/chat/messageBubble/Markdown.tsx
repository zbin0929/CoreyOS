import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowRight } from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';

import { cn } from '@/lib/cn';

import { highlightCode } from '../highlight';
import { ArtifactBlock } from './ArtifactBlock';
import { ArtifactLinkCard } from './ArtifactLinkCard';
import { parseArtifactUrl, shouldRenderAsArtifact } from './artifactHelpers';
import { TableArtifact } from './TableArtifact';

/**
 * Minimal Markdown renderer scoped for chat bubbles. Styles everything
 * via design tokens so it inherits light/dark themes. No raw HTML.
 *
 * Also used by the `/compare` route to render each lane's response in
 * the same visual chrome — see `src/features/compare/index.tsx`.
 */
/**
 * Plain-text deep-link aliases the agent often emits without proper
 * markdown link syntax — e.g. `[去 Models 页 →]`. We rewrite these to
 * canonical markdown links pointing at the matching frontend route so
 * the `a` renderer below can turn them into clickable buttons.
 *
 * Keep this list aligned with the routes registered in
 * `src/app/routes.tsx`. The agent's Soul tells it to use proper
 * markdown syntax, but rewriting here is belt + suspenders for when
 * the model forgets.
 */
const PLAIN_LINK_ROUTES: Array<{ pattern: RegExp; href: string }> = [
  { pattern: /^(去\s*)?Models\s*页?\s*→?$/i, href: '/models' },
  { pattern: /^(去\s*)?Tasks\s*页?\s*→?$/i, href: '/tasks' },
  { pattern: /^(去\s*)?Workflows?\s*页?\s*→?$/i, href: '/workflows' },
  { pattern: /^(去\s*)?Analytics\s*页?\s*→?$/i, href: '/analytics' },
  { pattern: /^(去\s*)?Logs\s*页?\s*→?$/i, href: '/logs' },
  { pattern: /^(去\s*)?Skills\s*页?\s*→?$/i, href: '/skills' },
  { pattern: /^(去\s*)?Knowledge\s*页?\s*→?$/i, href: '/knowledge' },
  { pattern: /^(去\s*)?Memory\s*页?\s*→?$/i, href: '/memory' },
  { pattern: /^(去\s*)?MCP\s*页?\s*→?$/i, href: '/mcp' },
  { pattern: /^(去\s*)?(Settings|设置)\s*页?\s*→?$/i, href: '/settings' },
  { pattern: /^(回到\s*)?(Home|主页|首页)\s*→?$/i, href: '/' },
];

function rewritePlainDeepLinks(src: string): string {
  return src.replace(/\[([^\]\n]+?)\](?!\()/g, (full, label: string) => {
    const trimmed = label.trim();
    for (const { pattern, href } of PLAIN_LINK_ROUTES) {
      if (pattern.test(trimmed)) return `[${label}](${href})`;
    }
    return full;
  });
}

function isInternalRoute(href: string | undefined): href is string {
  return typeof href === 'string' && href.startsWith('/') && !href.startsWith('//');
}

function DeepLinkButton({ href, children }: { href: string; children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => void navigate({ to: href })}
      className={cn(
        'my-1 inline-flex items-center gap-1.5 rounded-full border border-gold-500/40',
        'bg-gold-500/10 px-3 py-1 text-xs font-medium text-gold-700 dark:text-gold-300',
        'transition-colors duration-fast hover:bg-gold-500/20 hover:border-gold-500/60',
        'focus:outline-none focus:ring-2 focus:ring-gold-500/40',
      )}
    >
      <span>{children}</span>
      <ArrowRight className="h-3 w-3" aria-hidden />
    </button>
  );
}

export function Markdown({ children }: { children: string }) {
  const source = rewritePlainDeepLinks(children);
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
          a: ({ href, children }) => {
            // `corey://artifact/<run>/<name>` → render an inline file
            // card with Open / Reveal-in-Finder buttons. The agent is
            // taught (base soul) to emit this scheme right after a
            // save_artifact call so the user has a one-click path to
            // the xlsx / pdf / etc. without leaving chat.
            const art = parseArtifactUrl(href);
            if (art) {
              return <ArtifactLinkCard runId={art.runId} name={art.name} />;
            }
            // Internal route → render as a deep-link pill that drives
            // the in-app router. The chat agent uses `[label](/route)`
            // syntax to hand control back to the user ("决策归还")
            // after a tool-driven summary; making it a button keeps
            // the user inside the desktop app instead of opening a
            // new browser tab.
            if (isInternalRoute(href)) {
              return <DeepLinkButton href={href}>{children}</DeepLinkButton>;
            }
            return (
              <a
                href={href}
                target="_blank"
                rel="noreferrer noopener"
                className="text-gold-600 dark:text-gold-400 underline decoration-gold-500/40 underline-offset-2 hover:decoration-gold-500"
              >
                {children}
              </a>
            );
          },
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
              const trimmed = raw.replace(/\n$/, '');
              const { html, language } = highlightCode(trimmed, match?.[1]);
              if (shouldRenderAsArtifact(trimmed)) {
                return (
                  <ArtifactBlock
                    rawContent={trimmed}
                    language={language ?? undefined}
                    highlightedHtml={html}
                  />
                );
              }
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
          // B-9.4 long-table artifact card. Short tables render
          // exactly as before; tables with ≥10 rows gain a header
          // bar with row count + "Download CSV" affordance.
          table: ({ children }) => <TableArtifact>{children}</TableArtifact>,
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
        {source}
      </ReactMarkdown>
    </div>
  );
}
