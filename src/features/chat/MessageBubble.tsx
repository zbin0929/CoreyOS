import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  Check,
  Copy,
  Loader2,
  Paperclip,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  User,
  Wrench,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { highlightCode } from './highlight';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import { attachmentPreview } from '@/lib/ipc';
import { useChatStore, type UiAttachment, type UiMessage, type UiToolCall } from '@/stores/chat';

export function MessageBubble({ msg }: { msg: UiMessage }) {
  const isUser = msg.role === 'user';
  const canCopy = !msg.pending && !msg.error && msg.content.length > 0;
  // T6.1 — feedback buttons are offered only on completed, non-error
  // assistant bubbles. User bubbles and in-flight turns have nothing
  // meaningful to rate.
  const canRate = !isUser && canCopy;
  return (
    <div
      className={cn(
        'group flex gap-3',
        isUser ? 'flex-row-reverse' : 'flex-row',
      )}
    >
      <div
        className={cn(
          'flex h-8 w-8 flex-none items-center justify-center rounded-full',
          isUser ? 'bg-gold-500/15 text-gold-500' : 'bg-bg-elev-1 text-fg',
        )}
        aria-hidden
      >
        <Icon icon={isUser ? User : Sparkles} size="md" />
      </div>
      {/* `flex-1 min-w-0` is load-bearing: without `flex-1` the column
          shrinks to its children's intrinsic width, and the bubble's
          `max-w-[85%]` then resolves against that shrunk width — a
          circular constraint that collapses the bubble to min-content
          (1 char per line for CJK, since Chinese text has no word
          boundary for `overflow-wrap` to anchor on). Giving the column
          `flex-1` pins it to the full available row width so 85% has a
          stable reference. */}
      <div className={cn('flex min-w-0 flex-1 flex-col gap-1', isUser ? 'items-end' : 'items-start')}>
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
          {/* Reasoning / chain-of-thought panel — shown for
              reasoning-capable models (deepseek-reasoner, o1). Open by
              default WHILE streaming so the user sees progress; the
              user can collapse it any time. Once `msg.content` starts
              arriving we close it by default on subsequent renders so
              the final answer is the focus. */}
          {!isUser && msg.reasoning && msg.reasoning.length > 0 && (
            <ReasoningPanel
              reasoning={msg.reasoning}
              streaming={!!msg.pending || msg.content.length === 0}
            />
          )}
          {!isUser && msg.toolCalls && msg.toolCalls.length > 0 && (
            <ToolCallsStrip calls={msg.toolCalls} />
          )}
          {isUser && msg.attachments && msg.attachments.length > 0 && (
            <AttachmentsStrip attachments={msg.attachments} />
          )}
          {msg.pending && !msg.content ? (
            <span className="inline-flex items-center gap-2 text-fg-muted">
              <Icon icon={Loader2} size="sm" className="animate-spin" />
              thinking…
            </span>
          ) : msg.error ? (
            <span className="inline-flex items-start gap-2">
              <Icon icon={AlertCircle} size="md" className="mt-0.5 flex-none" />
              <span>{msg.error}</span>
            </span>
          ) : isUser ? (
            <span className="whitespace-pre-wrap">{msg.content}</span>
          ) : msg.content ? (
            <Markdown>{msg.content}</Markdown>
          ) : null}
        </div>
        {(canCopy || canRate) && (
          <div className="flex items-center gap-1">
            {canCopy && <CopyButton text={msg.content} />}
            {canRate && <FeedbackButtons msg={msg} />}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * T6.1 — 👍/👎 per assistant reply. Click once to stamp, click the
 * same button again to clear. Persisted via `setMessageFeedback` in
 * the chat store (fire-and-forget DB write). The rating survives
 * reloads and rolls up into Analytics totals.
 */
function FeedbackButtons({ msg }: { msg: UiMessage }) {
  const { t } = useTranslation();
  const sessionId = useChatStore((s) => s.currentId);
  const setFeedback = useChatStore((s) => s.setMessageFeedback);

  function toggle(value: 'up' | 'down') {
    if (!sessionId) return;
    const next = msg.feedback === value ? null : value;
    setFeedback(sessionId, msg.id, next);
  }

  const baseBtn =
    'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition focus-visible:visible';
  const idleBtn = 'text-fg-subtle invisible group-hover:visible hover:bg-bg-elev-2 hover:text-fg';
  const activeUp = 'visible text-emerald-500';
  const activeDown = 'visible text-danger';

  return (
    <>
      <button
        type="button"
        onClick={() => toggle('up')}
        className={cn(baseBtn, msg.feedback === 'up' ? activeUp : idleBtn)}
        aria-label={t('chat_page.feedback_up')}
        aria-pressed={msg.feedback === 'up'}
        title={t('chat_page.feedback_up')}
        data-testid={`bubble-feedback-up-${msg.id}`}
      >
        <Icon icon={ThumbsUp} size="xs" />
      </button>
      <button
        type="button"
        onClick={() => toggle('down')}
        className={cn(baseBtn, msg.feedback === 'down' ? activeDown : idleBtn)}
        aria-label={t('chat_page.feedback_down')}
        aria-pressed={msg.feedback === 'down'}
        title={t('chat_page.feedback_down')}
        data-testid={`bubble-feedback-down-${msg.id}`}
      >
        <Icon icon={ThumbsDown} size="xs" />
      </button>
    </>
  );
}

/**
 * Shown below each non-empty bubble. Hidden by default; revealed on hover of
 * the parent `.group` (or when pressed, to give the 'copied' feedback a beat
 * to be seen on touch).
 */
function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  async function onClick() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can fail in some webview contexts — fall back silently.
      setCopied(false);
    }
  }

  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition',
        'text-fg-subtle hover:bg-bg-elev-2 hover:text-fg',
        copied
          ? 'visible text-gold-500'
          : 'invisible group-hover:visible focus-visible:visible',
      )}
      aria-label={copied ? t('chat_page.copied') : t('chat_page.copy')}
      title={copied ? t('chat_page.copied') : t('chat_page.copy')}
    >
      {copied ? (
        <>
          <Icon icon={Check} size="xs" />
          {t('chat_page.copied')}
        </>
      ) : (
        <>
          <Icon icon={Copy} size="xs" />
        </>
      )}
    </button>
  );
}

