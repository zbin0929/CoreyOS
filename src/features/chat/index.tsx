import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Send, Loader2, AlertCircle, Sparkles, User } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PageHeader } from '@/app/shell/PageHeader';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { chatStream, ipcErrorMessage, type ChatMessageDto } from '@/lib/ipc';

interface UiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  pending?: boolean;
  error?: string;
}

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function ChatRoute() {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    const userMsg: UiMessage = { id: newId(), role: 'user', content: trimmed };
    const pendingId = newId();
    const pendingMsg: UiMessage = { id: pendingId, role: 'assistant', content: '', pending: true };

    setMessages((prev) => [...prev, userMsg, pendingMsg]);
    setDraft('');
    setSending(true);

    const historyForIpc: ChatMessageDto[] = [
      ...messages
        .filter((m) => !m.error && !m.pending)
        .map<ChatMessageDto>((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: trimmed },
    ];

    try {
      await chatStream(
        { messages: historyForIpc },
        {
          onDelta: (chunk) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === pendingId
                  ? { ...m, content: m.content + chunk, pending: false }
                  : m,
              ),
            );
          },
          onDone: () => {
            setSending(false);
            // Ensure pending flag cleared even if no deltas arrived (edge case).
            setMessages((prev) =>
              prev.map((m) => (m.id === pendingId ? { ...m, pending: false } : m)),
            );
          },
          onError: (err) => {
            const msg = ipcErrorMessage(err);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === pendingId
                  ? { ...m, content: '', pending: false, error: msg }
                  : m,
              ),
            );
            setSending(false);
          },
        },
      );
    } catch (e) {
      // Invoke failed (before stream even started).
      const msg = ipcErrorMessage(e);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === pendingId ? { ...m, content: '', pending: false, error: msg } : m,
        ),
      );
      setSending(false);
    }
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void send(draft);
  }

  function onTextareaKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter inserts a newline.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(draft);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Chat" subtitle="Hermes · streaming · Sprint 1" />

      {/* Scrollable transcript */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-6">
          {messages.length === 0 ? (
            <EmptyHero onPick={(prompt) => void send(prompt)} />
          ) : (
            messages.map((m) => <MessageBubble key={m.id} msg={m} />)
          )}
        </div>
      </div>

      {/* Composer */}
      <div className="border-t border-border bg-bg/80 backdrop-blur">
        <form onSubmit={onSubmit} className="mx-auto flex max-w-3xl items-end gap-2 px-6 py-4">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onTextareaKeyDown}
            rows={1}
            placeholder="Message Hermes…  (Enter to send, Shift+Enter for newline)"
            disabled={sending}
            className={cn(
              'min-h-[44px] max-h-[200px] flex-1 resize-none rounded-xl border border-border',
              'bg-bg-elev-1 px-4 py-3 text-sm text-fg placeholder:text-fg-subtle',
              'focus:outline-none focus:ring-2 focus:ring-gold-500/40 focus:border-gold-500/40',
              'disabled:opacity-60',
            )}
          />
          <Button type="submit" disabled={sending || !draft.trim()} className="h-11 px-4">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </form>
      </div>
    </div>
  );
}

function EmptyHero({ onPick }: { onPick: (prompt: string) => void }) {
  const suggestions = [
    '用一句话解释什么是 Hermes Agent。',
    'Summarize the TRAE sandboxing model in 3 bullets.',
    '帮我生成一个 Rust 的 Tokio 基础示例。',
  ];
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 text-center">
      <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gold-500/10 text-gold-500">
        <Sparkles className="h-6 w-6" />
      </div>
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">Talk to Hermes</h2>
        <p className="text-sm text-fg-muted">
          Connected through the local gateway on <code className="font-mono text-xs">:8642</code>.
        </p>
      </div>
      <div className="grid w-full max-w-xl gap-2 sm:grid-cols-1">
        {suggestions.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="rounded-xl border border-border bg-bg-elev-1 px-4 py-3 text-left text-sm text-fg transition hover:border-gold-500/40 hover:bg-gold-500/5"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({ msg }: { msg: UiMessage }) {
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
 * via design tokens so it inherits light/dark themes. No raw HTML, no
 * custom rehype — safe by default (react-markdown escapes by design).
 */
function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-chat">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
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
            const isBlock = /language-/.test(className ?? '');
            if (isBlock) {
              return (
                <code
                  className={cn(
                    'block overflow-x-auto rounded-md bg-bg-elev-2 px-3 py-2 font-mono text-xs',
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
