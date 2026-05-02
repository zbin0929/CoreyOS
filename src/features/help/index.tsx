import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Search, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { PageHeader } from '@/app/shell/PageHeader';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import { highlightCode } from '@/features/chat/highlight';

// Markdown source bundled via Vite's `?raw` import. The user manual
// lives under `docs/user/` because that's where SETUP.md and friends
// already are; we just keep an extra copy under `src/features/help/`
// so vite's module graph + watch mode pick up edits and the bundle
// is fully self-contained (no runtime fetch, no server dependency).
import manualZh from './manual.zh.md?raw';

const ISSUES_URL = 'https://github.com/zbin0929/CoreyOS/issues';

/**
 * In-app user manual. Renders the Markdown source via react-markdown
 * with remark-gfm, plus an auto-generated table of contents derived
 * from the document's H2/H3 headings. The Help menu (`Corey 文档`)
 * navigates here instead of opening an external URL — keeps the docs
 * available offline and in sync with the build the user is running.
 *
 * Decisions:
 *  - Single-language for now: the manual was authored in Chinese; an
 *    English translation can land later as `manual.en.md` and the
 *    locale switch picks based on `i18n.language`.
 *  - Filter box scrolls to the first matching heading in real time —
 *    a 1400-line manual is too long to scan visually.
 *  - "Open in browser" affordance for users who want to copy / Cmd-F
 *    / share — falls back to the GitHub blob URL for the same file.
 */
export function HelpRoute() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const contentRef = useRef<HTMLDivElement | null>(null);

  // Build a lightweight TOC from the markdown source. We do this with a
  // line-by-line regex pass instead of feeding the rendered HTML through
  // a DOM walker because (a) it runs once on mount and (b) we want stable
  // ids that match the slugs `react-markdown` will end up emitting.
  const toc = useMemo(() => buildToc(manualZh), []);

  // Scroll-to-heading on filter match. Picks the first TOC entry whose
  // text contains the query (case-insensitive, trimmed) — good enough
  // for the prose at hand.
  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (!q) return;
    const hit = toc.find((e) => e.text.toLowerCase().includes(q));
    if (!hit) return;
    const el = contentRef.current?.querySelector<HTMLElement>(`#${hit.id}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [query, toc]);

  const githubUrl =
    'https://github.com/zbin0929/CoreyOS/blob/main/docs/user/%E7%94%A8%E6%88%B7%E6%89%8B%E5%86%8C.md';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={t('help_page.title')}
        subtitle={t('help_page.subtitle')}
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void openExternal(ISSUES_URL)}
              data-testid="help-open-issues"
            >
              <Icon icon={ExternalLink} size="sm" />
              {t('help_page.report_issue')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void openExternal(githubUrl)}
              data-testid="help-open-github"
            >
              <Icon icon={ExternalLink} size="sm" />
              {t('help_page.open_in_github')}
            </Button>
          </div>
        }
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* TOC sidebar */}
        <aside className="hidden w-64 flex-none flex-col overflow-hidden border-r border-border/60 bg-bg-elev-1/50 backdrop-blur-xl lg:flex">
          <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
            <Icon icon={Search} size="xs" className="opacity-60" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('help_page.search_placeholder')}
              className="flex-1 bg-transparent text-xs text-fg outline-none placeholder:text-fg-subtle"
              data-testid="help-search"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="text-fg-subtle hover:text-fg"
                aria-label={t('help_page.clear_search')}
              >
                <Icon icon={X} size="xs" />
              </button>
            )}
          </div>
          <nav className="min-h-0 flex-1 overflow-y-auto py-2">
            {toc.map((entry) => (
              <a
                key={entry.id}
                href={`#${entry.id}`}
                onClick={(e) => {
                  // TanStack Router intercepts hash-only links unless
                  // we suppress with a manual scroll; without this the
                  // browser jumps without smooth-scroll.
                  e.preventDefault();
                  contentRef.current
                    ?.querySelector<HTMLElement>(`#${entry.id}`)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                className={cn(
                  'block truncate px-3 py-1 text-xs transition-colors',
                  entry.level === 2
                    ? 'text-fg hover:text-accent'
                    : 'pl-6 text-fg-muted hover:text-fg',
                )}
                data-testid={`help-toc-${entry.id}`}
              >
                {entry.text}
              </a>
            ))}
          </nav>
        </aside>

        {/* Body */}
        <div
          ref={contentRef}
          className="min-h-0 flex-1 overflow-y-auto"
          data-testid="help-content"
        >
          {/* Inline typography classes (vs a custom prose-help layer) so
              the manual stays readable without depending on a global
              CSS contract. The headings get explicit ids so the TOC
              anchors resolve, and code/table blocks get the same
              token-aware look the rest of the app uses. */}
          <article className="mx-auto max-w-3xl px-6 py-8 text-sm text-fg [&_a]:text-accent [&_a:hover]:underline [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-accent/40 [&_blockquote]:pl-3 [&_blockquote]:text-fg-muted [&_code]:rounded [&_code]:bg-bg-elev-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px] [&_h1]:mb-4 [&_h1]:mt-6 [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:text-fg [&_h2]:mb-3 [&_h2]:mt-6 [&_h2]:border-b [&_h2]:border-border [&_h2]:pb-1 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-fg [&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-fg [&_h4]:mb-2 [&_h4]:mt-3 [&_h4]:text-sm [&_h4]:font-semibold [&_hr]:my-6 [&_hr]:border-border [&_li]:my-1 [&_ol]:my-2 [&_ol]:ml-6 [&_ol]:list-decimal [&_p]:my-2 [&_p]:leading-relaxed [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-border [&_pre]:bg-bg-elev-1 [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_strong]:text-fg [&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:bg-bg-elev-2 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold [&_ul]:my-2 [&_ul]:ml-6 [&_ul]:list-disc">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                // Slugify headings so the TOC anchors line up. Falls
                // back to the auto-generated id react-markdown gives
                // when no slug can be derived (rare — empty heading).
                h1: (props) => <h1 id={slug(toString(props.children))} {...props} />,
                h2: (props) => <h2 id={slug(toString(props.children))} {...props} />,
                h3: (props) => <h3 id={slug(toString(props.children))} {...props} />,
                h4: (props) => <h4 id={slug(toString(props.children))} {...props} />,
                // Reuse the chat module's highlight pipeline. Same
                // grammar registry, same github-dark palette — no
                // duplicate bundling.
                code: ({ className, children, ...rest }) => {
                  const match = /language-([\w+-]+)/.exec(className ?? '');
                  // Fenced block: matched info-string OR multi-line content.
                  // Inline `code` shows up as a single line and falls through
                  // to the unstyled branch below.
                  if (match || /\n/.test(String(children))) {
                    const raw = Array.isArray(children)
                      ? children.join('')
                      : String(children ?? '');
                    const { html, language } = highlightCode(
                      raw.replace(/\n$/, ''),
                      match?.[1],
                    );
                    return (
                      <code
                        className={cn(
                          'hljs block overflow-x-auto rounded-md bg-[#0d1117] px-3 py-2 font-mono text-xs text-[#e6edf3]',
                          language && `language-${language}`,
                        )}
                        dangerouslySetInnerHTML={{ __html: html }}
                        {...rest}
                      />
                    );
                  }
                  // Inline code keeps the markdown's small-pill look.
                  return (
                    <code
                      className="rounded bg-bg-elev-2 px-1 py-[1px] font-mono text-[0.85em]"
                      {...rest}
                    >
                      {children}
                    </code>
                  );
                },
                // Strip the prose wrapper's default `<pre>` margin so
                // the highlighted code block carries the rounded-md
                // background edge-to-edge.
                pre: ({ children }) => <pre className="my-3">{children}</pre>,
              }}
            >
              {manualZh}
            </ReactMarkdown>
          </article>
        </div>
      </div>
    </div>
  );
}