/**
 * Small strip of tool-call pills rendered ABOVE the assistant's prose. Each
 * pill shows what the agent did (e.g. `terminal · pwd`). Hermes bakes the
 * tool's OUTPUT into the subsequent text, so we don't need an expandable
 * output panel here — the pill is a signal, not a full trace viewer.
 */
/**
 * Collapsible "thinking" panel shown above reasoning-model answers.
 *
 * Behavior:
 *   - While streaming (no content yet), the panel defaults to OPEN so
 *     the user can watch the chain-of-thought land in real time.
 *   - Once the final content starts flowing, the panel stays open if
 *     the user hasn't toggled it; a caller that wants the opposite
 *     can just close it manually. We don't auto-close on streaming
 *     finish because that would yank closing motion into the user's
 *     reading focus right as the answer appears.
 *   - Uses `<details>` instead of a state hook so browser-native
 *     expansion works without a re-render on every token.
 */
function ReasoningPanel({
  reasoning,
  streaming,
}: {
  reasoning: string;
  streaming: boolean;
}) {
  const { t } = useTranslation();
  return (
    <details
      className="mb-2 rounded-md border border-border/60 bg-bg-elev-2/50 text-[12px]"
      open={streaming}
      data-testid="reasoning-panel"
    >
      <summary className="flex cursor-pointer items-center gap-1.5 px-2 py-1.5 text-fg-muted select-none">
        <Icon
          icon={streaming ? Loader2 : Sparkles}
          size="xs"
          className={cn(streaming && 'animate-spin')}
        />
        <span>
          {streaming
            ? t('chat.reasoning.thinking', { defaultValue: 'Thinking…' })
            : t('chat.reasoning.thought', { defaultValue: 'Thought process' })}
        </span>
      </summary>
      {/* Reasoning is plain prose without markdown structure in
          practice (deepseek-reasoner emits free-form analysis).
          `whitespace-pre-wrap` preserves newlines without forcing
          us through ReactMarkdown, which would re-parse tokens on
          every delta and tank perf during long reasoning streams. */}
      <div className="border-t border-border/40 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-fg-subtle whitespace-pre-wrap">
        {reasoning}
      </div>
    </details>
  );
}

