import type { Meta, StoryObj } from '@storybook/react';

import { Button } from '@/components/ui/button';

import { FieldCard } from './AgentWizardHelpers';

/**
 * Smoke cover for the titled-group container used throughout
 * `AgentWizardDetailsStep` (Identity / Connection / Model). The
 * three variants below exercise the three slot configurations that
 * actually appear in the wizard so a token tweak to header type
 * size / border radius can't silently regress all of them at once.
 */
const meta: Meta<typeof FieldCard> = {
  title: 'Features/Settings/AgentWizard/FieldCard',
  component: FieldCard,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="w-[420px]">
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof FieldCard>;

export const WithContent: Story = {
  args: {
    title: 'Identity',
    children: (
      <div className="flex flex-col gap-2">
        <input
          className="rounded border border-border bg-bg px-2 py-1 text-sm text-fg"
          placeholder="agent-id"
        />
        <input
          className="rounded border border-border bg-bg px-2 py-1 text-sm text-fg"
          placeholder="Display label"
        />
      </div>
    ),
  },
};

export const WithActions: Story = {
  args: {
    title: 'Model',
    actions: (
      <Button size="xs" variant="ghost">
        Refresh models
      </Button>
    ),
    children: (
      <select className="w-full rounded border border-border bg-bg px-2 py-1 text-sm text-fg">
        <option>gpt-4o</option>
        <option>gpt-4o-mini</option>
        <option>claude-3-5-sonnet-latest</option>
      </select>
    ),
  },
};

export const EmptyBody: Story = {
  args: {
    title: 'Connection',
    children: (
      <p className="text-xs text-fg-muted">No fields configured yet.</p>
    ),
  },
};
