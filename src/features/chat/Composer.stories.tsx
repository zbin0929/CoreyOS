import { useRef } from 'react';
import type { Meta, StoryObj } from '@storybook/react';

import type { StagedAttachment } from '@/lib/ipc';

import { Composer } from './Composer';

/**
 * Visual regression cover for the chat composer footer extracted in
 * the OP-025 refactor. Composer is props-only so we can drive every
 * variant from `args` — stories below capture the four states most
 * likely to break under unrelated CSS / token edits:
 *
 *  - `Default` — the empty composer the user sees on first paint.
 *  - `WithAttachments` — chip row + drop overlay populated; verifies
 *    chip truncation / icon alignment / hover affordances.
 *  - `Sending` — Stop button replaces Send, all controls dim; the
 *    state most likely to silently break when we touch the
 *    `useChatSend` hook (P3.1).
 *  - `WithWarnings` — budget breach + vision warning + stage error
 *    stacked above the chip row. Three variant banners side-by-
 *    side surface any token regressions (amber-500 / danger).
 *
 * Note: `ActiveLLMBadge` and `RoutingHint` mounted inside Composer
 * read Zustand stores hydrated from IPC. The `withTauriIpc`
 * decorator (`.storybook/preview.ts`) installs the same in-memory
 * mock the Playwright suite uses, so those subcomponents render
 * with the default fixture data instead of a "tauri internals
 * unavailable" boundary.
 */
const meta: Meta<typeof Composer> = {
  title: 'Features/Chat/Composer',
  component: Composer,
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof Composer>;

/** Keeps story args readable — every handler is a no-op stub. */
const noop = () => {};
const asyncNoop = async () => {};

/**
 * Common ref + handler scaffolding. Stories are wrapped so each
 * render gets a fresh pair of refs (Storybook re-renders on arg
 * change, but the refs themselves are stable across re-renders
 * within a single story session — same as production usage).
 */
function withRefs(args: Partial<React.ComponentProps<typeof Composer>>) {
  function Wrapper() {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    return (
      <div className="h-screen w-full flex items-end bg-bg">
        <Composer
          draft=""
          sending={false}
          voiceRecording={false}
          pendingAttachments={[]}
          dragDepth={0}
          attachError={null}
          budgetWarnings={[]}
          imageBlockedByModel={false}
          visionCap="yes"
          effectiveModel="gpt-4o"
          textareaRef={textareaRef}
          fileInputRef={fileInputRef}
          onDraftChange={noop}
          onTextareaKeyDown={noop}
          onPaste={noop}
          onSubmit={(e) => e.preventDefault()}
          onDragEnter={noop}
          onDragLeave={noop}
          onDragOver={noop}
          onDrop={noop}
          onFilePicked={asyncNoop}
          onRemoveAttachment={noop}
          onVoiceStart={noop}
          onVoiceStop={noop}
          {...args}
        />
      </div>
    );
  }
  return <Wrapper />;
}

const sampleAttachment = (
  id: string,
  name: string,
  mime: string,
  size: number,
): StagedAttachment => ({
  id,
  name,
  mime,
  size,
  path: `/tmp/storybook/${id}`,
  created_at: Date.now(),
});

export const Default: Story = {
  render: () => withRefs({}),
};

export const WithDraft: Story = {
  render: () =>
    withRefs({
      draft: "Summarise yesterday's incident report and surface the top three risks.",
    }),
};

export const WithAttachments: Story = {
  render: () =>
    withRefs({
      draft: 'Extract the bullet list and turn it into a Linear ticket.',
      pendingAttachments: [
        sampleAttachment('a1', 'incident-2026-04-25.md', 'text/markdown', 4321),
        sampleAttachment('a2', 'screenshot.png', 'image/png', 91234),
      ],
    }),
};

export const DraggingFiles: Story = {
  render: () =>
    withRefs({
      // dragDepth > 0 surfaces the drop overlay verbatim.
      dragDepth: 1,
    }),
};

export const Sending: Story = {
  render: () =>
    withRefs({
      draft: 'Streaming a long answer…',
      sending: true,
    }),
};

export const VoiceRecording: Story = {
  render: () =>
    withRefs({
      voiceRecording: true,
    }),
};

export const WithWarnings: Story = {
  render: () =>
    withRefs({
      draft: 'Send this anyway',
      attachError: 'Failed to stage `huge.bin`: file exceeds 25 MB limit.',
      budgetWarnings: [
        'gpt-4o: 1.20 USD over the 1.00 USD daily soft cap',
        'gpt-4o: 4 200 tokens over the 4 000-token monthly cap',
      ],
      imageBlockedByModel: true,
      visionCap: 'no',
      effectiveModel: 'deepseek-coder-v2',
      pendingAttachments: [sampleAttachment('a1', 'photo.jpg', 'image/jpeg', 5_400_000)],
    }),
};
