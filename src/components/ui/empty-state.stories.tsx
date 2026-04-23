import type { Meta, StoryObj } from '@storybook/react';
import { Plus, PiggyBank, Inbox } from 'lucide-react';
import { EmptyState } from './empty-state';
import { Button } from './button';
import { Icon } from './icon';

const meta: Meta<typeof EmptyState> = {
  title: 'UI/EmptyState',
  component: EmptyState,
  parameters: { layout: 'padded' },
};
export default meta;

type Story = StoryObj<typeof EmptyState>;

export const TitleOnly: Story = {
  args: { title: 'No sessions yet' },
};

export const WithIconAndDescription: Story = {
  args: {
    icon: Inbox,
    title: 'Unified inbox is empty',
    description:
      'New chats from any agent will land here. Pick an agent from the top bar to start.',
  },
};

export const WithAction: Story = {
  args: {
    icon: PiggyBank,
    title: 'No budgets yet',
    description: 'Cap spend per model, adapter, or channel before Claude runs wild.',
    action: (
      <Button variant="primary" size="sm">
        <Icon icon={Plus} size="sm" /> New budget
      </Button>
    ),
  },
};