function ToolCallsStrip({ calls }: { calls: UiToolCall[] }) {
  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {calls.map((c) => (
        <div
          key={c.id}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-elev-2 px-2 py-1',
            'text-[11px] text-fg-muted',
          )}
          title={c.label ?? c.tool}
        >
          {c.emoji ? (
            <span className="text-sm leading-none">{c.emoji}</span>
          ) : (
            <Icon icon={Wrench} size="xs" className="text-fg-subtle" />
          )}
          <span className="font-semibold text-fg">{c.tool}</span>
          {c.label && (
            <>
              <span className="text-fg-subtle">·</span>
              <code className="max-w-[240px] truncate font-mono text-[11px]">
                {c.label}
              </code>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * T1.5 — user-bubble attachment chips. Inside the gold bubble we swap to
 * a semi-transparent chip so legibility holds against the gold backdrop;
 * otherwise the same visual shape as the composer's pending-chip row.
 */
function AttachmentsStrip({ attachments }: { attachments: UiAttachment[] }) {
  return (
    <ul
      className="mb-2 flex flex-wrap items-start gap-1.5"
      data-testid="bubble-attachments"
    >
      {attachments.map((a) =>
        a.mime.startsWith('image/') ? (
          <AttachmentImageTile key={a.id} attachment={a} />
        ) : (
          <li
            key={a.id}
            className="inline-flex items-center gap-1 rounded-full bg-black/15 px-2 py-0.5 text-[11px]"
            title={a.mime}
            data-testid={`bubble-attachment-${a.id}`}
          >
            <Icon icon={Paperclip} size="xs" className="opacity-70" />
            <span className="max-w-[220px] truncate">{a.name}</span>
          </li>
        ),
      )}
    </ul>
  );
}

/**
 * T1.5d — per-image thumbnail tile. Fires a lazy `attachment_preview`
 * IPC on mount; until it resolves (or when it fails, e.g. file has
 * been GC'd), we show a filename-only chip so the bubble layout never
 * jumps. The preview IPC is capped at 5 MB on the backend — oversize
 * images also fall back to the chip.
 *
 * We deliberately don't cache the data URL across renders — React
 * remounts are rare (bubble list isn't virtualised today) and the IPC
 * is cheap. Adding a module-level cache is a later optimization if
 * real usage turns up chatty re-renders.
 */
function AttachmentImageTile({ attachment }: { attachment: UiAttachment }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    attachmentPreview(attachment.path, attachment.mime)
      .then((data) => {
        if (!cancelled) setUrl(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [attachment.path, attachment.mime]);

  // On preview failure, fall back to the filename chip so the user
  // still sees that an image was attached.
  if (failed || (!url && attachment.size > 5 * 1024 * 1024)) {
    return (
      <li
        className="inline-flex items-center gap-1 rounded-full bg-black/15 px-2 py-0.5 text-[11px]"
        title={`${attachment.mime} · preview unavailable`}
        data-testid={`bubble-attachment-${attachment.id}`}
      >
        <Icon icon={Paperclip} size="xs" className="opacity-70" />
        <span className="max-w-[220px] truncate">{attachment.name}</span>
      </li>
    );
  }

  return (
    <li
      className="overflow-hidden rounded-md bg-black/15"
      title={`${attachment.name} · ${attachment.mime}`}
      data-testid={`bubble-attachment-${attachment.id}`}
    >
      {url ? (
        <img
          src={url}
          alt={attachment.name}
          className="block h-24 w-24 object-cover"
          data-testid={`bubble-attachment-image-${attachment.id}`}
        />
      ) : (
        // Placeholder keeps the layout stable while the preview loads.
        <div className="flex h-24 w-24 items-center justify-center text-[11px] opacity-70">
          <Icon icon={Loader2} size="md" className="animate-spin" />
        </div>
      )}
    </li>
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