interface TocEntry {
  id: string;
  text: string;
  level: 2 | 3;
}

/**
 * Extract H2/H3 headings from the markdown source. Skips H1 (the
 * document title) since it's already in the page header, and skips
 * H4+ to keep the sidebar scannable. Setext headings are rare enough
 * to ignore.
 */
function buildToc(md: string): TocEntry[] {
  const out: TocEntry[] = [];
  let inFence = false;
  for (const line of md.split('\n')) {
    // Skip code-fence content so a ```# foo``` snippet doesn't
    // pollute the TOC.
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = line.match(/^(#{2,3})\s+(.+?)\s*#*\s*$/);
    if (!match) continue;
    const level = match[1]!.length as 2 | 3;
    const text = match[2]!.trim();
    out.push({ id: slug(text), text, level });
  }
  return out;
}

/**
 * Slugify a heading. Mirrors GitHub's algorithm closely enough for
 * the `#anchor` links to work: ASCII alphanumerics + dashes, others
 * dropped. CJK chars stay (the URL-encoded form is what browsers
 * scroll to).
 */
function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s\u00a0]+/g, '-')
    .replace(/[^\p{Letter}\p{Number}-]/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Open an external URL in the system browser. Falls back to
 *  `window.open` when the shell plugin isn't available (Storybook,
 *  pure web preview). Mirrors the helper in `useMenuEvents.ts` —
 *  duplicating six lines beats taking a dependency on private
 *  module internals. */
async function openExternal(url: string): Promise<void> {
  try {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(url);
  } catch {
    window.open(url, '_blank', 'noopener');
  }
}

/** Children of a markdown node can be string | array | element. We
 *  only need the text for slug purposes; flatten everything to its
 *  string form. */
function toString(children: unknown): string {
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return children.map(toString).join('');
  if (children && typeof children === 'object' && 'props' in children) {
    return toString((children as { props: { children: unknown } }).props.children);
  }
  return '';
}
