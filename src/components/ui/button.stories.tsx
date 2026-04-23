import type { Meta, StoryObj } from '@storybook/react';
import { Sparkles, Trash2 } from 'lucide-react';
import { Button } from './button';
import { Icon } from './icon';

const meta: Meta<typeof Button> = {
  title: 'UI/Button',
  component: Button,
  parameters: { layout: 'centered' },
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'secondary', 'ghost', 'danger'],
    },
    size: { control: 'select', options: ['xs', 'sm', 'md'] },
    loading: { control: 'boolean' },
    disabled: { control: 'boolean' },
  },
  args: { children: 'Continue', variant: 'secondary', size: 'md' },
};
export default meta;

type Story = StoryObj<typeof Button>;

export const Primary: Story = { args: { variant: 'primary' } };
export const Secondary: Story = { args: { variant: 'secondary' } };
export const Ghost: Story = { args: { variant: 'ghost' } };
export const Danger: Story = {
  args: {
    variant: 'danger',
    children: (
      <>
        <Icon icon={Trash2} size="sm" /> Delete
      </>
    ),
  },
};

export const Loading: Story = { args: { variant: 'primary', loading: true } };
export const Disabled: Story = { args: { disabled: true } };

/** All sizes side-by-side — quick visual-regression check for Tailwind
 *  class collisions when the size map grows. */
export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-center gap-2">
      <Button {...args} size="xs">xs</Button>
      <Button {...args} size="sm">sm</Button>
      <Button {...args} size="md">md</Button>
    </div>
  ),
  args: { variant: 'primary' },
};

/** Icon + label pairing — the most common composition in the app
 *  (e.g. `<Button><Icon icon={Plus} size="sm" />New</Button>`). */
export const WithIcon: Story = {
  args: {
    variant: 'primary',
    children: (
      <>
        <Icon icon={Sparkles} size="sm" /> Generate
      </>
    ),
  },
};
