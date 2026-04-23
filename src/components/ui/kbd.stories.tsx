import type { Meta, StoryObj } from '@storybook/react';
import { Kbd } from './kbd';

/**
 * The `Kbd` primitive auto-adapts to the host platform (⌘ on macOS,
 * Ctrl on Windows/Linux). In Storybook we render both palette shortcuts
 * so you can eyeball the two sizes together.
 */
const meta: Meta<typeof Kbd> = {
  title: 'UI/Kbd',
  component: Kbd,
  parameters: { layout: 'centered' },
};
export default meta;

type Story = StoryObj<typeof Kbd>;

export const CommandK: Story = { args: { keys: ['mod', 'K'] } };
export const EscToClose: Story = { args: { keys: ['esc'] } };

export const PaletteRow: Story = {
  render: () => (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex items-center justify-between gap-6">
        <span className="text-fg-muted">Open command palette</span>
        <Kbd keys={['mod', 'K']} />
      </div>
      <div className="flex items-center justify-between gap-6">
        <span className="text-fg-muted">New session</span>
        <Kbd keys={['mod', 'shift', 'N']} />
      </div>
      <div className="flex items-center justify-between gap-6">
        <span className="text-fg-muted">Close drawer</span>
        <Kbd keys={['esc']} />
      </div>
    </div>
  ),
};
