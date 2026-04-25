import type { Meta, StoryObj } from '@storybook/react';
import { Select } from './select';

const meta: Meta<typeof Select<string>> = {
  title: 'UI/Select',
  component: Select,
  parameters: { layout: 'centered' },
  argTypes: {
    disabled: { control: 'boolean' },
  },
};
export default meta;

type Story = StoryObj<typeof Select<string>>;

const OPTIONS = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'ollama', label: 'Ollama' },
];

export const Default: Story = {
  args: {
    value: 'openai',
    options: OPTIONS,
    onChange: () => {},
    ariaLabel: 'Provider',
  },
};

export const Disabled: Story = {
  args: {
    value: 'openai',
    options: OPTIONS,
    onChange: () => {},
    ariaLabel: 'Provider',
    disabled: true,
  },
};
