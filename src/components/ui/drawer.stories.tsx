import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Drawer } from './drawer';
import { Button } from './button';

function DrawerDemo() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open Drawer</Button>
      <Drawer open={open} onClose={() => setOpen(false)} title="Drawer Title">
        <p className="p-4 text-sm text-fg-muted">Drawer content goes here.</p>
      </Drawer>
    </>
  );
}

const meta: Meta<typeof Drawer> = {
  title: 'UI/Drawer',
  component: Drawer,
  parameters: { layout: 'centered' },
};
export default meta;

type Story = StoryObj<typeof Drawer>;

export const Open: Story = {
  render: () => <DrawerDemo />,
};
