import {
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { AlertTriangle, Mic, Paperclip, Send, Square, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import type { StagedAttachment } from '@/lib/ipc';
import type { VisionSupport } from '@/lib/modelCapabilities';

import { ActiveLLMBadge } from './ActiveLLMBadge';
import { RoutingHint } from './ChatHelpers';
import { formatBytes } from './formatBytes';

/**
 * The composer footer — everything that lives below the message list:
 * the active-LLM badge + routing hint, attachment chips + warnings,
 * and the input row (paperclip / textarea / voice / send).
 *
 * Extracted from `index.tsx` because the JSX dwarfed the actual
 * conversation logic (~217 lines of form vs. ~250 lines of state),
 * and because every prop here is a leaf — the composer doesn't read
 * stores directly, so it's trivially testable in isolation.
 *
 * Notable design choices preserved verbatim from the inline version:
 *  - drag-drop overlay is absolutely positioned over the form so it
 *    doesn't push the viewport down on a drag-enter.
 *  - the IME guard on `onTextareaKeyDown` is owned by the parent so
 *    it can wrap an in-flight `send()` call; we just pass the handler.
 *  - file input is a hidden `<input type="file">` driven by the
 *    paperclip button — no plugin dependency, identical browser/Tauri
 *    behavior.
 */
export interface ComposerProps {
  /** Current textarea value. */
  draft: string;
  /** True while a stream is in flight. Disables most controls. */
  sending: boolean;
  /** True while the voice recorder is capturing. */
  voiceRecording: boolean;

  /** Pending attachment chip list (pre-send). */
  pendingAttachments: StagedAttachment[];
  /** > 0 while files are being dragged over the form. */
  dragDepth: number;

  /** Transient error text from the last stage attempt. */
  attachError: string | null;
  /** Non-blocking soft warnings from the budget gate. */
  budgetWarnings: string[];
  /**
   * True when the active model is a known text-only model AND the
   * user has at least one image attached. Surfaces the vision warning
   * banner above the input row.
   */
  imageBlockedByModel: boolean;
  /** Used by the paperclip tooltip to explain why uploads might fail. */
  visionCap: VisionSupport;
  /** Resolved model id for the vision-warning banner copy. */
  effectiveModel: string | null;

  /** Refs the parent owns (auto-resize + file picker click trigger). */
  textareaRef: RefObject<HTMLTextAreaElement>;
  fileInputRef: RefObject<HTMLInputElement>;

  /** Setters / handlers wired up by the parent. */
  onDraftChange: (next: string) => void;
  onTextareaKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste: (e: ClipboardEvent<HTMLTextAreaElement>) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;

  /** Drag-drop handlers. Wire all four — the parent's `useAttachments`
   *  hook prepares them. */
  onDragEnter: (e: DragEvent<HTMLFormElement>) => void;
  onDragLeave: (e: DragEvent<HTMLFormElement>) => void;
  onDragOver: (e: DragEvent<HTMLFormElement>) => void;
  onDrop: (e: DragEvent<HTMLFormElement>) => void;

  /** Hidden file input change handler. */
  onFilePicked: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** Chip-X click. */
  onRemoveAttachment: (id: string) => void;

  /** Voice toggle handlers. */
  onVoiceStart: () => void;
  onVoiceStop: () => void;
}

export function Composer({
  draft,
  sending,
  voiceRecording,
  pendingAttachments,
  dragDepth,
  attachError,
  budgetWarnings,
  imageBlockedByModel,
  visionCap,
  effectiveModel,
  textareaRef,
  fileInputRef,
  onDraftChange,
  onTextareaKeyDown,
  onPaste,
  onSubmit,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
  onFilePicked,
  onRemoveAttachment,
  onVoiceStart,
  onVoiceStop,
}: ComposerProps) {
  const { t } = useTranslation();
  return (
    <div className="border-t border-border bg-bg/80 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center gap-2 px-6 pt-3">
        <ActiveLLMBadge />
        <RoutingHint draft={draft} />
      </div>
      <form
        onSubmit={onSubmit}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
        className={cn(
          'relative mx-auto flex max-w-3xl flex-col gap-2 px-6 pb-4 pt-2',
          dragDepth > 0 && 'ring-2 ring-gold-500/50 ring-offset-0',
        )}
        data-testid="chat-composer"
      >
        {/* Drag-drop overlay — appears when files are being dragged
            over the composer area so the user knows dropping will
            attach. */}
        {dragDepth > 0 && (
          <div
            className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-gold-500/10 backdrop-blur-[1px]"
            data-testid="chat-drop-overlay"
          >
            <span className="rounded-md border border-gold-500/40 bg-bg-elev-1 px-3 py-1.5 text-xs text-gold-500">
              Drop to attach
            </span>
          </div>
        )}

        {attachError && (
          <div
            className="rounded-md border border-danger/40 bg-danger/5 px-3 py-1.5 text-xs text-danger"
            data-testid="chat-attach-error"
          >
            {attachError}
          </div>
        )}

        {/* T4.4b — non-blocking budget warnings from the last send.
            Blocking breaches are handled by a modal confirm in
            send() itself, not here. */}
        {budgetWarnings.length > 0 && (
          <div
            className="flex flex-col gap-0.5 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-1.5 text-xs text-amber-600 dark:text-amber-400"
            data-testid="chat-budget-warning"
          >
            <div className="inline-flex items-center gap-1.5">
              <Icon icon={AlertTriangle} size="sm" />
              <span className="font-medium">{t('chat_page.budget_over_cap')}</span>
            </div>
            {budgetWarnings.map((line, i) => (
              <div key={i} className="pl-5 font-mono text-[11px] opacity-90">
                {line}
              </div>
            ))}
          </div>
        )}

        {/* T1.5c — surface when the active model clearly can't read
            images. We don't hard-block the send (the user may be
            mid-model-switch and know what they're doing); just warn
            once so nobody wonders why the model keeps saying "I can't
            see any image". Non-image attachments never trigger this
            because their [attached: name] text marker still works. */}
        {imageBlockedByModel && (
          <div
            className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-1.5 text-xs text-amber-600 dark:text-amber-400"
            data-testid="chat-vision-warning"
          >
            <Icon icon={AlertTriangle} size="sm" />
            <span>
              <Trans
                i18nKey="chat_page.vision_warning"
                values={{ model: effectiveModel }}
                components={{
                  code: <code className="rounded bg-amber-500/10 px-1" />,
                }}
              />
            </span>
          </div>
        )}

        {pendingAttachments.length > 0 && (
          <ul
            className="flex flex-wrap items-center gap-1.5"
            data-testid="chat-attachment-chips"
          >
            {pendingAttachments.map((a) => (
              <li
                key={a.id}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-bg-elev-1 px-2 py-0.5 text-xs text-fg"
                data-testid={`chat-attachment-chip-${a.id}`}
                title={`${a.mime} · ${formatBytes(a.size)}`}
              >
                <Icon icon={Paperclip} size="xs" className="text-fg-subtle" />
                <span className="max-w-[180px] truncate">{a.name}</span>
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(a.id)}
                  aria-label={`${t('chat_page.remove_attachment')} ${a.name}`}
                  className="rounded p-0.5 text-fg-subtle transition-colors hover:bg-bg-elev-2 hover:text-fg"
                >
                  <Icon icon={X} size="xs" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-end gap-2">
          {/* Hidden input — Paperclip button clicks it to open the
              native file chooser. No plugin dependency, works in both
              browser (dev/e2e) and Tauri. */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={onFilePicked}
            className="hidden"
            data-testid="chat-file-input"
          />
          <Button
            type="button"
            variant="ghost"
            className="h-11 px-3"
            onClick={() => fileInputRef.current?.click()}
            disabled={sending}
            aria-label={t('chat_page.attach_file')}
            title={
              visionCap === 'no'
                ? `${t('chat_page.attach_file')} ${t('chat_page.attach_text_only', { model: effectiveModel ?? 'current model' })}`
                : visionCap === 'unknown'
                  ? `${t('chat_page.attach_file')} ${t('chat_page.attach_vision_unverified')}`
                  : t('chat_page.attach_file')
            }
            data-testid="chat-attach-button"
            data-vision-support={visionCap}
          >
            <Icon icon={Paperclip} size="md" />
          </Button>

          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={onTextareaKeyDown}
            onPaste={onPaste}
            rows={1}
            placeholder={t('chat_page.message_placeholder')}
            disabled={sending}
            className={cn(
              // `min-h` anchors the empty state; JS auto-resize
              // governs everything above that up to the ~132px
              // ceiling enforced in the parent's useLayoutEffect.
              // `max-h` is kept as a CSS safety net in case the JS
              // never runs (SSR, error boundaries).
              'min-h-[44px] max-h-[132px] flex-1 resize-none rounded-xl border border-border',
              'bg-bg-elev-1 px-4 py-3 text-sm text-fg placeholder:text-fg-subtle',
              'focus:outline-none focus:ring-2 focus:ring-gold-500/40 focus:border-gold-500/40',
              'disabled:opacity-60',
            )}
            data-testid="chat-textarea"
          />
          {voiceRecording ? (
            <Button
              type="button"
              variant="danger"
              className="h-11 px-4"
              onClick={onVoiceStop}
              aria-label={t('chat_page.voice_stop')}
              title={t('chat_page.voice_stop')}
              data-testid="chat-voice-stop"
            >
              <Icon icon={Mic} size="md" />
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              className="h-11 px-3"
              onClick={onVoiceStart}
              aria-label={t('chat_page.voice_start')}
              title={t('chat_page.voice_start')}
              data-testid="chat-voice-start"
            >
              <Icon icon={Mic} size="md" className="text-fg-subtle" />
            </Button>
          )}
          {sending ? (
            <Button
              type="submit"
              variant="secondary"
              className="h-11 px-4"
              aria-label={t('chat_page.stop_generating')}
              title={t('chat_page.stop')}
            >
              <Icon icon={Square} size="md" fill="currentColor" />
            </Button>
          ) : (
            <Button
              type="submit"
              variant="primary"
              disabled={!draft.trim() && pendingAttachments.length === 0}
              className="h-11 px-4"
              aria-label={t('chat_page.send_message')}
              title={t('chat_page.send')}
              data-testid="chat-send"
            >
              <Icon icon={Send} size="md" />
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
