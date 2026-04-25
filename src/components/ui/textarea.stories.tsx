import type { Meta, StoryObj } from '@storybook/react';
import { Textarea } from './textarea';

const meta: Meta<typeof Textarea> = {
  title: 'UI/Textarea',
  component: Textarea,
  parameters: { layout: 'centered' },
};
export default meta;

type Story = StoryObj<typeof Textarea>;

export const Default: Story = {
  args: { placeholder: 'Type something…' },
};

export const WithValue: Story = {
  args: { defaultValue: 'Hello, CoreyOS!\nThis is a textarea.' },
};

export const Disabled: Story = {
  args: { defaultValue: 'Cannot edit', disabled: true },
};
