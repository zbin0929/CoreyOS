import type { Meta, StoryObj } from '@storybook/react';
import { Settings, Sparkles } from 'lucide-react';
import { Card } from './card';
import { Icon } from './icon';
import { Button } from './button';

const meta: Meta<typeof Card> = {
  title: 'UI/Card',
  component: Card,
  parameters: { layout: 'centered' },
};
export default meta;

type Story = StoryObj<typeof Card>;

export const Simple: Story = {
  render: () => (
    <Card className="w-64 p-4">
      <h3 className="text-sm font-semibold text-fg">Card Title</h3>
      <p className="mt-1 text-xs text-fg-muted">Card description goes here.</p>
    </Card>
  ),
};

export const WithIcon: Story = {
  render: () => (
    <Card className="flex w-72 items-start gap-3 p-4">
      <Icon icon={Settings} size="lg" className="text-accent" />
      <div>
        <h3 className="text-sm font-semibold text-fg">Settings</h3>
        <p className="mt-1 text-xs text-fg-muted">Configure your preferences.</p>
        <Button size="xs" variant="primary" className="mt-2">
          <Icon icon={Sparkles} size="xs" />
          Open
        </Button>
      </div>
    </Card>
  ),
};
