import type { Meta, StoryObj } from '@storybook/react';
import { Search } from 'lucide-react';
import { Input } from './input';
import { Icon } from './icon';

const meta: Meta<typeof Input> = {
  title: 'UI/Input',
  component: Input,
  parameters: { layout: 'centered' },
  argTypes: {
    disabled: { control: 'boolean' },
  },
};
export default meta;

type Story = StoryObj<typeof Input>;

export const Default: Story = {
  args: { placeholder: 'Type something…' },
};

export const WithValue: Story = {
  args: { defaultValue: 'Hello, CoreyOS!' },
};

export const WithIcon: Story = {
  render: () => (
    <div className="flex items-center gap-2 rounded-md border border-border bg-bg px-2">
      <Icon icon={Search} size="sm" className="text-fg-muted" />
      <Input placeholder="Search…" className="border-0 bg-transparent" />
    </div>
  ),
};

export const Disabled: Story = {
  args: { defaultValue: 'Cannot edit', disabled: true },
};
